/**
 * OCR processing pipeline flow tests.
 *
 * Tests the full pipeline:
 *   POST /process → download from Telegram → upload to Storage →
 *   LLM extract → check for duplicates → append to Sheets → ACK message
 *
 * firestore.service functions are manually implemented using in-memory Maps
 * (same approach as correction.flow.test.ts).
 * All external I/O (Telegram, Storage, LLM, Sheets) is mocked.
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

// Skip Cloud Tasks header validation in tests
jest.mock('../../src/middlewares/cloudTasks', () => ({
  validateCloudTasks: jest.fn((req: unknown, _res: unknown, next: () => void) => next()),
  getRetryCount: jest.fn().mockReturnValue(0),
  getMaxRetries: jest.fn().mockReturnValue(6),
}));

jest.mock('@google-cloud/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __firestoreType: 'serverTimestamp' }),
    arrayUnion: (...elements: unknown[]) => ({ __firestoreType: 'arrayUnion', elements }),
    arrayRemove: (...elements: unknown[]) => ({ __firestoreType: 'arrayRemove', elements }),
    delete: () => ({ __firestoreType: 'delete' }),
  },
  Timestamp: {
    now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }),
    fromDate: (d: Date) => ({ toMillis: () => d.getTime(), toDate: () => d }),
  },
  Firestore: jest.fn(),
}));

jest.mock('../../src/services/firestore.service', () => ({
  getFirestore: jest.fn(),
  getJobId: jest.fn((chatId: number, messageId: number) => `${chatId}_${messageId}`),
  claimJob: jest.fn(),
  updateJobStep: jest.fn(),
  updateJobStepWithData: jest.fn(),
  storeExtraction: jest.fn(),
  markJobCompleted: jest.fn(),
  markJobFailed: jest.fn(),
  markJobPendingRetry: jest.fn(),
  clearJobArtifacts: jest.fn(),
  getJob: jest.fn(),
  getCorrectionPendingJob: jest.fn().mockResolvedValue(null),
  setCorrectionPending: jest.fn(),
  clearCorrectionPending: jest.fn(),
  applyJobCorrection: jest.fn(),
}));

jest.mock('../../src/services/telegram.service', () => ({
  sendMessage: jest.fn(),
  editMessageText: jest.fn(),
  editMessageReplyMarkup: jest.fn(),
  sendDocument: jest.fn(),
  answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
  downloadFileById: jest.fn(),
  getFileExtension: jest.fn().mockReturnValue('jpg'),
  formatSuccessMessage: jest
    .fn()
    .mockReturnValue('✅ Invoice processed\n📅 15/01/2024\n💰 500 ILS'),
  formatFailureMessage: jest.fn().mockReturnValue('❌ Failed'),
}));

jest.mock('../../src/services/storage.service', () => ({
  uploadInvoiceImage: jest.fn(),
  deleteFile: jest.fn().mockResolvedValue(true),
  rollbackUploadedFiles: jest.fn().mockResolvedValue(undefined),
  getStorage: jest.fn(),
}));

jest.mock('../../src/services/llm.service', () => ({
  extractInvoiceData: jest.fn(),
  extractInvoiceDataMulti: jest.fn(),
  needsReview: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/duplicate-detection.service', () => ({
  findDuplicateInvoice: jest.fn().mockResolvedValue(null),
  formatDuplicateWarning: jest
    .fn()
    .mockReturnValue({ text: '⚠️ duplicate', keyboard: { inline_keyboard: [] } }),
  markJobPendingDecision: jest.fn().mockResolvedValue(undefined),
  getPendingDecisionJob: jest.fn().mockResolvedValue(null),
  formatDuplicateResolved: jest.fn().mockReturnValue('✅ resolved'),
}));

jest.mock('../../src/services/sheets.service', () => ({
  appendRow: jest.fn(),
  buildSheetRow: jest.fn().mockReturnValue({ col1: 'value' }),
  updateRow: jest.fn().mockResolvedValue(undefined),
  appendGeneratedInvoiceRow: jest.fn().mockResolvedValue(undefined),
  appendOnboardingRow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: {
    isEnabled: jest.fn().mockReturnValue(false),
    getValue: jest.fn().mockResolvedValue(false),
    destroy: jest.fn(),
  },
}));

jest.mock('../../src/services/pdf.service', () => ({
  getPDFInfo: jest.fn(),
  convertPDFToImages: jest.fn(),
}));

jest.mock('../../src/services/heic.service', () => ({
  convertHEICToJPEG: jest.fn(),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import request from 'supertest';
import * as telegramService from '../../src/services/telegram.service';
import {
  getFirestore,
  claimJob,
  updateJobStep,
  storeExtraction,
  markJobCompleted,
  markJobFailed,
  markJobPendingRetry,
  clearJobArtifacts,
} from '../../src/services/firestore.service';
import { uploadInvoiceImage, rollbackUploadedFiles } from '../../src/services/storage.service';
import { extractInvoiceData, needsReview } from '../../src/services/llm.service';
import { findDuplicateInvoice } from '../../src/services/duplicate-detection.service';
import { appendRow } from '../../src/services/sheets.service';
import { InMemoryFirestore } from './helpers/in-memory-firestore';
import app from '../../src/app';
import { CHAT_ID } from './helpers/test-data';

// ─── Constants ───────────────────────────────────────────────────────────────

const MESSAGE_ID = 42;
const FILE_ID = 'tg_file_abc123';
const FAKE_IMAGE = Buffer.from('fake-image-data');
const TASK_PAYLOAD = {
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
  fileId: FILE_ID,
  uploaderUsername: 'testuser',
  uploaderFirstName: 'Test',
  chatTitle: 'Test Chat',
  receivedAt: new Date().toISOString(),
};

// ─── In-memory state ──────────────────────────────────────────────────────────

let jobStore: Record<string, Record<string, unknown>>;
let db: InMemoryFirestore;

function getJobId(chatId: number, messageId: number): string {
  return `${chatId}_${messageId}`;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jobStore = {};
  db = new InMemoryFirestore();
  (getFirestore as jest.Mock).mockReturnValue(db);

  // claimJob — atomic idempotency check
  (claimJob as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number, payload: Record<string, unknown>) => {
      const jobId = getJobId(chatId, messageId);
      const existing = jobStore[jobId];

      if (existing?.status === 'processed' || existing?.status === 'failed') {
        return { claimed: false, job: existing };
      }

      jobStore[jobId] = {
        ...payload,
        status: 'processing',
        attempts: 1,
        telegramChatId: chatId,
        telegramMessageId: messageId,
        createdAt: { toMillis: () => Date.now() },
      };
      return { claimed: true, job: jobStore[jobId] };
    }
  );

  // updateJobStep — track pipeline progress
  (updateJobStep as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number, step: string, data?: Record<string, unknown>) => {
      const jobId = getJobId(chatId, messageId);
      jobStore[jobId] = { ...jobStore[jobId], lastStep: step, ...data };
    }
  );

  // storeExtraction — persist LLM output
  (storeExtraction as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number, extraction: Record<string, unknown>) => {
      const jobId = getJobId(chatId, messageId);
      jobStore[jobId] = { ...jobStore[jobId], ...extraction };
    }
  );

  // markJobCompleted — final success state
  (markJobCompleted as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number, data: Record<string, unknown>) => {
      const jobId = getJobId(chatId, messageId);
      jobStore[jobId] = { ...jobStore[jobId], ...data, status: 'processed' };
    }
  );

  // markJobFailed / markJobPendingRetry — error paths
  (markJobFailed as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number, step: string, error: string) => {
      const jobId = getJobId(chatId, messageId);
      jobStore[jobId] = {
        ...jobStore[jobId],
        status: 'failed',
        lastStep: step,
        lastError: error,
        driveLink: undefined,
        driveFileId: undefined,
        vendorName: undefined,
        totalAmount: undefined,
      };
    }
  );
  (markJobPendingRetry as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number, step: string, error: string) => {
      const jobId = getJobId(chatId, messageId);
      jobStore[jobId] = {
        ...jobStore[jobId],
        status: 'pending_retry',
        lastStep: step,
        lastError: error,
      };
    }
  );
  (clearJobArtifacts as jest.Mock).mockImplementation(async (chatId: number, messageId: number) => {
    const jobId = getJobId(chatId, messageId);
    jobStore[jobId] = {
      ...jobStore[jobId],
      driveLink: undefined,
      driveFileId: undefined,
      vendorName: undefined,
      totalAmount: undefined,
      currency: undefined,
    };
  });

  // External mocks
  (telegramService.downloadFileById as jest.Mock).mockResolvedValue({
    buffer: FAKE_IMAGE,
    filePath: 'photos/file.jpg',
  });
  (telegramService.getFileExtension as jest.Mock).mockReturnValue('jpg');
  (telegramService.sendMessage as jest.Mock).mockResolvedValue({ message_id: 999 });

  (uploadInvoiceImage as jest.Mock).mockResolvedValue({
    fileId: 'invoices/test/file.jpg',
    webViewLink: 'https://storage.googleapis.com/bucket/test.jpg',
  });

  (extractInvoiceData as jest.Mock).mockResolvedValue({
    extraction: {
      is_invoice: true,
      rejection_reason: null,
      vendor_name: 'Acme Corp',
      invoice_number: 'INV-001',
      invoice_date: '2024-01-15',
      total_amount: 500,
      currency: 'ILS',
      vat_amount: 65,
      confidence: 0.95,
      category: 'services',
    },
    usage: {
      provider: 'openai',
      totalTokens: 150,
      costUSD: 0.001,
    },
  });

  (needsReview as jest.Mock).mockReturnValue(false);
  (findDuplicateInvoice as jest.Mock).mockResolvedValue(null);
  (appendRow as jest.Mock).mockResolvedValue(42);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Full OCR pipeline: image → ACK ──────────────────────────────────────────

it('process: full pipeline — job claimed, LLM extracted, sheet appended, ACK sent', async () => {
  const res = await request(app)
    .post('/process')
    .set('X-CloudTasks-TaskName', 'test-task')
    .set('X-CloudTasks-QueueName', 'test-queue')
    .send(TASK_PAYLOAD);

  expect(res.status).toBe(200);
  expect(res.body.action).toBe('processed');

  // Job should be claimed and then marked as processed
  expect(claimJob as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    MESSAGE_ID,
    expect.objectContaining({
      telegramFileId: FILE_ID,
      uploaderUsername: 'testuser',
      chatTitle: 'Test Chat',
    })
  );
  expect(jobStore[getJobId(CHAT_ID, MESSAGE_ID)].status).toBe('processed');

  // File downloaded from Telegram
  expect(telegramService.downloadFileById as jest.Mock).toHaveBeenCalledWith(FILE_ID);

  // File uploaded to Cloud Storage
  expect(uploadInvoiceImage as jest.Mock).toHaveBeenCalledWith(
    FAKE_IMAGE,
    'jpg',
    CHAT_ID,
    MESSAGE_ID,
    TASK_PAYLOAD.receivedAt
  );

  // LLM extraction ran
  expect(extractInvoiceData as jest.Mock).toHaveBeenCalled();

  // Duplicate check ran (no duplicate found)
  expect(findDuplicateInvoice as jest.Mock).toHaveBeenCalled();

  // Sheet row appended
  expect(appendRow as jest.Mock).toHaveBeenCalledWith(CHAT_ID, expect.anything());

  // Extraction persisted only after Sheets succeeds
  expect(storeExtraction as jest.Mock).toHaveBeenCalledTimes(1);
  expect(storeExtraction as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    MESSAGE_ID,
    expect.objectContaining({ vendor_name: 'Acme Corp', total_amount: 500 })
  );
  expect((storeExtraction as jest.Mock).mock.invocationCallOrder[0]).toBeGreaterThan(
    (appendRow as jest.Mock).mock.invocationCallOrder[0]
  );

  // Job marked as processed with sheet row ID and drive link
  expect(markJobCompleted as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    MESSAGE_ID,
    expect.objectContaining({
      driveLink: 'https://storage.googleapis.com/bucket/test.jpg',
      sheetRowId: 42,
      llmProvider: 'openai',
      totalTokens: 150,
      costUSD: 0.001,
    })
  );

  // ACK message sent to user
  expect(telegramService.sendMessage as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    expect.any(String),
    expect.objectContaining({ replyToMessageId: MESSAGE_ID })
  );
});

// ─── Idempotency: job already processed ───────────────────────────────────────

it('process: already processed job — returns already_processed, no re-processing', async () => {
  // Pre-populate job as already processed
  jobStore[getJobId(CHAT_ID, MESSAGE_ID)] = {
    status: 'processed',
    driveLink: 'https://storage.googleapis.com/bucket/old.jpg',
  };

  const res = await request(app)
    .post('/process')
    .set('X-CloudTasks-TaskName', 'test-task')
    .set('X-CloudTasks-QueueName', 'test-queue')
    .send(TASK_PAYLOAD);

  expect(res.status).toBe(200);
  expect(res.body.action).toBe('already_processed');

  // Should not re-download or re-extract
  expect(telegramService.downloadFileById as jest.Mock).not.toHaveBeenCalled();
  expect(extractInvoiceData as jest.Mock).not.toHaveBeenCalled();
  expect(appendRow as jest.Mock).not.toHaveBeenCalled();
});

// ─── Not an invoice: rejection message sent, file deleted ────────────────────

it('process: LLM rejects as non-invoice — file deleted, rejection message sent', async () => {
  (extractInvoiceData as jest.Mock).mockResolvedValue({
    extraction: {
      is_invoice: false,
      rejection_reason: 'This appears to be a personal photo, not an invoice.',
      vendor_name: null,
      invoice_number: null,
      invoice_date: null,
      total_amount: null,
      currency: null,
      vat_amount: null,
      confidence: 0.1,
      category: null,
    },
    usage: { provider: 'openai', totalTokens: 80, costUSD: 0.0005 },
  });

  const res = await request(app)
    .post('/process')
    .set('X-CloudTasks-TaskName', 'test-task')
    .set('X-CloudTasks-QueueName', 'test-queue')
    .send(TASK_PAYLOAD);

  expect(res.status).toBe(200);

  // File should be deleted (not an invoice)
  expect(rollbackUploadedFiles as jest.Mock).toHaveBeenCalledWith(
    ['invoices/test/file.jpg'],
    expect.objectContaining({ jobId: getJobId(CHAT_ID, MESSAGE_ID) })
  );

  // Sheet should NOT have been appended
  expect(appendRow as jest.Mock).not.toHaveBeenCalled();

  // Rejection message sent to user
  expect(telegramService.sendMessage as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    expect.stringContaining('Not an invoice'),
    expect.objectContaining({ replyToMessageId: MESSAGE_ID })
  );
});

// ─── Duplicate found: pending decision, no sheet append ──────────────────────

it('process: duplicate detected — pending_decision, no sheet append, user shown buttons', async () => {
  (findDuplicateInvoice as jest.Mock).mockResolvedValue({
    jobId: `${CHAT_ID}_10`,
    vendorName: 'Acme Corp',
    totalAmount: 500,
    invoiceDate: '2024-01-15',
    driveLink: 'https://storage.googleapis.com/bucket/existing.jpg',
    matchType: 'exact',
  });

  const res = await request(app)
    .post('/process')
    .set('X-CloudTasks-TaskName', 'test-task')
    .set('X-CloudTasks-QueueName', 'test-queue')
    .send(TASK_PAYLOAD);

  expect(res.status).toBe(200);
  expect(res.body.action).toBe('processed');

  // Sheet should NOT have been appended (waiting for user decision)
  expect(appendRow as jest.Mock).not.toHaveBeenCalled();

  // markJobCompleted should NOT have been called (job is pending_decision, not done)
  expect(markJobCompleted as jest.Mock).not.toHaveBeenCalled();

  // User should see the duplicate warning message with inline buttons
  expect(telegramService.sendMessage as jest.Mock).toHaveBeenCalled();

  // Duplicate path persists extraction before user decision
  expect(storeExtraction as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    MESSAGE_ID,
    expect.objectContaining({ vendor_name: 'Acme Corp' })
  );
});

// ─── Sheets failure: rollback storage and clear Firestore artifacts ───────────

it('process: sheets append fails — storage rolled back and artifacts cleared', async () => {
  (appendRow as jest.Mock).mockRejectedValue(new Error('Sheets API unavailable'));

  const res = await request(app)
    .post('/process')
    .set('X-CloudTasks-TaskName', 'test-task')
    .set('X-CloudTasks-QueueName', 'test-queue')
    .send(TASK_PAYLOAD);

  expect(res.status).toBe(500);
  expect(res.body.action).toBe('retry');

  expect(rollbackUploadedFiles as jest.Mock).toHaveBeenCalledWith(
    ['invoices/test/file.jpg'],
    expect.objectContaining({ jobId: getJobId(CHAT_ID, MESSAGE_ID) })
  );
  expect(clearJobArtifacts as jest.Mock).toHaveBeenCalledWith(CHAT_ID, MESSAGE_ID);
  expect(markJobPendingRetry as jest.Mock).toHaveBeenCalled();
  expect(storeExtraction as jest.Mock).not.toHaveBeenCalled();
  expect(markJobCompleted as jest.Mock).not.toHaveBeenCalled();
});

// ─── Success path does not write extraction before Sheets ─────────────────────

it('process: extraction is not stored before sheet append on success path', async () => {
  const callOrder: string[] = [];
  (appendRow as jest.Mock).mockImplementation(async () => {
    callOrder.push('appendRow');
    return 42;
  });
  (storeExtraction as jest.Mock).mockImplementation(async () => {
    callOrder.push('storeExtraction');
  });

  await request(app)
    .post('/process')
    .set('X-CloudTasks-TaskName', 'test-task')
    .set('X-CloudTasks-QueueName', 'test-queue')
    .send(TASK_PAYLOAD);

  expect(callOrder).toEqual(['appendRow', 'storeExtraction']);
});

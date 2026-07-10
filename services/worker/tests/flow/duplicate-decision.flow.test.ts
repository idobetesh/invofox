/**
 * Duplicate decision flow tests.
 *
 * Tests the "keep both / delete new" inline keyboard that appears when the
 * OCR pipeline detects a potential duplicate invoice.
 *
 * Flow:
 *   job already pending_decision in Firestore
 *   → POST /callback with { a: 'keep_both' | 'delete_new', c: chatId, m: messageId }
 *   → keep_both: appendRow called, job marked processed, edit message shown
 *   → delete_new: deleteFile called, job marked processed, edit message shown
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

// ─── Imports ────────────────────────────────────────────────────────────────

import request from 'supertest';
import * as telegramService from '../../src/services/telegram.service';
import { getFirestore, getJob, markJobCompleted } from '../../src/services/firestore.service';
import {
  getPendingDecisionJob,
  formatDuplicateResolved,
} from '../../src/services/duplicate-detection.service';
import { appendRow } from '../../src/services/sheets.service';
import { deleteFile } from '../../src/services/storage.service';
import { InMemoryFirestore } from './helpers/in-memory-firestore';
import app from '../../src/app';
import { CHAT_ID } from './helpers/test-data';

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
  getJob: jest.fn(),
  markJobCompleted: jest.fn(),
  updateJobStep: jest.fn(),
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
  formatSuccessMessage: jest.fn().mockReturnValue('✅ processed'),
  formatFailureMessage: jest.fn().mockReturnValue('❌ failed'),
  downloadFileById: jest.fn(),
  getFileExtension: jest.fn().mockReturnValue('jpg'),
}));

jest.mock('../../src/services/duplicate-detection.service', () => ({
  getPendingDecisionJob: jest.fn(),
  formatDuplicateResolved: jest.fn().mockReturnValue('✅ Resolution message'),
  findDuplicateInvoice: jest.fn().mockResolvedValue(null),
  formatDuplicateWarning: jest
    .fn()
    .mockReturnValue({ text: '⚠️ duplicate', keyboard: { inline_keyboard: [] } }),
  markJobPendingDecision: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/sheets.service', () => ({
  appendRow: jest.fn(),
  buildSheetRow: jest.fn().mockReturnValue({}),
  updateRow: jest.fn().mockResolvedValue(undefined),
  appendGeneratedInvoiceRow: jest.fn().mockResolvedValue(undefined),
  appendOnboardingRow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/storage.service', () => ({
  uploadInvoiceImage: jest.fn(),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  getStorage: jest.fn(),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: {
    isEnabled: jest.fn().mockReturnValue(false),
    getValue: jest.fn().mockResolvedValue(false),
    destroy: jest.fn(),
  },
}));

jest.mock('../../src/services/llm.service', () => ({
  extractInvoiceData: jest.fn(),
  extractInvoiceDataMulti: jest.fn(),
  needsReview: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/pdf.service', () => ({
  getPDFInfo: jest.fn(),
  convertPDFToImages: jest.fn(),
}));

jest.mock('../../src/services/heic.service', () => ({
  convertHEICToJPEG: jest.fn(),
}));

// ─── Constants ───────────────────────────────────────────────────────────────

const MESSAGE_ID = 100; // The original invoice message
const BOT_MSG_ID = 200; // The "duplicate warning" message sent by the bot
const EXISTING_JOB_ID = `${CHAT_ID}_50`; // The already-processed duplicate
const JOB_ID = `${CHAT_ID}_${MESSAGE_ID}`; // The pending decision job

// ─── In-memory state ──────────────────────────────────────────────────────────

let jobStore: Record<string, Record<string, unknown>>;
let db: InMemoryFirestore;

function seedJob(jobId: string, data: Record<string, unknown>): void {
  jobStore[jobId] = { ...data };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jobStore = {};
  db = new InMemoryFirestore();
  (getFirestore as jest.Mock).mockReturnValue(db);

  // getPendingDecisionJob: returns job if status is 'pending_decision'
  (getPendingDecisionJob as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number) => {
      const jobId = `${chatId}_${messageId}`;
      const job = jobStore[jobId];
      if (!job || job.status !== 'pending_decision') {
        return null;
      }
      return { ...job, jobId };
    }
  );

  // getJob: returns any job by chatId + messageId
  (getJob as jest.Mock).mockImplementation(async (chatId: number, messageId: number) => {
    return jobStore[`${chatId}_${messageId}`] || null;
  });

  // markJobCompleted: marks job as processed
  (markJobCompleted as jest.Mock).mockImplementation(
    async (chatId: number, messageId: number, data: Record<string, unknown>) => {
      const jobId = `${chatId}_${messageId}`;
      jobStore[jobId] = { ...jobStore[jobId], ...data, status: 'processed' };
    }
  );

  // appendRow: returns a fake row ID
  (appendRow as jest.Mock).mockResolvedValue(42);

  // formatDuplicateResolved: pure helper — keep the default mock
  (formatDuplicateResolved as jest.Mock).mockImplementation(
    (action: string, _driveLink: string, _existingLink: string) =>
      action === 'keep_both' ? '✅ שתי החשבוניות נשמרו' : '🗑️ החשבונית הכפולה נמחקה'
  );

  (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
  (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function sendDecisionCallback(action: 'keep_both' | 'delete_new') {
  return request(app)
    .post('/callback')
    .send({
      callbackQueryId: `cbq_dup_${action}`,
      data: JSON.stringify({ a: action, c: CHAT_ID, m: MESSAGE_ID }),
      botMessageChatId: CHAT_ID,
      botMessageId: BOT_MSG_ID,
    });
}

// ─── keep_both ────────────────────────────────────────────────────────────────

it('duplicate-decision: keep_both — appendRow called, job marked processed', async () => {
  seedJob(JOB_ID, {
    status: 'pending_decision',
    telegramChatId: CHAT_ID,
    telegramMessageId: MESSAGE_ID,
    driveFileId: 'invoices/test/file.jpg',
    driveLink: 'https://storage.googleapis.com/bucket/test.jpg',
    duplicateOfJobId: EXISTING_JOB_ID,
    vendorName: 'Acme Corp',
    totalAmount: 500,
    invoiceDate: '2024-01-15',
    uploaderUsername: 'testuser',
    chatTitle: 'Test Chat',
    receivedAt: new Date().toISOString(),
    llmProvider: 'openai',
    totalTokens: 100,
    costUSD: 0.001,
    currency: 'ILS',
    confidence: 0.95,
  });

  seedJob(EXISTING_JOB_ID, {
    status: 'processed',
    driveLink: 'https://storage.googleapis.com/bucket/existing.jpg',
    vendorName: 'Acme Corp',
    totalAmount: 500,
  });

  const res = await sendDecisionCallback('keep_both');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.action).toBe('keep_both');

  // Sheets row should have been appended
  expect(appendRow as jest.Mock).toHaveBeenCalledWith(CHAT_ID, expect.anything());

  // Job should be marked as processed
  expect(markJobCompleted as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    MESSAGE_ID,
    expect.objectContaining({ driveLink: expect.any(String) })
  );
  expect(jobStore[JOB_ID].status).toBe('processed');

  // delete should NOT have been called (we kept both)
  expect(deleteFile as jest.Mock).not.toHaveBeenCalled();

  // Edit the button message to show resolution
  expect(telegramService.editMessageText as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    BOT_MSG_ID,
    expect.stringContaining('שמרו') || expect.any(String),
    expect.objectContaining({ parseMode: 'Markdown' })
  );
});

// ─── delete_new ───────────────────────────────────────────────────────────────

it('duplicate-decision: delete_new — deleteFile called, appendRow NOT called', async () => {
  seedJob(JOB_ID, {
    status: 'pending_decision',
    telegramChatId: CHAT_ID,
    telegramMessageId: MESSAGE_ID,
    driveFileId: 'invoices/test/file.jpg',
    driveLink: 'https://storage.googleapis.com/bucket/test.jpg',
    duplicateOfJobId: EXISTING_JOB_ID,
    vendorName: 'Acme Corp',
    totalAmount: 500,
    invoiceDate: '2024-01-15',
    uploaderUsername: 'testuser',
    chatTitle: 'Test Chat',
    receivedAt: new Date().toISOString(),
    llmProvider: 'openai',
    totalTokens: 100,
    costUSD: 0.001,
    currency: 'ILS',
  });

  seedJob(EXISTING_JOB_ID, {
    status: 'processed',
    driveLink: 'https://storage.googleapis.com/bucket/existing.jpg',
  });

  const res = await sendDecisionCallback('delete_new');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.action).toBe('delete_new');

  // deleteFile should have been called with the new file's path
  expect(deleteFile as jest.Mock).toHaveBeenCalledWith('invoices/test/file.jpg');

  // appendRow should NOT have been called (we deleted the new one)
  expect(appendRow as jest.Mock).not.toHaveBeenCalled();

  // Job should still be marked as processed (duplicate deleted)
  expect(markJobCompleted as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    MESSAGE_ID,
    expect.objectContaining({ driveFileId: 'invoices/test/file.jpg' })
  );
  expect(jobStore[JOB_ID].status).toBe('processed');

  // Edit the button message
  expect(telegramService.editMessageText as jest.Mock).toHaveBeenCalled();
});

// ─── no pending decision ──────────────────────────────────────────────────────

it('duplicate-decision: no pending job — returns ok: false', async () => {
  // No job seeded — nothing to decide on
  const res = await sendDecisionCallback('keep_both');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toContain('Decision already processed or expired');

  expect(appendRow as jest.Mock).not.toHaveBeenCalled();
  expect(deleteFile as jest.Mock).not.toHaveBeenCalled();
});

/**
 * Correction flow tests — "edit expenses" / processed invoice field correction.
 *
 * Tests the ✏️ Edit button flow on processed OCR invoices:
 *   click Edit → field selection keyboard → click field → type new value → applied.
 *
 * correction.service runs with REAL validation logic.
 * State (correctionPending, jobs) is tracked in in-memory Maps wired to mocked
 * firestore.service functions.
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

// ─── Imports ────────────────────────────────────────────────────────────────

import * as telegramService from '../../src/services/telegram.service';
import {
  getFirestore,
  getCorrectionPendingJob,
  setCorrectionPending,
  clearCorrectionPending,
  applyJobCorrection,
  getJob,
} from '../../src/services/firestore.service';
import { InMemoryFirestore } from './helpers/in-memory-firestore';
import {
  TelegramCapture,
  ConversationSimulator,
  setupTelegramMock,
} from './helpers/conversation-simulator';
import { CHAT_ID, USER_ID, USERNAME } from './helpers/test-data';
import app from '../../src/app';

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
  getCorrectionPendingJob: jest.fn(),
  setCorrectionPending: jest.fn(),
  clearCorrectionPending: jest.fn(),
  applyJobCorrection: jest.fn(),
  getJob: jest.fn(),
}));

jest.mock('../../src/services/telegram.service', () => ({
  sendMessage: jest.fn(),
  editMessageText: jest.fn(),
  editMessageReplyMarkup: jest.fn(),
  sendDocument: jest.fn(),
  answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
  formatSuccessMessage: jest
    .fn()
    .mockReturnValue('✅ Invoice processed\n📅 01/01/2024\n💰 500 ILS'),
}));

jest.mock('../../src/services/sheets.service', () => ({
  updateRow: jest.fn().mockResolvedValue(undefined),
  appendGeneratedInvoiceRow: jest.fn().mockResolvedValue(undefined),
  appendOnboardingRow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { isEnabled: jest.fn().mockReturnValue(false), destroy: jest.fn() },
}));

// ─── In-memory state for correction ─────────────────────────────────────────

// These are reset in beforeEach and referenced by the mock implementations
let jobStore: Record<string, Record<string, unknown>>;
let correctionIndex: Record<string, string>; // String(chatId) → jobId

function seedJob(jobId: string, data: Record<string, unknown>): void {
  jobStore[jobId] = { ...data };
}

// jobId format: "${chatId}_${messageId}" — matches getJobId() in firestore.service.ts
const JOB_ID = `${CHAT_ID}_100`; // e.g. "-100100100_100"
const SUCCESS_MSG_ID = 100;

// ─── Setup ───────────────────────────────────────────────────────────────────

let db: InMemoryFirestore;
let capture: TelegramCapture;
let sim: ConversationSimulator;

beforeEach(() => {
  jobStore = {};
  correctionIndex = {};

  db = new InMemoryFirestore();
  (getFirestore as jest.Mock).mockReturnValue(db);

  capture = new TelegramCapture();
  setupTelegramMock(telegramService as unknown as Record<string, jest.Mock>, capture);

  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);

  // Wire firestore.service mocks to the in-memory stores
  (getCorrectionPendingJob as jest.Mock).mockImplementation(async (chatId: number) => {
    const jobId = correctionIndex[String(chatId)];
    if (!jobId) {
      return null;
    }
    const job = jobStore[jobId];
    if (!job?.correctionPending) {
      return null;
    }
    return { ...job, jobId };
  });

  (setCorrectionPending as jest.Mock).mockImplementation(
    async (jobId: string, field: string, promptMessageId: number, successMessageId: number) => {
      jobStore[jobId] = {
        ...(jobStore[jobId] || {}),
        correctionPending: { field, promptMessageId, successMessageId },
      };
      correctionIndex[String(parseInt(jobId.split('_')[0]))] = jobId;
    }
  );

  (clearCorrectionPending as jest.Mock).mockImplementation(async (jobId: string) => {
    if (jobStore[jobId]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (jobStore[jobId] as any).correctionPending;
    }
    delete correctionIndex[String(parseInt(jobId.split('_')[0]))];
  });

  (applyJobCorrection as jest.Mock).mockImplementation(
    async (jobId: string, updates: Record<string, unknown>) => {
      jobStore[jobId] = { ...(jobStore[jobId] || {}), ...updates };
    }
  );

  (getJob as jest.Mock).mockImplementation(async (chatId: number, messageId: number) => {
    return jobStore[`${chatId}_${messageId}`] || null;
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── edit_invoice: shows field selection keyboard ────────────────────────────

it('correction: edit_invoice callback shows field selection keyboard', async () => {
  seedJob(JOB_ID, {
    totalAmount: 500,
    currency: 'ILS',
    driveLink: 'https://drive.google.com/test',
  });

  const res = await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('edit_invoice');

  sim.expectButtons(['💰 סכום', '📅 תאריך', '🏢 ספק', '✖ ביטול']);
});

// ─── edit amount: full happy path ────────────────────────────────────────────

it('correction: edit amount — valid value applied, message updated, confirmation sent', async () => {
  seedJob(JOB_ID, {
    totalAmount: 500,
    currency: 'ILS',
    driveLink: 'https://drive.google.com/test',
    invoiceDate: '2024-01-01',
  });

  // Step 1: open field selection
  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  sim.expectButtons(['💰 סכום', '📅 תאריך', '🏢 ספק', '✖ ביטול']);

  // Step 2: select Amount field → prompt sent, pending stored
  const editRes = await sim.clickProcessButton('💰 סכום');
  expect(editRes.status).toBe(200);
  expect(editRes.body.action).toBe('edit_field');

  // Pending correction is now stored
  expect(correctionIndex[String(CHAT_ID)]).toBe(JOB_ID);
  expect(jobStore[JOB_ID].correctionPending).toMatchObject({ field: 'totalAmount' });

  // Step 3: user sends the corrected amount
  const msgRes = await sim.sendMessage('750');
  expect(msgRes.status).toBe(200);
  expect(msgRes.body.action).toBe('correction_handled');

  // Firestore updated
  expect(applyJobCorrection as jest.Mock).toHaveBeenCalledWith(JOB_ID, { totalAmount: 750 });

  // Pending cleared
  expect(clearCorrectionPending as jest.Mock).toHaveBeenCalledWith(JOB_ID);
  expect(jobStore[JOB_ID].correctionPending).toBeUndefined();

  // Confirmation message sent
  sim.expectMessageContains('הסכום עודכן');
});

// ─── edit date: full happy path ───────────────────────────────────────────────

it('correction: edit date — valid DD/MM/YYYY applied', async () => {
  seedJob(JOB_ID, {
    totalAmount: 500,
    currency: 'ILS',
    driveLink: 'https://drive.google.com/test',
    invoiceDate: '2024-01-01',
  });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('📅 תאריך');

  const msgRes = await sim.sendMessage('15/03/2024');
  expect(msgRes.status).toBe(200);
  expect(msgRes.body.action).toBe('correction_handled');

  expect(applyJobCorrection as jest.Mock).toHaveBeenCalledWith(JOB_ID, {
    invoiceDate: '2024-03-15',
  });
  expect(clearCorrectionPending as jest.Mock).toHaveBeenCalledWith(JOB_ID);
  sim.expectMessageContains('התאריך עודכן');
});

// ─── edit vendor: full happy path ────────────────────────────────────────────

it('correction: edit vendor — valid name applied', async () => {
  seedJob(JOB_ID, {
    totalAmount: 500,
    currency: 'ILS',
    driveLink: 'https://drive.google.com/test',
    vendorName: 'Old Vendor Ltd',
  });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('🏢 ספק');

  const msgRes = await sim.sendMessage('New Vendor LLC');
  expect(msgRes.status).toBe(200);
  expect(msgRes.body.action).toBe('correction_handled');

  expect(applyJobCorrection as jest.Mock).toHaveBeenCalledWith(JOB_ID, {
    vendorName: 'New Vendor LLC',
  });
  expect(clearCorrectionPending as jest.Mock).toHaveBeenCalledWith(JOB_ID);
  sim.expectMessageContains('הספק עודכן');
});

// ─── edit amount: invalid inputs ─────────────────────────────────────────────

it('correction: edit amount — letters rejected, pending stays', async () => {
  seedJob(JOB_ID, { totalAmount: 500, currency: 'ILS', driveLink: '' });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('💰 סכום');

  await sim.sendMessage('not-a-number');

  expect(applyJobCorrection as jest.Mock).not.toHaveBeenCalled();
  expect(clearCorrectionPending as jest.Mock).not.toHaveBeenCalled();
  // Correction still pending
  expect(jobStore[JOB_ID].correctionPending).toBeDefined();
});

it('correction: edit amount — zero rejected', async () => {
  seedJob(JOB_ID, { totalAmount: 500, currency: 'ILS', driveLink: '' });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('💰 סכום');

  await sim.sendMessage('0');

  expect(applyJobCorrection as jest.Mock).not.toHaveBeenCalled();
  expect(clearCorrectionPending as jest.Mock).not.toHaveBeenCalled();
});

it('correction: edit amount — negative rejected', async () => {
  seedJob(JOB_ID, { totalAmount: 500, currency: 'ILS', driveLink: '' });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('💰 סכום');

  await sim.sendMessage('-100');

  expect(applyJobCorrection as jest.Mock).not.toHaveBeenCalled();
});

// ─── edit date: invalid inputs ────────────────────────────────────────────────

it('correction: edit date — ISO format rejected (must be DD/MM/YYYY)', async () => {
  seedJob(JOB_ID, { totalAmount: 500, currency: 'ILS', driveLink: '' });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('📅 תאריך');

  await sim.sendMessage('2024-03-15'); // ISO format — not accepted

  expect(applyJobCorrection as jest.Mock).not.toHaveBeenCalled();
  expect(clearCorrectionPending as jest.Mock).not.toHaveBeenCalled();
});

it('correction: edit date — impossible date rejected (Feb 31)', async () => {
  seedJob(JOB_ID, { totalAmount: 500, currency: 'ILS', driveLink: '' });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('📅 תאריך');

  await sim.sendMessage('31/02/2024');

  expect(applyJobCorrection as jest.Mock).not.toHaveBeenCalled();
  expect(clearCorrectionPending as jest.Mock).not.toHaveBeenCalled();
});

// ─── edit vendor: invalid input ───────────────────────────────────────────────

it('correction: edit vendor — whitespace-only rejected', async () => {
  seedJob(JOB_ID, { totalAmount: 500, currency: 'ILS', driveLink: '' });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  await sim.clickProcessButton('🏢 ספק');

  await sim.sendMessage('   ');

  expect(applyJobCorrection as jest.Mock).not.toHaveBeenCalled();
  expect(clearCorrectionPending as jest.Mock).not.toHaveBeenCalled();
});

// ─── edit_cancel ──────────────────────────────────────────────────────────────

it('correction: edit_cancel restores original message and clears pending', async () => {
  seedJob(JOB_ID, {
    totalAmount: 500,
    currency: 'ILS',
    driveLink: 'https://drive.google.com/test',
    invoiceDate: '2024-01-01',
  });

  await sim.sendEditCallback(JOB_ID, SUCCESS_MSG_ID);
  sim.expectButtons(['💰 סכום', '📅 תאריך', '🏢 ספק', '✖ ביטול']);

  const res = await sim.clickProcessButton('✖ ביטול');
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('edit_cancel');

  // Original success message should be restored with the Edit button
  expect(telegramService.editMessageText as jest.Mock).toHaveBeenCalled();
  const [, , , opts] = (telegramService.editMessageText as jest.Mock).mock.calls.at(-1)!;
  expect(opts?.replyMarkup?.inline_keyboard).toBeDefined();
  const editBtn = opts.replyMarkup.inline_keyboard
    .flat()
    .find((b: { text: string }) => b.text === '✏️ ערוך פרטים');
  expect(editBtn).toBeDefined();

  // Pending cleared
  expect(clearCorrectionPending as jest.Mock).toHaveBeenCalledWith(JOB_ID);
});

// ─── no pending correction ────────────────────────────────────────────────────

it('correction: message with no correction pending → no_session (normal invoice flow)', async () => {
  // No job seeded, no pending correction
  const res = await sim.sendMessage('random text');
  expect(res.status).toBe(200);
  // No pending correction → falls through to session check → no session
  expect(res.body.action).toBe('no_session');
  expect(applyJobCorrection as jest.Mock).not.toHaveBeenCalled();
});

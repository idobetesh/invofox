/**
 * Receipt flow tests — end-to-end conversation tests for receipt creation.
 *
 * These tests run the REAL session service code against an in-memory Firestore,
 * record every Telegram call, and click buttons from the ACTUAL keyboard the
 * bot sends — not hard-coded callback data.
 *
 * The partial-payment test verifies that handleConfirmSelection asks for the
 * payment amount before showing the payment-method keyboard, and that the
 * receipt is created correctly based on that amount.
 */

// ─── Module mocks (must be before imports) ──────────────────────────────────

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
  getCorrectionPendingJob: jest.fn().mockResolvedValue(null),
  applyJobCorrection: jest.fn().mockResolvedValue(undefined),
  clearCorrectionPending: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/telegram.service', () => ({
  sendMessage: jest.fn(),
  editMessageText: jest.fn(),
  editMessageReplyMarkup: jest.fn(),
  sendDocument: jest.fn(),
  answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/document-generator', () => ({
  generateInvoice: jest.fn(),
  getGeneratedInvoice: jest.fn(),
}));

jest.mock('../../src/services/customer/user-mapping.service', () => ({
  getUserCustomers: jest.fn(),
  updateUserActivity: jest.fn().mockResolvedValue(undefined),
  addUserToCustomer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/correction.service', () => ({
  handleCorrectionInput: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { isEnabled: jest.fn().mockReturnValue(false), destroy: jest.fn() },
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import * as telegramService from '../../src/services/telegram.service';
import * as userMappingService from '../../src/services/customer/user-mapping.service';
import { generateInvoice, getGeneratedInvoice } from '../../src/services/document-generator';
import { getFirestore } from '../../src/services/firestore.service';
import { InMemoryFirestore } from './helpers/in-memory-firestore';
import {
  TelegramCapture,
  ConversationSimulator,
  setupTelegramMock,
} from './helpers/conversation-simulator';
import {
  CHAT_ID,
  USER_ID,
  USERNAME,
  seedOpenInvoice,
  seedOpenInvoices,
  invoiceButtonText,
  sessionDocId,
} from './helpers/test-data';
import app from '../../src/app';

// ─── Test setup ──────────────────────────────────────────────────────────────

let db: InMemoryFirestore;
let capture: TelegramCapture;
let sim: ConversationSimulator;

beforeEach(() => {
  db = new InMemoryFirestore();
  (getFirestore as jest.Mock).mockReturnValue(db);

  capture = new TelegramCapture();
  setupTelegramMock(telegramService as unknown as Record<string, jest.Mock>, capture);

  // Mock user has access to the test chat
  (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([{ chatId: CHAT_ID }]);

  // Default: getGeneratedInvoice reads from InMemoryFirestore
  (getGeneratedInvoice as jest.Mock).mockImplementation(
    async (chatId: number, invoiceNumber: string) =>
      db.peek('generated_invoices', `chat_${chatId}_${invoiceNumber}`)
  );

  // Default: generateInvoice returns a stub (full generation is not tested here)
  (generateInvoice as jest.Mock).mockResolvedValue({
    invoiceNumber: 'R-2026-1',
    pdfUrl: 'https://test.example.com/R-2026-1.pdf',
    pdfBuffer: Buffer.from('fake-pdf-content'),
  });

  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Receipt: partial payment (the reported bug) ─────────────────────────────

/**
 * BUG: handleConfirmSelection immediately sends the payment-method keyboard
 * instead of first asking for the amount to pay. This makes partial payments
 * impossible via the multi-invoice flow.
 *
 * EXPECTED (after fix):
 *   confirm_selection → ask for amount → user enters partial → payment keyboard
 *
 * CURRENTLY FAILS at step 4 (sim.expectButtons([])) because the payment-method
 * keyboard is shown right after selection confirmation.
 */
it('receipt: partial payment — bot asks for amount before payment method', async () => {
  // Seed: one open invoice for ₪500
  seedOpenInvoice(db, CHAT_ID, {
    invoiceNumber: 'I-2024-001',
    customerName: 'Test Customer',
    amount: 500,
  });

  const invoiceBtn = invoiceButtonText('I-2024-001', 'Test Customer', 500);

  // Step 1: /new command → document type keyboard
  await sim.sendCommand('/new');
  sim.expectButtons(['חשבונית', 'חשבונית-קבלה', 'קבלה']);

  // Step 2: Select Receipt → invoice list keyboard
  await sim.clickButton('קבלה');
  sim.expectButtons([invoiceBtn]);

  // Step 3: Toggle invoice selection → selection updated, continue button appears
  await sim.clickButton(invoiceBtn);
  sim.expectButtons(['▶️ המשך עם חשבונית זו']);

  // Step 4: Confirm selection
  // EXPECTED (fixed): bot asks for amount, NO payment-method keyboard yet
  // CURRENTLY FAILS: payment-method keyboard is shown immediately (the bug)
  await sim.clickButton('▶️ המשך עם חשבונית זו');
  sim.expectMessageContains('הכנס סכום'); // "Enter amount" — fails until bug is fixed
  sim.expectButtons([]); // no inline buttons while waiting for amount text

  // Step 5: Enter partial amount — THE BUG was here
  const res = await sim.sendMessage('250');
  expect(res.status).toBe(200);

  const sessionAfterAmount = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(sessionAfterAmount?.amount).toBe(250);

  // Now payment method keyboard should appear
  sim.expectButtons(['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק']);

  // Step 6: Select payment method → confirmation keyboard
  await sim.clickButton('מזומן');
  sim.expectButtons(['✅ אשר וצור', '❌ בטל']);

  // Step 7: Confirm → PDF generated, session deleted
  await sim.clickButton('✅ אשר וצור');
  expect(telegramService.sendDocument as jest.Mock).toHaveBeenCalled();
  expect(db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID))).toBeNull();
});

// ─── Receipt: full payment ────────────────────────────────────────────────────

it('receipt: full payment — amount = remainingBalance', async () => {
  seedOpenInvoice(db, CHAT_ID, {
    invoiceNumber: 'I-2024-002',
    customerName: 'Full Pay Customer',
    amount: 1000,
  });

  const invoiceBtn = invoiceButtonText('I-2024-002', 'Full Pay Customer', 1000);

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');
  sim.expectButtons([invoiceBtn]);

  await sim.clickButton(invoiceBtn);
  sim.expectButtons(['▶️ המשך עם חשבונית זו']);

  await sim.clickButton('▶️ המשך עם חשבונית זו');
  sim.expectButtons([]); // amount prompt shown

  // Enter the full amount
  await sim.sendMessage('1000');
  const session = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(session?.amount).toBe(1000);

  sim.expectButtons(['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק']);

  await sim.clickButton('ביט');
  sim.expectButtons(['✅ אשר וצור', '❌ בטל']);

  await sim.clickButton('✅ אשר וצור');
  expect(telegramService.sendDocument as jest.Mock).toHaveBeenCalled();
  expect(db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID))).toBeNull();
});

// ─── Receipt: amount > remainingBalance ───────────────────────────────────────

it('receipt: amount too high — shows error, stays in awaiting_payment', async () => {
  seedOpenInvoice(db, CHAT_ID, {
    invoiceNumber: 'I-2024-003',
    customerName: 'Overpay Customer',
    amount: 300,
  });

  const invoiceBtn = invoiceButtonText('I-2024-003', 'Overpay Customer', 300);

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');
  await sim.clickButton(invoiceBtn);
  await sim.clickButton('▶️ המשך עם חשבונית זו');
  sim.expectButtons([]);

  // Enter amount larger than the invoice balance (300 + 1 = 301)
  const res = await sim.sendMessage('301');
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('amount_too_high');

  // Session amount should NOT have been updated
  const session = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(session?.amount).not.toBe(301);

  // Still in awaiting_payment — no payment keyboard yet
  sim.expectButtons([]);
});

// ─── Receipt: cancel flow ─────────────────────────────────────────────────────

it('receipt: cancel during invoice selection deletes session', async () => {
  seedOpenInvoice(db, CHAT_ID, {
    invoiceNumber: 'I-2024-004',
    customerName: 'Cancel Customer',
    amount: 200,
  });

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');
  await sim.clickButton('❌ בטל');

  // Session should be deleted after cancel
  expect(db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID))).toBeNull();
});

// ─── Receipt: no open invoices ────────────────────────────────────────────────

it('receipt: no open invoices — session deleted, user informed', async () => {
  // No invoices seeded → empty database

  await sim.sendCommand('/new');
  sim.expectButtons(['חשבונית', 'חשבונית-קבלה', 'קבלה']);

  const res = await sim.clickButton('קבלה');
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('no_open_invoices');

  // Session should be deleted since there's nothing to work with
  expect(db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID))).toBeNull();
});

// ─── Receipt: multi-invoice selection ────────────────────────────────────────

it('receipt: multi-invoice — confirm button says "המשך עם הבחירה"', async () => {
  seedOpenInvoices(db, CHAT_ID, [
    { invoiceNumber: 'I-2024-010', customerName: 'Multi Customer', amount: 300 },
    { invoiceNumber: 'I-2024-011', customerName: 'Multi Customer', amount: 400 },
  ]);

  const btn1 = invoiceButtonText('I-2024-010', 'Multi Customer', 300);
  const btn2 = invoiceButtonText('I-2024-011', 'Multi Customer', 400);

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');

  // Toggle first invoice
  await sim.clickButton(btn1);
  // After first selection: single-invoice confirm button
  sim.expectButtons(['▶️ המשך עם חשבונית זו']);

  // Toggle second invoice (not yet selected — no prefix)
  await sim.clickButton(btn2);

  // After two selections: multi-invoice confirm button
  sim.expectButtons(['▶️ המשך עם הבחירה']);
});

// ─── Receipt: multi-invoice full happy path ───────────────────────────────────

it('receipt: multi-invoice full happy path — confirm → amount → payment → PDF', async () => {
  seedOpenInvoices(db, CHAT_ID, [
    { invoiceNumber: 'I-2024-030', customerName: 'Happy Corp', amount: 300 },
    { invoiceNumber: 'I-2024-031', customerName: 'Happy Corp', amount: 400 },
  ]);

  const btn1 = invoiceButtonText('I-2024-030', 'Happy Corp', 300);
  const btn2 = invoiceButtonText('I-2024-031', 'Happy Corp', 400);

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');

  // Select both invoices
  await sim.clickButton(btn1);
  await sim.clickButton(btn2);
  sim.expectButtons(['▶️ המשך עם הבחירה']);

  // Confirm multi-invoice selection → amount prompt (no payment keyboard yet)
  await sim.clickButton('▶️ המשך עם הבחירה');
  sim.expectMessageContains('הכנס סכום');
  sim.expectButtons([]);

  // Enter amount (700 = total of both invoices)
  await sim.sendMessage('700');
  const session = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(session?.amount).toBe(700);

  // Payment method keyboard shown
  sim.expectButtons(['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק']);

  // Select payment method → confirmation
  await sim.clickButton('מזומן');
  sim.expectButtons(['✅ אשר וצור', '❌ בטל']);

  // Confirm → PDF generated, session deleted
  await sim.clickButton('✅ אשר וצור');
  expect(telegramService.sendDocument as jest.Mock).toHaveBeenCalled();
  expect(db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID))).toBeNull();
});

// ─── Receipt: invalid amount input ────────────────────────────────────────────

it('receipt: non-numeric amount — invalid_amount response, session stays open', async () => {
  seedOpenInvoice(db, CHAT_ID, {
    invoiceNumber: 'I-2024-040',
    customerName: 'Invalid Amount Customer',
    amount: 500,
  });

  const invoiceBtn = invoiceButtonText('I-2024-040', 'Invalid Amount Customer', 500);

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');
  await sim.clickButton(invoiceBtn);
  await sim.clickButton('▶️ המשך עם חשבונית זו');
  sim.expectButtons([]);

  const res = await sim.sendMessage('not-a-number');
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('invalid_amount');

  // Session still in awaiting_payment, amount unchanged
  const session = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(session?.status).toBe('awaiting_payment');
  sim.expectButtons([]);
});

it('receipt: amount = 0 — invalid_amount response', async () => {
  seedOpenInvoice(db, CHAT_ID, {
    invoiceNumber: 'I-2024-041',
    customerName: 'Zero Amount Customer',
    amount: 500,
  });

  const invoiceBtn = invoiceButtonText('I-2024-041', 'Zero Amount Customer', 500);

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');
  await sim.clickButton(invoiceBtn);
  await sim.clickButton('▶️ המשך עם חשבונית זו');

  const res = await sim.sendMessage('0');
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('invalid_amount');

  const session = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(session?.status).toBe('awaiting_payment');
});

// ─── Receipt: customer mismatch ───────────────────────────────────────────────

it('receipt: customer mismatch — second invoice rejected', async () => {
  seedOpenInvoices(db, CHAT_ID, [
    { invoiceNumber: 'I-2024-020', customerName: 'Customer A', amount: 200 },
    { invoiceNumber: 'I-2024-021', customerName: 'Customer B', amount: 300 },
  ]);

  const btn1 = invoiceButtonText('I-2024-020', 'Customer A', 200);

  await sim.sendCommand('/new');
  await sim.clickButton('קבלה');
  await sim.clickButton(btn1); // select first invoice

  // Attempt to toggle a different-customer invoice via callback directly
  // (button should show ⛔ prefix and have 'noop' callback_data)
  const btn2 = invoiceButtonText('I-2024-021', 'Customer B', 300);
  const cb = capture.getButtonCallbackData(`⛔ ${btn2}`);
  // ⛔ buttons are disabled (noop) — no valid callback data
  expect(cb).toBeNull();
});

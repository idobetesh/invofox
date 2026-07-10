/**
 * Invoice-Receipt (חשבונית-קבלה) flow tests.
 *
 * Invoice-receipt combines invoice + payment into one document.
 * Flow: select type → enter details → select payment method → confirm → generate
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

// ─── Imports ────────────────────────────────────────────────────────────────

import * as telegramService from '../../src/services/telegram.service';
import * as userMappingService from '../../src/services/customer/user-mapping.service';
import { generateInvoice } from '../../src/services/document-generator';
import { getFirestore } from '../../src/services/firestore.service';
import { InMemoryFirestore } from './helpers/in-memory-firestore';
import {
  TelegramCapture,
  ConversationSimulator,
  setupTelegramMock,
} from './helpers/conversation-simulator';
import { CHAT_ID, USER_ID, USERNAME, sessionDocId } from './helpers/test-data';
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

// ─── Setup ───────────────────────────────────────────────────────────────────

let db: InMemoryFirestore;
let capture: TelegramCapture;
let sim: ConversationSimulator;

beforeEach(() => {
  db = new InMemoryFirestore();
  (getFirestore as jest.Mock).mockReturnValue(db);

  capture = new TelegramCapture();
  setupTelegramMock(telegramService as unknown as Record<string, jest.Mock>, capture);

  (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([{ chatId: CHAT_ID }]);

  (generateInvoice as jest.Mock).mockResolvedValue({
    invoiceNumber: 'IR-2026-1',
    pdfUrl: 'https://test.example.com/IR-2026-1.pdf',
    pdfBuffer: Buffer.from('fake-invoice-receipt-pdf'),
  });

  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Invoice-Receipt: happy path ──────────────────────────────────────────────

it('invoice-receipt: full flow — details + payment method → PDF sent', async () => {
  // Step 1: Start new document
  await sim.sendCommand('/new');
  sim.expectButtons(['חשבונית', 'חשבונית-קבלה', 'קבלה']);

  // Step 2: Select invoice-receipt
  const res = await sim.clickButton('חשבונית-קבלה');
  expect(res.status).toBe(200);

  // Session should be in awaiting_details
  const sessionAfterType = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(sessionAfterType?.status).toBe('awaiting_details');
  expect(sessionAfterType?.documentType).toBe('invoice_receipt');

  // Step 3: Enter details
  const detailsRes = await sim.sendMessage('Tech Corp, 12000, Software development');
  expect(detailsRes.status).toBe(200);

  // Invoice-receipt requires payment method
  // Session should be in awaiting_payment (not confirming)
  const sessionAfterDetails = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(sessionAfterDetails?.status).toBe('awaiting_payment');
  expect(sessionAfterDetails?.customerName).toBe('Tech Corp');
  expect(sessionAfterDetails?.amount).toBe(12000);

  // Payment method keyboard should be shown
  sim.expectButtons(['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק']);

  // Step 4: Select payment method
  await sim.clickButton('העברה');

  const sessionAfterPayment = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(sessionAfterPayment?.status).toBe('confirming');
  expect(sessionAfterPayment?.paymentMethod).toBe('העברה');

  // Confirmation keyboard should be shown
  sim.expectButtons(['✅ אשר וצור', '❌ בטל']);

  // Step 5: Confirm → PDF
  await sim.clickButton('✅ אשר וצור');
  expect(telegramService.sendDocument as jest.Mock).toHaveBeenCalled();
  expect(db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID))).toBeNull();
});

// ─── Invoice-Receipt: all payment methods available ───────────────────────────

it('invoice-receipt: all 6 payment methods available in keyboard', async () => {
  await sim.sendCommand('/new');
  await sim.clickButton('חשבונית-קבלה');
  await sim.sendMessage('Test Co, 500, Test service');

  // All 6 payment methods should be available
  const visible = capture.getVisibleButtons();
  expect(visible).toContain('מזומן');
  expect(visible).toContain('ביט');
  expect(visible).toContain('PayBox');
  expect(visible).toContain('העברה');
  expect(visible).toContain('אשראי');
  expect(visible).toContain('צ׳ק');
});

// ─── Invoice-Receipt: cancel after payment method ─────────────────────────────

it('invoice-receipt: cancel at confirmation — session deleted', async () => {
  await sim.sendCommand('/new');
  await sim.clickButton('חשבונית-קבלה');
  await sim.sendMessage('Cancel Co, 800, Service');
  await sim.clickButton('מזומן');

  sim.expectButtons(['✅ אשר וצור', '❌ בטל']);
  await sim.clickButton('❌ בטל');

  expect(db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID))).toBeNull();
});

// ─── Invoice-Receipt: invalid details format ──────────────────────────────────

it('invoice-receipt: invalid details format — error response, session stays in awaiting_details', async () => {
  await sim.sendCommand('/new');
  await sim.clickButton('חשבונית-קבלה');

  // Session should be awaiting_details
  const sessionBefore = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(sessionBefore?.status).toBe('awaiting_details');

  // Send malformed details (missing required fields)
  const res = await sim.sendMessage('just some text without the right format');
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('invalid_format');

  // Session should still be in awaiting_details — not advanced
  const sessionAfter = db.peek('invoice_sessions', sessionDocId(CHAT_ID, USER_ID));
  expect(sessionAfter?.status).toBe('awaiting_details');
  expect(sessionAfter?.documentType).toBe('invoice_receipt');
});

// ─── Invoice-Receipt: generateInvoice called with correct session data ────────

it('invoice-receipt: generateInvoice receives correct session data', async () => {
  await sim.sendCommand('/new');
  await sim.clickButton('חשבונית-קבלה');
  await sim.sendMessage('Data Co, 7500, Analysis work');
  await sim.clickButton('אשראי');
  await sim.clickButton('✅ אשר וצור');

  expect(generateInvoice as jest.Mock).toHaveBeenCalledTimes(1);
  const [sessionArg, userIdArg, , chatIdArg] = (generateInvoice as jest.Mock).mock.calls[0];

  expect(sessionArg.documentType).toBe('invoice_receipt');
  expect(sessionArg.customerName).toBe('Data Co');
  expect(sessionArg.amount).toBe(7500);
  expect(sessionArg.paymentMethod).toBe('אשראי');
  expect(sessionArg.status).toBe('confirming');
  expect(userIdArg).toBe(USER_ID);
  expect(chatIdArg).toBe(CHAT_ID);
});

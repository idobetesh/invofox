/**
 * NL document creation flow tests (mocked LLM)
 */

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
}));

jest.mock('../../src/services/telegram.service', () => ({
  sendMessage: jest.fn(),
  editMessageText: jest.fn(),
  editMessageReplyMarkup: jest.fn(),
  sendDocument: jest.fn(),
  answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
  downloadFileById: jest.fn(),
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

jest.mock('../../src/services/document-generator/document-intent', () => ({
  parseDocumentIntentFromText: jest.fn(),
  parseDocumentIntentFromAudio: jest.fn(),
  computeMissingFields: jest.requireActual(
    '../../src/services/document-generator/document-intent/missing-fields'
  ).computeMissingFields,
  hasBlockingMissingFields: jest.requireActual(
    '../../src/services/document-generator/document-intent/missing-fields'
  ).hasBlockingMissingFields,
  parseFieldEdit: jest.requireActual(
    '../../src/services/document-generator/document-intent/field-parser'
  ).parseFieldEdit,
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { getValue: jest.fn().mockResolvedValue(true), destroy: jest.fn() },
}));

import * as telegramService from '../../src/services/telegram.service';
import * as userMappingService from '../../src/services/customer/user-mapping.service';
import { generateInvoice } from '../../src/services/document-generator';
import { getFirestore } from '../../src/services/firestore.service';
import { parseDocumentIntentFromText } from '../../src/services/document-generator/document-intent';
import { InMemoryFirestore } from './helpers/in-memory-firestore';
import {
  TelegramCapture,
  ConversationSimulator,
  setupTelegramMock,
} from './helpers/conversation-simulator';
import { CHAT_ID, USER_ID, USERNAME } from './helpers/test-data';
import app from '../../src/app';

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
    pdfBuffer: Buffer.from('fake-pdf'),
  });
  (parseDocumentIntentFromText as jest.Mock).mockResolvedValue({
    intent: {
      documentType: 'invoice_receipt',
      customerName: 'משה',
      amount: 300,
      description: 'ספר',
      currency: 'ILS',
      customerTaxId: null,
      paymentMethod: null,
      transcript: 'תוציא לי חשבונית קבלה למשה על ספר בסכום של 300 שח',
      confidence: 0.95,
      missingFields: ['paymentMethod'],
    },
    usage: { provider: 'gemini', totalTokens: 100, costUSD: 0.001 },
  });
  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);
});

describe('NL document flow', () => {
  it('parses text intent, asks for payment, then confirms and generates', async () => {
    await sim.sendCommand('/new');
    expect(capture.getLastMessageText()).toContain('שפה טבעית');

    await sim.sendMessage('תוציא לי חשבונית קבלה למשה על ספר בסכום של 300 שח');
    expect(capture.getLastMessageText()).toContain('איך התקבל התשלום');

    await sim.clickButton('מזומן');
    expect(capture.getVisibleButtons()).toEqual(expect.arrayContaining(['✅ המשך לאישור']));

    await sim.clickButton('✅ המשך לאישור');
    expect(capture.getVisibleButtons()).toEqual(expect.arrayContaining(['✅ אשר וצור']));

    await sim.clickButton('✅ אשר וצור');
    expect(capture.wasSendDocumentCalled()).toBe(true);
    expect(generateInvoice).toHaveBeenCalled();
  });
});

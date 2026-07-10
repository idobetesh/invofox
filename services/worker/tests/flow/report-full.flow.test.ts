/**
 * Full report generation flow tests.
 *
 * Tests the complete sequence: /report → type selection → date selection → format selection → file sent.
 *
 * report-flow.service and report-session.service run with REAL code.
 * Data retrieval (generateReportData) and PDF generation are mocked.
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

// ─── Imports ────────────────────────────────────────────────────────────────

import request from 'supertest';
import * as telegramService from '../../src/services/telegram.service';
import * as userMappingService from '../../src/services/customer/user-mapping.service';
import * as reportCore from '../../src/services/report/core';
import * as reportGenerators from '../../src/services/report/generators';
import * as businessConfigService from '../../src/services/business-config/config.service';
import { getFirestore } from '../../src/services/firestore.service';
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

jest.mock('../../src/services/customer/user-mapping.service', () => ({
  getUserCustomers: jest.fn(),
  updateUserActivity: jest.fn().mockResolvedValue(undefined),
}));

// Mock report/core data layer — avoid real Firestore invoice queries
jest.mock('../../src/services/report/core', () => ({
  getDateRangeForPreset: jest.fn().mockReturnValue({ start: '2026-01-01', end: '2026-01-31' }),
  generateReportData: jest.fn(),
  formatDate: jest.fn((d: string) => d),
  getEarliestInvoiceDate: jest.fn().mockResolvedValue(null),
  getInvoicesForReport: jest.fn().mockResolvedValue([]),
  calculateMetrics: jest.fn().mockReturnValue({}),
  calculateBalanceMetrics: jest.fn().mockReturnValue({}),
}));

// Mock report/generators — avoid real PDF/Excel generation
jest.mock('../../src/services/report/generators', () => ({
  generatePDFReport: jest.fn(),
  generateExcelReport: jest.fn(),
  generateCSVReport: jest.fn(),
  getCurrencySymbol: jest.fn().mockReturnValue('₪'),
}));

// Mock business config — no real Firestore read
jest.mock('../../src/services/business-config/config.service', () => ({
  getBusinessConfig: jest.fn(),
  getLogoBase64: jest.fn().mockResolvedValue(null),
  hasBusinessConfig: jest.fn().mockResolvedValue(true),
  saveBusinessConfig: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { isEnabled: jest.fn().mockReturnValue(false), destroy: jest.fn() },
}));

// Mock dedup service — never duplicate
jest.mock('../../src/services/report/report-dedup.service', () => ({
  isCallbackProcessed: jest.fn().mockResolvedValue(false),
  markCallbackProcessed: jest.fn().mockResolvedValue(undefined),
}));

// Mock rate limiter — always allow
jest.mock('../../src/services/report/report-rate-limiter.service', () => ({
  checkReportLimit: jest.fn().mockResolvedValue({ allowed: true }),
  recordReportGeneration: jest.fn().mockResolvedValue(undefined),
}));

// ─── Setup ───────────────────────────────────────────────────────────────────

let db: InMemoryFirestore;
let capture: TelegramCapture;
let sim: ConversationSimulator;

const FAKE_PDF = Buffer.from('fake-report-pdf');
const FAKE_REPORT_DATA = {
  invoices: [
    { vendorName: 'Acme Corp', totalAmount: 500, invoiceDate: '2026-01-15' },
    { vendorName: 'Tech Ltd', totalAmount: 1200, invoiceDate: '2026-01-20' },
  ],
  metrics: {
    invoicedCount: 2,
    totalInvoiced: 1700,
    avgInvoiced: 850,
    totalReceived: 1700,
    totalOutstanding: 0,
    totalExpenses: 0,
    currencies: [{ currency: 'ILS', total: 1700, count: 2 }],
  },
  balanceMetrics: {},
  businessName: 'My Business',
  dateRange: { start: '2026-01-01', end: '2026-01-31' },
  reportType: 'revenue' as const,
  logoBase64: null,
};

beforeEach(() => {
  db = new InMemoryFirestore();
  (getFirestore as jest.Mock).mockReturnValue(db);

  capture = new TelegramCapture();
  setupTelegramMock(telegramService as unknown as Record<string, jest.Mock>, capture);

  (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([{ chatId: CHAT_ID }]);
  (businessConfigService.getBusinessConfig as jest.Mock).mockResolvedValue({
    business: { name: 'My Business', logoUrl: null },
  });
  (reportCore.generateReportData as jest.Mock).mockResolvedValue(FAKE_REPORT_DATA);
  (reportGenerators.generatePDFReport as jest.Mock).mockResolvedValue(FAKE_PDF);

  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Helper to send a /report/callback ────────────────────────────────────────

function sendReportCallback(
  sessionId: string,
  data: Record<string, unknown>,
  callbackId = 'cbq_report'
) {
  return request(app)
    .post('/report/callback')
    .send({
      callback_query: {
        id: callbackId,
        from: { id: USER_ID, is_bot: false, first_name: 'Test' },
        message: {
          message_id: 10,
          chat: { id: CHAT_ID, type: 'supergroup' },
          date: Date.now() / 1000,
        },
        chat_instance: 'test',
        data: JSON.stringify({ ...data, s: sessionId }),
      },
      update_id: Math.floor(Math.random() * 1000000),
    });
}

// ─── Full report flow: type → date → format → PDF sent ───────────────────────

it('report-full: complete flow — type → date → format → sendDocument called', async () => {
  // Step 1: /report command — creates session
  const cmdRes = await sim.sendReportCommand();
  expect(cmdRes.status).toBe(200);
  expect(cmdRes.body.action).toBe('session_created');
  const sessionId = cmdRes.body.sessionId as string;
  expect(sessionId).toBeDefined();

  // Session in 'type' step
  const sessionAfterCmd = db.peek('report_sessions', sessionId);
  expect(sessionAfterCmd?.currentStep).toBe('type');
  expect(sessionAfterCmd?.status).toBe('active');

  // Step 2: type selection — revenue
  const typeRes = await sendReportCallback(sessionId, { a: 'type', v: 'rev' }, 'cbq_type');
  expect(typeRes.status).toBe(200);

  // Session advances to 'date' step
  const sessionAfterType = db.peek('report_sessions', sessionId);
  expect(sessionAfterType?.currentStep).toBe('date');
  expect(sessionAfterType?.reportType).toBe('revenue');

  // Step 3: date selection — this_month
  const dateRes = await sendReportCallback(sessionId, { a: 'date', v: 'tm' }, 'cbq_date');
  expect(dateRes.status).toBe(200);

  // generateReportData was called to check if there are invoices
  expect(reportCore.generateReportData as jest.Mock).toHaveBeenCalled();

  // Session advances to 'format' step
  const sessionAfterDate = db.peek('report_sessions', sessionId);
  expect(sessionAfterDate?.currentStep).toBe('format');
  expect(sessionAfterDate?.datePreset).toBe('this_month');

  // Step 4: format selection — PDF
  const fmtRes = await sendReportCallback(sessionId, { a: 'fmt', v: 'pdf' }, 'cbq_fmt');
  expect(fmtRes.status).toBe(200);

  // PDF was generated
  expect(reportGenerators.generatePDFReport as jest.Mock).toHaveBeenCalled();

  // sendDocument was called — report delivered to user
  expect(telegramService.sendDocument as jest.Mock).toHaveBeenCalled();

  // Session marked as completed (currentStep stays 'generating' — last step before done)
  const sessionAfterFmt = db.peek('report_sessions', sessionId);
  expect(sessionAfterFmt?.status).toBe('completed');
});

// ─── No invoices for date range — session cancelled ───────────────────────────

it('report-full: no invoices in period — session cancelled, no format step', async () => {
  // Override: no invoices found for this period
  (reportCore.generateReportData as jest.Mock).mockResolvedValue({
    ...FAKE_REPORT_DATA,
    invoices: [],
    metrics: { invoicedCount: 0, totalInvoiced: 0, averageInvoice: 0, currency: 'ILS' },
  });

  const cmdRes = await sim.sendReportCommand();
  const sessionId = cmdRes.body.sessionId as string;

  // Select type
  await sendReportCallback(sessionId, { a: 'type', v: 'rev' }, 'cbq_type');

  // Select date — but no invoices
  const dateRes = await sendReportCallback(sessionId, { a: 'date', v: 'tm' }, 'cbq_date');
  expect(dateRes.status).toBe(200);

  // Session should be deleted (cancelReportSession deletes the doc)
  expect(db.peek('report_sessions', sessionId)).toBeNull();

  // PDF should NOT have been generated
  expect(reportGenerators.generatePDFReport as jest.Mock).not.toHaveBeenCalled();
  expect(telegramService.sendDocument as jest.Mock).not.toHaveBeenCalled();
});

// ─── Excel format ─────────────────────────────────────────────────────────────

it('report-full: excel format — generateExcelReport called', async () => {
  const FAKE_XLSX = Buffer.from('fake-excel-data');
  (reportGenerators.generateExcelReport as jest.Mock).mockResolvedValue(FAKE_XLSX);

  const cmdRes = await sim.sendReportCommand();
  const sessionId = cmdRes.body.sessionId as string;

  await sendReportCallback(sessionId, { a: 'type', v: 'rev' }, 'cbq_type');
  await sendReportCallback(sessionId, { a: 'date', v: 'tm' }, 'cbq_date');
  const fmtRes = await sendReportCallback(sessionId, { a: 'fmt', v: 'xls' }, 'cbq_fmt');

  expect(fmtRes.status).toBe(200);
  expect(reportGenerators.generateExcelReport as jest.Mock).toHaveBeenCalled();
  expect(telegramService.sendDocument as jest.Mock).toHaveBeenCalled();

  // Verify filename contains xlsx
  const [, , filename] = (telegramService.sendDocument as jest.Mock).mock.calls[0];
  expect(filename).toContain('.xlsx');
});

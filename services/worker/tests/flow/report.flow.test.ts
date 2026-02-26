/**
 * Report generation flow tests.
 *
 * Tests the /report command flow: type selection → date selection → format selection → file sent.
 *
 * Report generation (actual file creation) is mocked.
 * Session management and rate limiting run against InMemoryFirestore.
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

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

// Mock the report generation service to avoid real file creation
jest.mock('../../src/services/report/report-flow.service', () => ({
  handleTypeSelection: jest.fn(),
  handleDateSelection: jest.fn(),
  handleFormatSelection: jest.fn(),
  handleCancelAction: jest.fn(),
}));

// Mock rate limiter — always allow
jest.mock('../../src/services/report/report-rate-limiter.service', () => ({
  checkReportLimit: jest.fn().mockResolvedValue({ allowed: true }),
  recordReportGeneration: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { isEnabled: jest.fn().mockReturnValue(false), destroy: jest.fn() },
}));

// Mock dedup service — never duplicate
jest.mock('../../src/services/report/report-dedup.service', () => ({
  isCallbackProcessed: jest.fn().mockResolvedValue(false),
  markCallbackProcessed: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import request from 'supertest';
import * as telegramService from '../../src/services/telegram.service';
import * as userMappingService from '../../src/services/customer/user-mapping.service';
import * as reportFlowService from '../../src/services/report/report-flow.service';
import { getFirestore } from '../../src/services/firestore.service';
import { InMemoryFirestore } from './helpers/in-memory-firestore';
import {
  TelegramCapture,
  ConversationSimulator,
  setupTelegramMock,
} from './helpers/conversation-simulator';
import { CHAT_ID, USER_ID, USERNAME } from './helpers/test-data';
import app from '../../src/app';

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

  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Report: command creates session ─────────────────────────────────────────

it('report: /report command creates a session and sends type selection', async () => {
  const res = await sim.sendReportCommand();
  expect(res.status).toBe(200);
  expect(res.body.action).toBe('session_created');

  // Session should exist in report_sessions
  const sessionId = res.body.sessionId as string;
  expect(sessionId).toBeDefined();
  expect(db.exists('report_sessions', sessionId)).toBe(true);

  const session = db.peek('report_sessions', sessionId);
  expect(session?.chatId).toBe(CHAT_ID);
  expect(session?.userId).toBe(USER_ID);
  expect(session?.status).toBe('active');
  expect(session?.currentStep).toBe('type');
});

// ─── Report: no access ────────────────────────────────────────────────────────

it('report: user without access — 403 response', async () => {
  (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
    { chatId: -999999 }, // Different chat
  ]);

  const res = await sim.sendReportCommand();
  expect(res.status).toBe(403);
  expect(res.body.error).toBe('No access');
});

// ─── Report: duplicate update ID ─────────────────────────────────────────────

it('report: duplicate /report command — skipped', async () => {
  const { isCallbackProcessed } = jest.requireMock(
    '../../src/services/report/report-dedup.service'
  );
  isCallbackProcessed.mockResolvedValueOnce(true);

  // Build the payload with an updateId
  const res = await request(app).post('/report/command').send({
    type: 'command',
    chatId: CHAT_ID,
    userId: USER_ID,
    username: USERNAME,
    firstName: 'Test',
    chatTitle: 'Test Chat',
    messageId: 1,
    text: '/report',
    updateId: 12345,
    receivedAt: new Date().toISOString(),
  });

  expect(res.status).toBe(200);
  expect(res.body.duplicate).toBe(true);
});

// ─── Report: callback routes to flow service ──────────────────────────────────

it('report: type-selection callback routes to handleTypeSelection', async () => {
  // Create a session first
  const cmdRes = await sim.sendReportCommand();
  const sessionId = cmdRes.body.sessionId as string;

  // Send a type-selection callback
  const callbackPayload = {
    callback_query: {
      id: 'cbq_report_1',
      from: { id: USER_ID, is_bot: false, first_name: 'Test' },
      message: {
        message_id: 10,
        chat: { id: CHAT_ID, type: 'supergroup' },
        date: Date.now() / 1000,
      },
      chat_instance: 'test',
      data: JSON.stringify({ a: 'type', s: sessionId, v: 'rev' }),
    },
    update_id: 99999,
  };

  const res = await request(app).post('/report/callback').send(callbackPayload);

  expect(res.status).toBe(200);
  expect(reportFlowService.handleTypeSelection as jest.Mock).toHaveBeenCalledWith(
    sessionId,
    'revenue',
    CHAT_ID,
    10,
    'cbq_report_1'
  );
});

// ─── Report: date selection callback ─────────────────────────────────────────

it('report: date-selection callback routes to handleDateSelection', async () => {
  const cmdRes = await sim.sendReportCommand();
  const sessionId = cmdRes.body.sessionId as string;

  const callbackPayload = {
    callback_query: {
      id: 'cbq_date_1',
      from: { id: USER_ID, is_bot: false, first_name: 'Test' },
      message: {
        message_id: 12,
        chat: { id: CHAT_ID, type: 'supergroup' },
        date: Date.now() / 1000,
      },
      chat_instance: 'test',
      data: JSON.stringify({ a: 'date', s: sessionId, v: 'tm' }),
    },
    update_id: 88888,
  };

  const res = await request(app).post('/report/callback').send(callbackPayload);

  expect(res.status).toBe(200);
  expect(reportFlowService.handleDateSelection as jest.Mock).toHaveBeenCalledWith(
    sessionId,
    'this_month',
    CHAT_ID,
    12,
    'cbq_date_1'
  );
});

// ─── Report: format selection callback ───────────────────────────────────────

it('report: format-selection callback routes to handleFormatSelection', async () => {
  const cmdRes = await sim.sendReportCommand();
  const sessionId = cmdRes.body.sessionId as string;

  const callbackPayload = {
    callback_query: {
      id: 'cbq_fmt_1',
      from: { id: USER_ID, is_bot: false, first_name: 'Test' },
      message: {
        message_id: 13,
        chat: { id: CHAT_ID, type: 'supergroup' },
        date: Date.now() / 1000,
      },
      chat_instance: 'test',
      data: JSON.stringify({ a: 'fmt', s: sessionId, v: 'pdf' }),
    },
    update_id: 77777,
  };

  const res = await request(app).post('/report/callback').send(callbackPayload);

  expect(res.status).toBe(200);
  expect(reportFlowService.handleFormatSelection as jest.Mock).toHaveBeenCalledWith(
    sessionId,
    'pdf',
    CHAT_ID,
    13,
    'cbq_fmt_1'
  );
});

// ─── Report: rate limit exceeded ─────────────────────────────────────────────

it('report: rate limit exceeded — 429 response, message sent to user', async () => {
  const { checkReportLimit } = jest.requireMock(
    '../../src/services/report/report-rate-limiter.service'
  );
  checkReportLimit.mockResolvedValueOnce({
    allowed: false,
    resetAt: new Date(Date.now() + 3600 * 1000),
  });

  const res = await sim.sendReportCommand();
  expect(res.status).toBe(429);
  expect(res.body.error).toBe('Rate limit exceeded');

  // User should be informed
  expect(telegramService.sendMessage as jest.Mock).toHaveBeenCalled();
});

// ─── Report: cancel action ────────────────────────────────────────────────────

it('report: cancel callback routes to handleCancelAction', async () => {
  const cmdRes = await sim.sendReportCommand();
  const sessionId = cmdRes.body.sessionId as string;

  const callbackPayload = {
    callback_query: {
      id: 'cbq_cancel',
      from: { id: USER_ID, is_bot: false, first_name: 'Test' },
      message: {
        message_id: 11,
        chat: { id: CHAT_ID, type: 'supergroup' },
        date: Date.now() / 1000,
      },
      chat_instance: 'test',
      data: JSON.stringify({ a: 'cancel', s: sessionId }),
    },
    update_id: 99998,
  };

  const res = await request(app).post('/report/callback').send(callbackPayload);

  expect(res.status).toBe(200);
  expect(reportFlowService.handleCancelAction as jest.Mock).toHaveBeenCalledWith(
    sessionId,
    CHAT_ID,
    'cbq_cancel'
  );
});

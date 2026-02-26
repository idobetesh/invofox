/**
 * Onboarding flow tests.
 *
 * Tests the /onboard command flow: language selection → business name → owner
 * details → address → logo → sheet → counter → config saved.
 *
 * Heavy external operations (cloud storage, Google Sheets) are mocked.
 * The onboarding session state machine runs against InMemoryFirestore.
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

// Mock services with external dependencies
jest.mock('../../src/services/approved-chats.service', () => ({
  isChatApproved: jest.fn().mockResolvedValue(true),
  approveChatWithInviteCode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/business-config/config.service', () => ({
  hasBusinessConfig: jest.fn().mockResolvedValue(false),
  getBusinessConfig: jest.fn(),
  getLogoBase64: jest.fn().mockResolvedValue(null),
  saveBusinessConfig: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/rate-limiter.service', () => ({
  recordFailedOnboardingAttempt: jest.fn().mockResolvedValue(undefined),
  clearRateLimit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/invite-code.service', () => ({
  validateInviteCode: jest.fn().mockResolvedValue({ valid: true }),
  markInviteCodeAsUsed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/sheets.service', () => ({
  appendGeneratedInvoiceRow: jest.fn().mockResolvedValue(undefined),
  appendOnboardingRow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/storage.service', () => ({
  getStorage: jest.fn().mockReturnValue({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue(undefined),
        makePublic: jest.fn().mockResolvedValue(undefined),
        getSignedUrl: jest.fn().mockResolvedValue(['https://test.com/logo.png']),
      }),
    }),
  }),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { isEnabled: jest.fn().mockReturnValue(false), destroy: jest.fn() },
}));

// Mock the logo step to avoid Telegram download
jest.mock('../../src/services/onboarding/steps.service', () => ({
  handleBusinessNameStep: jest.fn(),
  handleOwnerDetailsStep: jest.fn(),
  handleAddressStep: jest.fn(),
  handleLogoStep: jest.fn(),
  handleSheetStep: jest.fn(),
  handleCounterStep: jest.fn(),
  handleTaxStatusSelection: jest.fn(),
  handleCounterSelection: jest.fn(),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import * as telegramService from '../../src/services/telegram.service';
import { getFirestore } from '../../src/services/firestore.service';
import * as stepsService from '../../src/services/onboarding/steps.service';
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

  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);

  // Steps service mock: advance the session to next step when called
  (stepsService.handleBusinessNameStep as jest.Mock).mockImplementation(async (chatId: number) => {
    const collection = db.collection('onboarding_sessions');
    const doc = await collection.doc(String(chatId)).get();
    if (doc.exists) {
      await collection.doc(String(chatId)).update({ step: 'owner_details' });
    }
    await (telegramService.sendMessage as jest.Mock)(chatId, 'שלב 2: פרטי בעל העסק');
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Onboarding: command → language selection ─────────────────────────────────

it('onboard: /onboard command sends language selection keyboard', async () => {
  const res = await sim.sendOnboardCommand();
  expect(res.status).toBe(200);

  // Should send message with language selection keyboard
  expect(telegramService.sendMessage as jest.Mock).toHaveBeenCalled();
  const [, , opts] = (telegramService.sendMessage as jest.Mock).mock.calls[0];
  expect(opts?.replyMarkup?.inline_keyboard).toBeDefined();
});

// ─── Onboarding: already configured ───────────────────────────────────────────

it('onboard: already configured — sends warning, no session created', async () => {
  // Pre-configure the business
  const { hasBusinessConfig } = jest.requireMock(
    '../../src/services/business-config/config.service'
  );
  hasBusinessConfig.mockResolvedValueOnce(true);

  await sim.sendOnboardCommand();

  // Should warn user, not start onboarding
  const lastCall = (telegramService.sendMessage as jest.Mock).mock.calls[0];
  expect(lastCall[1]).toContain('already configured');

  // No onboarding session should be created
  expect(db.exists('onboarding_sessions', String(CHAT_ID))).toBe(false);
});

// ─── Onboarding: language selection → Hebrew → step advances ──────────────────

it('onboard: Hebrew language selection starts business name step', async () => {
  await sim.sendOnboardCommand();

  // Click Hebrew language button
  await sim.sendOnboardCallback('onboard_lang_he');

  // Session should be in business_name step with Hebrew language
  const session = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(session?.language).toBe('he');
  expect(session?.step).toBe('business_name');
});

// ─── Onboarding: language selection → English ────────────────────────────────

it('onboard: English language selection starts business name step', async () => {
  await sim.sendOnboardCommand();
  await sim.sendOnboardCallback('onboard_lang_en');

  const session = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(session?.language).toBe('en');
  expect(session?.step).toBe('business_name');
});

// ─── Onboarding: tax status selection ────────────────────────────────────────

it('onboard: tax_exempt callback routes to handleTaxStatusSelection', async () => {
  // Seed a session with language already set (simulates a user mid-onboarding)
  db.seed('onboarding_sessions', String(CHAT_ID), {
    step: 'tax_status',
    language: 'he',
    createdAt: { toMillis: () => Date.now() },
    updatedAt: { toMillis: () => Date.now() },
  });

  await sim.sendOnboardCallback('onboard_tax_exempt');

  expect(stepsService.handleTaxStatusSelection as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    expect.any(String), // localized tax status text
    'he'
  );
});

// ─── Onboarding: counter selection ────────────────────────────────────────────

it('onboard: counter_1 callback routes to handleCounterSelection with startFromOne=true', async () => {
  db.seed('onboarding_sessions', String(CHAT_ID), {
    step: 'counter',
    language: 'he',
    createdAt: { toMillis: () => Date.now() },
    updatedAt: { toMillis: () => Date.now() },
  });

  await sim.sendOnboardCallback('onboard_counter_1');

  expect(stepsService.handleCounterSelection as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    true,
    'he',
    expect.objectContaining({ step: 'counter', language: 'he' })
  );
});

// ─── Onboarding: business name step ──────────────────────────────────────────

it('onboard: business name message advances to owner_details step', async () => {
  await sim.sendOnboardCommand();
  await sim.sendOnboardCallback('onboard_lang_he');

  // Send business name
  await sim.sendOnboardMessage('Acme Industries');

  // handleBusinessNameStep mock advances session to owner_details
  expect(stepsService.handleBusinessNameStep as jest.Mock).toHaveBeenCalledWith(
    CHAT_ID,
    'Acme Industries',
    'he'
  );

  const session = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(session?.step).toBe('owner_details');
});

/**
 * Full onboarding happy path — all 7 steps with REAL step handlers.
 *
 * Flow:
 *   /onboard → language selection → business name → owner details →
 *   address → tax status → logo (skip) → sheet → counter_1 → config saved
 *
 * Steps service runs with REAL logic (not mocked).
 * External I/O (Sheets, Storage, Google API) is mocked.
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

// ─── Imports ────────────────────────────────────────────────────────────────

import * as telegramService from '../../src/services/telegram.service';
import * as businessConfigService from '../../src/services/business-config/config.service';
import * as userMappingService from '../../src/services/customer/user-mapping.service';
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
  downloadFileById: jest.fn(),
  getFileExtension: jest.fn().mockReturnValue('jpg'),
}));

jest.mock('../../src/services/approved-chats.service', () => ({
  isChatApproved: jest.fn().mockResolvedValue(true),
  approveChatWithInviteCode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/business-config/config.service', () => ({
  hasBusinessConfig: jest.fn().mockResolvedValue(false),
  getBusinessConfig: jest.fn().mockResolvedValue(null),
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
  updateRow: jest.fn().mockResolvedValue(undefined),
}));

// Mock sheet verification — no real Google Sheets API call
jest.mock('../../src/services/onboarding/sheet-verification.service', () => ({
  verifySheetAccess: jest.fn().mockResolvedValue(['Sheet1', 'Sheet2']),
}));

jest.mock('../../src/services/customer/user-mapping.service', () => ({
  addUserToCustomer: jest.fn().mockResolvedValue(undefined),
  getUserCustomers: jest.fn().mockResolvedValue([]),
  updateUserActivity: jest.fn().mockResolvedValue(undefined),
}));

// Mock counter initialization (called only if startingCounter > 0)
jest.mock('../../src/services/document-generator', () => ({
  generateInvoice: jest.fn(),
  getGeneratedInvoice: jest.fn(),
  initializeCounter: jest.fn().mockResolvedValue(undefined),
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
  uploadInvoiceImage: jest.fn(),
  deleteFile: jest.fn(),
}));

jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { isEnabled: jest.fn().mockReturnValue(false), destroy: jest.fn() },
}));

// ─── Setup ───────────────────────────────────────────────────────────────────

let db: InMemoryFirestore;
let capture: TelegramCapture;
let sim: ConversationSimulator;

// A valid Google Sheet URL — extractSheetId() accepts URLs matching /spreadsheets\/d\/([a-zA-Z0-9-_]+)/
const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit';

beforeEach(() => {
  db = new InMemoryFirestore();
  (getFirestore as jest.Mock).mockReturnValue(db);

  capture = new TelegramCapture();
  setupTelegramMock(telegramService as unknown as Record<string, jest.Mock>, capture);

  sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID, USERNAME);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Full 7-step onboarding happy path ───────────────────────────────────────

it('onboarding-full: complete 7-step flow — saveBusinessConfig called, session deleted', async () => {
  // Step 1: /onboard command — language keyboard
  const cmdRes = await sim.sendOnboardCommand();
  expect(cmdRes.status).toBe(200);

  // Language keyboard should be shown
  const langButtons = capture.getVisibleButtons();
  expect(langButtons.length).toBeGreaterThan(0);

  // Session created but no language set yet (step is 'language')
  const sessionAfterCmd = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(sessionAfterCmd?.step).toBe('language');

  // Step 2: select Hebrew
  await sim.sendOnboardCallback('onboard_lang_he');

  const sessionAfterLang = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(sessionAfterLang?.language).toBe('he');
  expect(sessionAfterLang?.step).toBe('business_name');

  // Step 3: business name
  await sim.sendOnboardMessage('Acme Industries');

  const sessionAfterBizName = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(sessionAfterBizName?.step).toBe('owner_details');
  expect((sessionAfterBizName?.data as Record<string, unknown>)?.businessName).toBe(
    'Acme Industries'
  );

  // Step 4: owner details (comma-separated: name, ID, phone, email)
  await sim.sendOnboardMessage('John Doe, 123456789, 0501234567, john@example.com');

  const sessionAfterOwner = db.peek('onboarding_sessions', String(CHAT_ID));
  const ownerData = sessionAfterOwner?.data as Record<string, unknown> | undefined;
  expect(sessionAfterOwner?.step).toBe('address');
  expect(ownerData?.ownerName).toBe('John Doe');
  expect(ownerData?.ownerIdNumber).toBe('123456789');
  expect(ownerData?.phone).toBe('0501234567');
  expect(ownerData?.email).toBe('john@example.com');

  // Step 5: address
  await sim.sendOnboardMessage('123 Main St, Tel Aviv');

  const sessionAfterAddress = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(sessionAfterAddress?.step).toBe('tax_status');
  expect((sessionAfterAddress?.data as Record<string, unknown>)?.address).toBe(
    '123 Main St, Tel Aviv'
  );

  // Tax status keyboard should now be visible
  const taxButtons = capture.getVisibleButtons();
  expect(taxButtons.length).toBeGreaterThan(0);

  // Step 6: tax status — exempt
  await sim.sendOnboardCallback('onboard_tax_exempt');

  const sessionAfterTax = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(sessionAfterTax?.step).toBe('logo');
  expect((sessionAfterTax?.data as Record<string, unknown>)?.taxStatus).toBeDefined();

  // Step 7: skip logo
  await sim.sendOnboardMessage('/skip');

  const sessionAfterLogo = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(sessionAfterLogo?.step).toBe('sheet');

  // Step 8: Google Sheet URL
  await sim.sendOnboardMessage(SHEET_URL);

  const sessionAfterSheet = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(sessionAfterSheet?.step).toBe('counter');
  expect((sessionAfterSheet?.data as Record<string, unknown>)?.sheetId).toBe(
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
  );

  // Counter keyboard should be visible
  const counterButtons = capture.getVisibleButtons();
  expect(counterButtons.length).toBeGreaterThan(0);

  // Step 9: counter selection — start from 1
  await sim.sendOnboardCallback('onboard_counter_1');

  // finalizeOnboarding should have been called — saveBusinessConfig + addUserToCustomer
  expect(businessConfigService.saveBusinessConfig as jest.Mock).toHaveBeenCalledWith(
    expect.objectContaining({
      language: 'he',
      business: expect.objectContaining({
        name: 'Acme Industries',
        taxId: '123456789',
        email: 'john@example.com',
        phone: '0501234567',
        address: '123 Main St, Tel Aviv',
        sheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
      }),
    }),
    CHAT_ID
  );

  expect(userMappingService.addUserToCustomer as jest.Mock).toHaveBeenCalledWith(
    USER_ID,
    'John Doe',
    CHAT_ID,
    'Acme Industries'
  );

  // Session should be deleted (completeOnboarding clears it)
  expect(db.peek('onboarding_sessions', String(CHAT_ID))).toBeNull();

  // Completion message should have been sent
  expect(telegramService.sendMessage as jest.Mock).toHaveBeenCalled();
  const lastMsg = capture.getLastMessageText();
  expect(lastMsg).toBeTruthy();
});

// ─── Invalid owner details — rejected, step stays ────────────────────────────

it('onboarding-full: invalid owner details — rejected, session stays in owner_details', async () => {
  await sim.sendOnboardCommand();
  await sim.sendOnboardCallback('onboard_lang_he');
  await sim.sendOnboardMessage('Acme Industries');

  // Confirm we're in owner_details step
  expect(db.peek('onboarding_sessions', String(CHAT_ID))?.step).toBe('owner_details');

  // Send invalid format (only 3 parts — missing email)
  await sim.sendOnboardMessage('John Doe, 123456789, 0501234567');

  // Session should still be in owner_details
  const session = db.peek('onboarding_sessions', String(CHAT_ID));
  expect(session?.step).toBe('owner_details');
  expect((session?.data as Record<string, unknown>)?.ownerName).toBeUndefined();
});

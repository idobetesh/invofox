/**
 * End-to-End Onboarding Flow Tests
 * Comprehensive tests for complete onboarding scenarios
 */

import type { TelegramMessage, TelegramCallbackQuery } from '../../../shared/types';
import {
  handleOnboardCommand,
  handleLanguageSelection,
  handleOnboardingMessage,
  handleOnboardingPhoto,
  handleTaxStatusCallback,
  handleCounterCallback,
} from '../src/controllers/onboarding.controller';
import { extractSheetId } from '../src/services/onboarding/validation.service';
import * as onboardingService from '../src/services/onboarding/onboarding.service';
import * as telegramService from '../src/services/telegram.service';
import * as configService from '../src/services/business-config/config.service';
import * as counterService from '../src/services/invoice-generator/counter.service';
import * as serviceAccountUtil from '../src/utils/service-account';
import * as inviteCodeService from '../src/services/invite-code.service';
import * as approvedChatsService from '../src/services/approved-chats.service';
import * as rateLimiterService from '../src/services/rate-limiter.service';

// Mock modules
jest.mock('../src/logger', () => ({
  child: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../src/config', () => ({
  getConfig: jest.fn(() => ({
    storageBucket: 'test-bucket',
  })),
}));

jest.mock('../src/services/onboarding/onboarding.service');
jest.mock('../src/services/telegram.service');
jest.mock('../src/services/business-config/config.service');
jest.mock('../src/services/invoice-generator/counter.service');
jest.mock('../src/utils/service-account');
jest.mock('../src/services/invite-code.service');
jest.mock('../src/services/approved-chats.service');
jest.mock('../src/services/rate-limiter.service');

// Mock googleapis
const mockSheetsGet = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn(() => ({
        getClient: jest.fn().mockResolvedValue({}),
      })),
    },
    sheets: jest.fn(() => ({
      spreadsheets: {
        get: mockSheetsGet,
      },
    })),
  },
}));

describe('Onboarding E2E Tests', () => {
  const CHAT_ID = -1001234567;
  const USER_ID = 123456;
  const SERVICE_ACCOUNT = 'worker-sa@papertrail-invoice.iam.gserviceaccount.com';

  beforeEach(() => {
    jest.clearAllMocks();
    (serviceAccountUtil.getServiceAccountEmail as jest.Mock).mockResolvedValue(SERVICE_ACCOUNT);
  });

  const createMessage = (text: string, photo?: boolean, document?: boolean): TelegramMessage => {
    const msg: TelegramMessage = {
      message_id: Date.now(),
      chat: { id: CHAT_ID, type: 'private' },
      date: Date.now() / 1000,
      text,
      from: { id: USER_ID, is_bot: false, first_name: 'Test', username: 'testuser' },
    };

    if (photo) {
      msg.photo = [{ file_id: 'file123', file_unique_id: 'unique123', width: 1280, height: 1280 }];
      delete msg.text;
    }

    if (document) {
      msg.document = {
        file_id: 'doc123',
        file_unique_id: 'docunique123',
        file_name: 'logo.png',
        mime_type: 'image/png',
      };
      delete msg.text;
    }

    return msg;
  };

  const createQuery = (data: string): TelegramCallbackQuery => ({
    id: `query_${Date.now()}`,
    from: { id: USER_ID, is_bot: false, first_name: 'Test', username: 'testuser' },
    message: {
      message_id: Date.now(),
      chat: { id: CHAT_ID, type: 'private' },
      date: Date.now() / 1000,
    },
    chat_instance: 'test',
    data,
  });

  describe('Complete Happy Path Flow', () => {
    it('should complete full onboarding flow with all optional fields', async () => {
      // Setup mocks
      (configService.hasBusinessConfig as jest.Mock).mockResolvedValue(false);
      (approvedChatsService.isChatApproved as jest.Mock).mockResolvedValue(false);
      (inviteCodeService.validateInviteCode as jest.Mock).mockResolvedValue({
        valid: true,
        invite: { code: 'INV-ABC123' },
      });
      (approvedChatsService.approveChatWithInviteCode as jest.Mock).mockResolvedValue(undefined);
      (inviteCodeService.markInviteCodeAsUsed as jest.Mock).mockResolvedValue(undefined);
      (rateLimiterService.clearRateLimit as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.startOnboarding as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.completeOnboarding as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (telegramService.downloadFileById as jest.Mock).mockResolvedValue({
        buffer: Buffer.from('fake-image'),
        filePath: 'photos/logo.jpg',
      });
      (telegramService.getFileExtension as jest.Mock).mockReturnValue('jpg');
      (configService.uploadLogo as jest.Mock).mockResolvedValue(
        'https://storage.googleapis.com/test-bucket/logos/123/logo.jpg'
      );
      (configService.saveBusinessConfig as jest.Mock).mockResolvedValue(undefined);
      (counterService.initializeCounter as jest.Mock).mockResolvedValue(undefined);

      mockSheetsGet.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Invoices' } }, { properties: { title: 'Data' } }],
        },
      });

      // Step 1: Start onboarding with invite code
      const onboardMsg = createMessage('/onboard INV-ABC123');
      await handleOnboardCommand(onboardMsg);

      expect(onboardingService.startOnboarding).toHaveBeenCalledWith(CHAT_ID, USER_ID);
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('Welcome'),
        expect.objectContaining({ replyMarkup: expect.any(Object) })
      );

      // Step 2: Select language (Hebrew)
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        step: 'language_selection',
        data: {},
      });

      const langQuery = createQuery('onboard_lang_he');
      await handleLanguageSelection(langQuery);

      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        language: 'he',
        step: 'business_name',
      });

      // Step 3: Enter business name
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'business_name',
        data: {},
      });

      const businessNameMsg = createMessage('חברת הדוגמה בע״מ');
      await handleOnboardingMessage(businessNameMsg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(CHAT_ID, {
        businessName: 'חברת הדוגמה בע״מ',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'owner_details',
      });

      // Step 4: Enter owner details
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'owner_details',
        data: { businessName: 'חברת הדוגמה בע״מ' },
      });

      const ownerMsg = createMessage('ישראל ישראלי, 123456789, 0501234567, israel@example.com');
      await handleOnboardingMessage(ownerMsg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(CHAT_ID, {
        ownerName: 'ישראל ישראלי',
        ownerIdNumber: '123456789',
        phone: '0501234567',
        email: 'israel@example.com',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'address',
      });

      // Step 5: Enter address
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'address',
        data: {
          businessName: 'חברת הדוגמה בע״מ',
          ownerName: 'ישראל ישראלי',
          ownerIdNumber: '123456789',
          phone: '0501234567',
          email: 'israel@example.com',
        },
      });

      const addressMsg = createMessage('רחוב הרצל 123, תל אביב');
      await handleOnboardingMessage(addressMsg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(CHAT_ID, {
        address: 'רחוב הרצל 123, תל אביב',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'tax_status',
      });

      // Step 6: Select tax status
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'tax_status',
        data: {
          businessName: 'חברת הדוגמה בע״מ',
          ownerName: 'ישראל ישראלי',
          ownerIdNumber: '123456789',
          phone: '0501234567',
          email: 'israel@example.com',
          address: 'רחוב הרצל 123, תל אביב',
        },
      });

      const taxQuery = createQuery('onboard_tax_exempt');
      await handleTaxStatusCallback(taxQuery);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(CHAT_ID, {
        taxStatus: 'עוסק פטור מס',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'logo',
      });

      // Step 7: Upload logo
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'logo',
        data: {
          businessName: 'חברת הדוגמה בע״מ',
          ownerName: 'ישראל ישראלי',
          ownerIdNumber: '123456789',
          phone: '0501234567',
          email: 'israel@example.com',
          address: 'רחוב הרצל 123, תל אביב',
          taxStatus: 'עוסק פטור מס',
        },
      });

      const logoMsg = createMessage('', true); // photo message
      await handleOnboardingPhoto(logoMsg);

      expect(configService.uploadLogo).toHaveBeenCalled();
      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(CHAT_ID, {
        logoUrl: expect.stringContaining('logo.jpg'),
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'sheet',
      });

      // Step 8: Enter Google Sheet ID
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'sheet',
        data: {
          businessName: 'חברת הדוגמה בע״מ',
          ownerName: 'ישראל ישראלי',
          ownerIdNumber: '123456789',
          phone: '0501234567',
          email: 'israel@example.com',
          address: 'רחוב הרצל 123, תל אביב',
          taxStatus: 'עוסק פטור מס',
          logoUrl: 'https://storage.googleapis.com/test-bucket/logos/123/logo.jpg',
        },
      });

      const sheetMsg = createMessage('1abc_XyZ123-456def789012');
      await handleOnboardingMessage(sheetMsg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(CHAT_ID, {
        sheetId: '1abc_XyZ123-456def789012',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'counter',
      });

      // Step 9: Select counter (start from 1)
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'counter',
        data: {
          businessName: 'חברת הדוגמה בע״מ',
          ownerName: 'ישראל ישראלי',
          ownerIdNumber: '123456789',
          phone: '0501234567',
          email: 'israel@example.com',
          address: 'רחוב הרצל 123, תל אביב',
          taxStatus: 'עוסק פטור מס',
          logoUrl: 'https://storage.googleapis.com/test-bucket/logos/123/logo.jpg',
          sheetId: '1abc_XyZ123-456def789012',
          startingCounter: 0,
        },
      });

      const counterQuery = createQuery('onboard_counter_1');
      await handleCounterCallback(counterQuery);

      expect(configService.saveBusinessConfig).toHaveBeenCalled();
      expect(onboardingService.completeOnboarding).toHaveBeenCalledWith(CHAT_ID);
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('ההגדרה הושלמה')
      );
    });

    it('should complete onboarding skipping optional steps', async () => {
      // Setup mocks
      (configService.hasBusinessConfig as jest.Mock).mockResolvedValue(false);
      (approvedChatsService.isChatApproved as jest.Mock).mockResolvedValue(true); // Already approved
      (onboardingService.startOnboarding as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.completeOnboarding as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (configService.saveBusinessConfig as jest.Mock).mockResolvedValue(undefined);

      // Start onboarding (already approved, no invite code needed)
      const onboardMsg = createMessage('/onboard');
      await handleOnboardCommand(onboardMsg);

      // Select language
      const langQuery = createQuery('onboard_lang_en');
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        step: 'language_selection',
        data: {},
      });
      await handleLanguageSelection(langQuery);

      // Business name
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'business_name',
        data: {},
      });
      await handleOnboardingMessage(createMessage('Test Corp'));

      // Owner details
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'owner_details',
        data: { businessName: 'Test Corp' },
      });
      await handleOnboardingMessage(
        createMessage('John Doe, 123456789, +972501234567, john@test.com')
      );

      // Address
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'address',
        data: {
          businessName: 'Test Corp',
          ownerName: 'John Doe',
          ownerIdNumber: '123456789',
          phone: '+972501234567',
          email: 'john@test.com',
        },
      });
      await handleOnboardingMessage(createMessage('123 Main Street'));

      // Tax status
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'tax_status',
        data: {
          businessName: 'Test Corp',
          ownerName: 'John Doe',
          ownerIdNumber: '123456789',
          phone: '+972501234567',
          email: 'john@test.com',
          address: '123 Main Street',
        },
      });
      await handleTaxStatusCallback(createQuery('onboard_tax_licensed'));

      // Skip logo
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'logo',
        data: {
          businessName: 'Test Corp',
          ownerName: 'John Doe',
          ownerIdNumber: '123456789',
          phone: '+972501234567',
          email: 'john@test.com',
          address: '123 Main Street',
          taxStatus: 'Licensed Business (עוסק מורשה)',
        },
      });
      await handleOnboardingMessage(createMessage('/skip'));

      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'sheet',
      });

      // Skip sheet
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'sheet',
        data: {
          businessName: 'Test Corp',
          ownerName: 'John Doe',
          ownerIdNumber: '123456789',
          phone: '+972501234567',
          email: 'john@test.com',
          address: '123 Main Street',
          taxStatus: 'Licensed Business (עוסק מורשה)',
        },
      });
      await handleOnboardingMessage(createMessage('/skip'));

      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(CHAT_ID, {
        step: 'counter',
      });

      // Select counter
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'counter',
        data: {
          businessName: 'Test Corp',
          ownerName: 'John Doe',
          ownerIdNumber: '123456789',
          phone: '+972501234567',
          email: 'john@test.com',
          address: '123 Main Street',
          taxStatus: 'Licensed Business (עוסק מורשה)',
          startingCounter: 0,
        },
      });
      await handleCounterCallback(createQuery('onboard_counter_1'));

      expect(configService.saveBusinessConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'en',
          business: expect.objectContaining({
            name: 'Test Corp',
            taxId: '123456789',
            email: 'john@test.com',
            phone: '+972501234567',
            address: '123 Main Street',
            taxStatus: 'Licensed Business (עוסק מורשה)',
          }),
        }),
        CHAT_ID
      );
      expect(onboardingService.completeOnboarding).toHaveBeenCalledWith(CHAT_ID);
    });
  });

  describe('Error Cases and Edge Cases', () => {
    beforeEach(() => {
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
    });

    it('should reject text input during logo step', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'logo',
        data: {},
      });

      const textMsg = createMessage('בדיקה'); // Regular text, not /skip
      await handleOnboardingMessage(textMsg);

      // Should send invalid message
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('אנא שלחו קובץ תמונה')
      );

      // Should NOT update data or move to next step
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(onboardingService.updateOnboardingSession).not.toHaveBeenCalled();
    });

    it('should reject photo during business name step', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'business_name',
        data: {},
      });

      const photoMsg = createMessage('', true); // Photo message
      const result = await handleOnboardingPhoto(photoMsg);

      // Should return false (not handled)
      expect(result).toBe(false);
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject invalid business name (too short)', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'business_name',
        data: {},
      });

      await handleOnboardingMessage(createMessage('X')); // Only 1 char

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('לא תקין')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject invalid owner details format', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'owner_details',
        data: {},
      });

      // Missing fields (only 3 instead of 4)
      await handleOnboardingMessage(createMessage('John Doe, 123456789, +972501234567'));

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('Invalid format')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject invalid tax ID (wrong length)', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'owner_details',
        data: {},
      });

      // Tax ID with 8 digits instead of 9
      await handleOnboardingMessage(
        createMessage('ישראל ישראלי, 12345678, 0501234567, test@example.com')
      );

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('ת.ז/ח.פ לא תקין')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject invalid email', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'owner_details',
        data: {},
      });

      await handleOnboardingMessage(
        createMessage('John Doe, 123456789, +972501234567, notanemail')
      );

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('אימייל לא תקין')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject invalid phone number', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'owner_details',
        data: {},
      });

      await handleOnboardingMessage(
        createMessage('ישראל ישראלי, 123456789, abc, test@example.com')
      );

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('טלפון לא תקין')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject too short address', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'he',
        step: 'address',
        data: {},
      });

      await handleOnboardingMessage(createMessage('abc')); // Less than 5 chars

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('כתובת לא תקינה')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject invalid sheet ID format', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'sheet',
        data: {},
      });

      await handleOnboardingMessage(createMessage('invalid-short-id'));

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('valid Sheet ID')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject negative counter number', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'counter',
        data: {},
      });

      await handleOnboardingMessage(createMessage('-10'));

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('valid number')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should reject non-numeric counter', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'counter',
        data: {},
      });

      await handleOnboardingMessage(createMessage('abc'));

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('valid number')
      );
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });
  });

  describe('extractSheetId utility', () => {
    it('should extract sheet ID from full URL', () => {
      const url = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def789012/edit#gid=0';
      expect(extractSheetId(url)).toBe('1abc_XyZ123-456def789012');
    });

    it('should extract sheet ID from simple URL', () => {
      const url = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def789012/edit';
      expect(extractSheetId(url)).toBe('1abc_XyZ123-456def789012');
    });

    it('should accept direct sheet ID', () => {
      const id = '1abc_XyZ123-456def789012';
      expect(extractSheetId(id)).toBe('1abc_XyZ123-456def789012');
    });

    it('should reject too short ID', () => {
      expect(extractSheetId('tooshort')).toBeNull();
    });

    it('should reject ID with invalid characters', () => {
      expect(extractSheetId('1abc*XyZ123@456def789012')).toBeNull();
    });
  });

  describe('Session State Management', () => {
    it('should not process messages when not in onboarding', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue(null);

      const msg = createMessage('Test');
      await handleOnboardingMessage(msg);

      // Should not call any update methods
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(onboardingService.updateOnboardingSession).not.toHaveBeenCalled();
    });

    it('should not process photos when not in logo step', async () => {
      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: CHAT_ID,
        userId: USER_ID,
        language: 'en',
        step: 'business_name', // Not in logo step
        data: {},
      });

      const photoMsg = createMessage('', true);
      const result = await handleOnboardingPhoto(photoMsg);

      expect(result).toBe(false);
      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });

    it('should not allow onboarding when config already exists', async () => {
      (configService.hasBusinessConfig as jest.Mock).mockResolvedValue(true);
      (approvedChatsService.isChatApproved as jest.Mock).mockResolvedValue(true);

      const msg = createMessage('/onboard');
      await handleOnboardCommand(msg);

      expect(onboardingService.startOnboarding).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('already configured')
      );
    });
  });
});

/**
 * Onboarding Controller Tests
 * Tests for onboarding flow step handlers and callbacks
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

describe('Onboarding Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleOnboardCommand', () => {
    const createMessage = (chatId: number, userId: number): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      text: '/onboard',
      from: { id: userId, is_bot: false, first_name: 'Test', username: 'testuser' },
    });

    it('should start onboarding with valid invite code', async () => {
      const msg = createMessage(-1001234567, 123456);
      msg.text = '/onboard INV-ABC123';

      (configService.hasBusinessConfig as jest.Mock).mockResolvedValue(false);
      (approvedChatsService.isChatApproved as jest.Mock).mockResolvedValue(false);
      (inviteCodeService.validateInviteCode as jest.Mock).mockResolvedValue({
        valid: true,
        invite: {
          code: 'INV-ABC123',
          createdBy: { userId: 999, username: 'admin' },
        },
      });
      (approvedChatsService.approveChatWithInviteCode as jest.Mock).mockResolvedValue(undefined);
      (inviteCodeService.markInviteCodeAsUsed as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.startOnboarding as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardCommand(msg);

      expect(inviteCodeService.validateInviteCode).toHaveBeenCalledWith('INV-ABC123');
      expect(approvedChatsService.approveChatWithInviteCode).toHaveBeenCalled();
      expect(inviteCodeService.markInviteCodeAsUsed).toHaveBeenCalled();
      expect(onboardingService.startOnboarding).toHaveBeenCalledWith(-1001234567, 123456);
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Welcome to PaperTrail'),
        expect.objectContaining({
          replyMarkup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({ text: 'English 🇺🇸', callback_data: 'onboard_lang_en' }),
                expect.objectContaining({ text: 'עברית 🇮🇱', callback_data: 'onboard_lang_he' }),
              ]),
            ]),
          }),
        })
      );
    });

    it('should reject onboarding when config already exists', async () => {
      const msg = createMessage(-1001234567, 123456);

      (configService.hasBusinessConfig as jest.Mock).mockResolvedValue(true);

      await handleOnboardCommand(msg);

      expect(onboardingService.startOnboarding).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('already configured')
      );
    });

    it('should handle missing userId', async () => {
      const msg = createMessage(-1001234567, 123456);
      delete msg.from;

      (rateLimiterService.recordFailedOnboardingAttempt as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardCommand(msg);

      expect(rateLimiterService.recordFailedOnboardingAttempt).toHaveBeenCalledWith(-1001234567);
      expect(onboardingService.startOnboarding).not.toHaveBeenCalled();
      // Security: Silently ignore invalid requests (no message sent)
      expect(telegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('should record failed attempt when no invite code provided', async () => {
      const msg = createMessage(-1001234567, 123456);
      msg.text = '/onboard'; // No invite code

      (configService.hasBusinessConfig as jest.Mock).mockResolvedValue(false);
      (approvedChatsService.isChatApproved as jest.Mock).mockResolvedValue(false);
      (rateLimiterService.recordFailedOnboardingAttempt as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardCommand(msg);

      expect(rateLimiterService.recordFailedOnboardingAttempt).toHaveBeenCalledWith(-1001234567);
      expect(onboardingService.startOnboarding).not.toHaveBeenCalled();
    });

    it('should record failed attempt when invalid invite code provided', async () => {
      const msg = createMessage(-1001234567, 123456);
      msg.text = '/onboard INV-FAKE12';

      (configService.hasBusinessConfig as jest.Mock).mockResolvedValue(false);
      (approvedChatsService.isChatApproved as jest.Mock).mockResolvedValue(false);
      (inviteCodeService.validateInviteCode as jest.Mock).mockResolvedValue({
        valid: false,
        reason: 'not_found',
      });
      (rateLimiterService.recordFailedOnboardingAttempt as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardCommand(msg);

      expect(rateLimiterService.recordFailedOnboardingAttempt).toHaveBeenCalledWith(-1001234567);
      expect(onboardingService.startOnboarding).not.toHaveBeenCalled();
    });

    it('should clear rate limit when valid invite code provided', async () => {
      const msg = createMessage(-1001234567, 123456);
      msg.text = '/onboard INV-ABC123';

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
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardCommand(msg);

      expect(rateLimiterService.clearRateLimit).toHaveBeenCalledWith(-1001234567);
      expect(onboardingService.startOnboarding).toHaveBeenCalled();
    });
  });

  describe('handleLanguageSelection', () => {
    const createQuery = (chatId: number, data: string): TelegramCallbackQuery => ({
      id: 'query123',
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
      message: {
        message_id: 1,
        chat: { id: chatId, type: 'private' },
        date: Date.now() / 1000,
      },
      chat_instance: 'test',
      data,
    });

    it('should set English language and move to business_name step', async () => {
      const query = createQuery(-1001234567, 'onboard_lang_en');

      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleLanguageSelection(query);

      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        language: 'en',
        step: 'business_name',
      });
      expect(telegramService.answerCallbackQuery).toHaveBeenCalledWith('query123');
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Language: English')
      );
    });

    it('should set Hebrew language and move to business_name step', async () => {
      const query = createQuery(-1001234567, 'onboard_lang_he');

      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleLanguageSelection(query);

      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        language: 'he',
        step: 'business_name',
      });
      expect(telegramService.answerCallbackQuery).toHaveBeenCalledWith('query123');
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('שפה: עברית')
      );
    });
  });

  describe('handleTaxStatusCallback', () => {
    const createQuery = (chatId: number, data: string): TelegramCallbackQuery => ({
      id: 'query123',
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
      message: {
        message_id: 1,
        chat: { id: chatId, type: 'private' },
        date: Date.now() / 1000,
      },
      chat_instance: 'test',
      data,
    });

    it('should set tax exempt status and move to logo step', async () => {
      const query = createQuery(-1001234567, 'onboard_tax_exempt');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'tax_status',
        data: {},
      });
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleTaxStatusCallback(query);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        taxStatus: 'Tax Exempt Business (עוסק פטור מס)',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        step: 'logo',
      });
    });

    it('should set licensed business status', async () => {
      const query = createQuery(-1001234567, 'onboard_tax_licensed');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'he',
        step: 'tax_status',
        data: {},
      });
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleTaxStatusCallback(query);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        taxStatus: 'עוסק מורשה',
      });
    });

    it('should not proceed if session is missing', async () => {
      const query = createQuery(-1001234567, 'onboard_tax_exempt');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue(null);

      await handleTaxStatusCallback(query);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });
  });

  describe('handleCounterCallback', () => {
    const createQuery = (chatId: number, data: string): TelegramCallbackQuery => ({
      id: 'query123',
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
      message: {
        message_id: 1,
        chat: { id: chatId, type: 'private' },
        date: Date.now() / 1000,
      },
      chat_instance: 'test',
      data,
    });

    it('should start from counter 1 and finalize onboarding', async () => {
      const query = createQuery(-1001234567, 'onboard_counter_1');

      const mockSession = {
        chatId: -1001234567,
        userId: 123456,
        language: 'en' as const,
        step: 'counter' as const,
        data: {
          businessName: 'Test Corp',
          ownerName: 'John Doe',
          ownerIdNumber: '123456789',
          phone: '+972501234567',
          email: 'john@test.com',
          address: '123 Main St',
          taxStatus: 'Tax Exempt Business (עוסק פטור מס)',
        },
      };

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue(mockSession);
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (configService.saveBusinessConfig as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.completeOnboarding as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      // Mock getOnboardingSession to return updated session for finalizeOnboarding
      (onboardingService.getOnboardingSession as jest.Mock)
        .mockResolvedValueOnce(mockSession)
        .mockResolvedValueOnce({
          ...mockSession,
          data: { ...mockSession.data, startingCounter: 0 },
        });

      await handleCounterCallback(query);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        startingCounter: 0,
      });
      expect(configService.saveBusinessConfig).toHaveBeenCalled();
      expect(onboardingService.completeOnboarding).toHaveBeenCalledWith(-1001234567);
    });

    it('should prompt for custom counter number', async () => {
      const query = createQuery(-1001234567, 'onboard_counter_custom');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'counter',
        data: {},
      });
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleCounterCallback(query);

      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Please send the starting invoice number')
      );
      expect(configService.saveBusinessConfig).not.toHaveBeenCalled();
    });
  });

  describe('handleOnboardingMessage - Business Name Step', () => {
    const createMessage = (chatId: number, text: string): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      text,
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
    });

    it('should accept business name and move to owner_details', async () => {
      const msg = createMessage(-1001234567, 'Acme Corporation');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'business_name',
        data: {},
      });
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        businessName: 'Acme Corporation',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        step: 'owner_details',
      });
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Business Name: Acme Corporation')
      );
    });

    it('should reject empty business name', async () => {
      const msg = createMessage(-1001234567, '   ');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'business_name',
        data: {},
      });
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Please send your business name')
      );
    });
  });

  describe('handleOnboardingMessage - Owner Details Step', () => {
    const createMessage = (chatId: number, text: string): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      text,
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
    });

    it('should parse and accept valid owner details', async () => {
      const msg = createMessage(-1001234567, 'John Doe, 123456789, +972501234567, john@acme.com');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'owner_details',
        data: { businessName: 'Acme Corp' },
      });
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        ownerName: 'John Doe',
        ownerIdNumber: '123456789',
        phone: '+972501234567',
        email: 'john@acme.com',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        step: 'address',
      });
    });

    it('should reject owner details with wrong format', async () => {
      const msg = createMessage(-1001234567, 'John Doe 123456789 +972501234567');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'owner_details',
        data: {},
      });
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Invalid format')
      );
    });

    it('should reject owner details with invalid email', async () => {
      const msg = createMessage(-1001234567, 'John Doe, 123456789, +972501234567, invalid-email');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'owner_details',
        data: {},
      });
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Invalid format')
      );
    });
  });

  describe('handleOnboardingMessage - Address Step', () => {
    const createMessage = (chatId: number, text: string): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      text,
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
    });

    it('should accept address and show tax status selection', async () => {
      const msg = createMessage(-1001234567, '123 Herzl Street, Tel Aviv');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'address',
        data: {},
      });
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        address: '123 Herzl Street, Tel Aviv',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        step: 'tax_status',
      });
      // Should send tax status selection buttons
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Tax Status'),
        expect.objectContaining({
          replyMarkup: expect.objectContaining({
            inline_keyboard: expect.any(Array),
          }),
        })
      );
    });
  });

  describe('handleOnboardingMessage - Sheet Step', () => {
    const createMessage = (chatId: number, text: string): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      text,
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
    });

    it('should accept valid sheet ID and test access', async () => {
      const msg = createMessage(-1001234567, '1abc_XyZ123-456def789012');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'sheet',
        data: {},
      });

      mockSheetsGet.mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: 'Invoices' } },
            { properties: { title: 'Generated Invoices' } },
          ],
        },
      });

      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        sheetId: '1abc_XyZ123-456def789012',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        step: 'counter',
      });
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Sheet connected')
      );
    });

    it('should allow skipping sheet step', async () => {
      const msg = createMessage(-1001234567, '/skip');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'sheet',
        data: {},
      });
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        step: 'counter',
      });
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('skipped')
      );
    });

    it('should reject invalid sheet ID format', async () => {
      const msg = createMessage(-1001234567, 'invalid');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'sheet',
        data: {},
      });
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('valid Sheet ID')
      );
    });

    it('should handle sheet access error', async () => {
      const msg = createMessage(-1001234567, '1abc_XyZ123-456def789012');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'sheet',
        data: {},
      });

      mockSheetsGet.mockRejectedValue(new Error('Permission denied'));
      (serviceAccountUtil.getServiceAccountEmail as jest.Mock).mockResolvedValue(
        'worker-sa@papertrail-invoice.iam.gserviceaccount.com'
      );
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('Could not access sheet')
      );
    });
  });

  describe('handleOnboardingMessage - Counter Step', () => {
    const createMessage = (chatId: number, text: string): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      text,
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
    });

    it('should accept valid counter number and finalize', async () => {
      const msg = createMessage(-1001234567, '1000');

      const mockSession = {
        chatId: -1001234567,
        userId: 123456,
        language: 'en' as const,
        step: 'counter' as const,
        data: {
          businessName: 'Test Corp',
          ownerName: 'John Doe',
          ownerIdNumber: '123456789',
          phone: '+972501234567',
          email: 'john@test.com',
          address: '123 Main St',
          taxStatus: 'Tax Exempt Business (עוסק פטור מס)',
        },
      };

      (onboardingService.getOnboardingSession as jest.Mock)
        .mockResolvedValueOnce(mockSession)
        .mockResolvedValueOnce({
          ...mockSession,
          data: { ...mockSession.data, startingCounter: 1000 },
        });
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (configService.saveBusinessConfig as jest.Mock).mockResolvedValue(undefined);
      (counterService.initializeCounter as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.completeOnboarding as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        startingCounter: 1000,
      });
      expect(counterService.initializeCounter).toHaveBeenCalledWith(-1001234567, 1000);
      expect(onboardingService.completeOnboarding).toHaveBeenCalledWith(-1001234567);
    });

    it('should reject invalid counter number', async () => {
      const msg = createMessage(-1001234567, 'abc');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'counter',
        data: {},
      });
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        -1001234567,
        expect.stringContaining('valid number')
      );
    });

    it('should reject negative counter number', async () => {
      const msg = createMessage(-1001234567, '-10');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'counter',
        data: {},
      });
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      expect(onboardingService.updateOnboardingData).not.toHaveBeenCalled();
    });
  });

  describe('handleOnboardingPhoto', () => {
    const createPhotoMessage = (chatId: number, fileId: string): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
      photo: [
        { file_id: 'small', file_unique_id: 'small', width: 90, height: 90, file_size: 1000 },
        { file_id: fileId, file_unique_id: 'large', width: 1280, height: 1280, file_size: 50000 },
      ],
    });

    it('should upload logo when in logo step', async () => {
      const msg = createPhotoMessage(-1001234567, 'file123');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'logo',
        data: {},
      });
      (telegramService.downloadFileById as jest.Mock).mockResolvedValue({
        buffer: Buffer.from('fake-image-data'),
        filePath: 'photos/logo.jpg',
      });
      (telegramService.getFileExtension as jest.Mock).mockReturnValue('jpg');
      (configService.uploadLogo as jest.Mock).mockResolvedValue(
        'https://storage.googleapis.com/test-bucket/logos/-1001234567/logo.jpg'
      );
      (onboardingService.updateOnboardingData as jest.Mock).mockResolvedValue(undefined);
      (onboardingService.updateOnboardingSession as jest.Mock).mockResolvedValue(undefined);
      (serviceAccountUtil.getServiceAccountEmail as jest.Mock).mockResolvedValue(
        'worker-sa@papertrail-invoice.iam.gserviceaccount.com'
      );
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await handleOnboardingPhoto(msg);

      expect(result).toBe(true);
      expect(telegramService.downloadFileById).toHaveBeenCalledWith('file123');
      expect(configService.uploadLogo).toHaveBeenCalled();
      expect(onboardingService.updateOnboardingData).toHaveBeenCalledWith(-1001234567, {
        logoUrl: 'https://storage.googleapis.com/test-bucket/logos/-1001234567/logo.jpg',
      });
      expect(onboardingService.updateOnboardingSession).toHaveBeenCalledWith(-1001234567, {
        step: 'sheet',
      });
    });

    it('should return false when not in logo step', async () => {
      const msg = createPhotoMessage(-1001234567, 'file123');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'business_name',
        data: {},
      });

      const result = await handleOnboardingPhoto(msg);

      expect(result).toBe(false);
      expect(telegramService.downloadFileById).not.toHaveBeenCalled();
    });

    it('should return false when no session exists', async () => {
      const msg = createPhotoMessage(-1001234567, 'file123');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue(null);

      const result = await handleOnboardingPhoto(msg);

      expect(result).toBe(false);
    });
  });

  describe('Error handling', () => {
    const createMessage = (chatId: number, text: string): TelegramMessage => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      date: Date.now() / 1000,
      text,
      from: { id: 123456, is_bot: false, first_name: 'Test', username: 'testuser' },
    });

    it('should handle errors gracefully in message handler', async () => {
      const msg = createMessage(-1001234567, 'Test Business');

      (onboardingService.getOnboardingSession as jest.Mock).mockResolvedValue({
        chatId: -1001234567,
        userId: 123456,
        language: 'en',
        step: 'business_name',
        data: {},
      });
      (onboardingService.updateOnboardingData as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      await handleOnboardingMessage(msg);

      // Should catch error and not throw
      expect(telegramService.sendMessage).toHaveBeenCalled();
    });
  });
});

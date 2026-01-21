/**
 * Onboarding controller
 * Handles conversational onboarding flow for new customers
 */

import { z } from 'zod';
import type {
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramInlineKeyboardMarkup,
} from '../../../../shared/types';
import {
  getOnboardingSession,
  updateOnboardingSession,
  updateOnboardingData,
  startOnboarding,
  completeOnboarding,
} from '../services/onboarding/onboarding.service';
import { t, type Language } from '../services/i18n/languages';
import {
  sendMessage,
  answerCallbackQuery,
  downloadFileById,
  getFileExtension,
} from '../services/telegram.service';
import {
  hasBusinessConfig,
  saveBusinessConfig,
  uploadLogo,
  type BusinessConfigDocument,
} from '../services/invoice-generator/config.service';
import { initializeCounter } from '../services/invoice-generator/counter.service';
import { getServiceAccountEmail } from '../utils/service-account';
import { getConfig } from '../config';
import logger from '../logger';
import { google } from 'googleapis';
import { validateInviteCode, markInviteCodeAsUsed } from '../services/invite-code.service';
import { isChatApproved, approveChatWithInviteCode } from '../services/approved-chats.service';
import { recordFailedOnboardingAttempt, clearRateLimit } from '../services/rate-limiter.service';

// Validation schemas
const businessNameSchema = z.string().min(2).max(100);
const addressSchema = z.string().min(5).max(200);
const emailSchema = z.string().email();
const phoneSchema = z
  .string()
  .min(9)
  .max(15)
  .regex(/^[+]?[\d\s\-()]+$/);
const israeliIdSchema = z.string().regex(/^\d{9}$/); // Israeli ID: 9 digits
const israeliCompanyIdSchema = z.string().regex(/^\d{9}$/); // Israeli Company ID (ח.פ): 9 digits
const taxIdSchema = z.union([israeliIdSchema, israeliCompanyIdSchema]); // Accept either format
const ownerNameSchema = z.string().min(2).max(100);
const googleSheetIdSchema = z
  .string()
  .min(20)
  .regex(/^[a-zA-Z0-9_-]+$/);

const SERVICE_ACCOUNT_CACHE: { email: string | null } = { email: null };

/**
 * Handle /onboard command
 * Format: /onboard INV-XXXXXX
 * Security: Requires valid invite code unless chat already approved
 */
export async function handleOnboardCommand(msg: TelegramMessage): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const chatTitle = msg.chat.title || msg.chat.first_name || 'Private Chat';
  const log = logger.child({ chatId, userId, command: 'onboard' });

  if (!userId) {
    // Record failed attempt for rate limiting (suspicious activity)
    log.warn('Onboard command ignored: could not identify user');
    await recordFailedOnboardingAttempt(chatId);
    return;
  }

  // Check if already configured
  const configExists = await hasBusinessConfig(chatId);
  if (configExists) {
    await sendMessage(
      chatId,
      '⚠️ Your business is already configured.\n\nUse /settings to view or edit your configuration.'
    );
    log.info('Onboarding blocked: config already exists');
    return;
  }

  // Security Check: Require invite code or approved status
  const isApproved = await isChatApproved(chatId);

  if (!isApproved) {
    // Extract invite code from command text (e.g., "/onboard INV-ABC123")
    const inviteCode = msg.text?.trim().split(/\s+/)[1];

    if (!inviteCode) {
      // No invite code provided - silently ignore and record failure
      log.warn('Onboard command ignored: no invite code provided');
      await recordFailedOnboardingAttempt(chatId);
      return;
    }

    // Validate invite code
    const validation = await validateInviteCode(inviteCode);

    if (!validation.valid) {
      // Invalid invite code - silently ignore and record failure
      log.warn(
        { inviteCode, reason: validation.reason, usedBy: validation.usedBy },
        'Onboard command ignored: invalid invite code'
      );
      await recordFailedOnboardingAttempt(chatId);
      return;
    }

    // Valid invite code - approve chat and mark code as used
    await approveChatWithInviteCode(chatId, chatTitle, inviteCode, userId);
    await markInviteCodeAsUsed(inviteCode, { chatId, chatTitle });

    // Clear any previous rate limiting (successful approval)
    await clearRateLimit(chatId);

    log.info({ inviteCode }, 'Chat approved with invite code');
  }

  // Start onboarding session
  await startOnboarding(chatId, userId);
  log.info('Onboarding session started');

  // Send language selection
  await sendLanguageSelection(chatId);
}

/**
 * Send language selection message with inline keyboard
 */
async function sendLanguageSelection(chatId: number): Promise<void> {
  const keyboard: TelegramInlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: 'English 🇺🇸', callback_data: 'onboard_lang_en' },
        { text: 'עברית 🇮🇱', callback_data: 'onboard_lang_he' },
      ],
    ],
  };

  await sendMessage(
    chatId,
    '🚀 Welcome to PaperTrail! / ברוכים הבאים ל-PaperTrail!\n\nPlease select your language / אנא בחרו שפה:',
    { replyMarkup: keyboard }
  );
}

/**
 * Handle language selection callback
 */
export async function handleLanguageSelection(query: TelegramCallbackQuery): Promise<void> {
  if (!query.message || !query.data) {
    return;
  }
  const chatId = query.message.chat.id;
  const data = query.data;
  const language = data === 'onboard_lang_en' ? 'en' : 'he';

  const log = logger.child({ chatId, language });

  // Update session with language
  await updateOnboardingSession(chatId, {
    language,
    step: 'business_name',
  });

  // Acknowledge callback
  await answerCallbackQuery(query.id);

  // Send next step in selected language
  const message =
    t(language, 'onboarding.languageSet') +
    '\n\n' +
    t(language, 'onboarding.step1Title') +
    '\n' +
    t(language, 'onboarding.step1Prompt');

  await sendMessage(chatId, message);
  log.info('Language selected, moved to business_name step');
}

/**
 * Route onboarding message to appropriate step handler
 */
export async function handleOnboardingMessage(msg: TelegramMessage): Promise<void> {
  const session = await getOnboardingSession(msg.chat.id);

  if (!session || !session.language) {
    return; // Not in onboarding or language not set yet
  }

  const log = logger.child({ chatId: msg.chat.id, step: session.step });

  try {
    switch (session.step) {
      case 'business_name':
        await handleBusinessNameStep(msg, session.language);
        break;
      case 'owner_details':
        await handleOwnerDetailsStep(msg, session.language);
        break;
      case 'address':
        await handleAddressStep(msg, session.language);
        break;
      case 'logo':
        await handleLogoStep(msg, session.language);
        break;
      case 'sheet':
        await handleSheetStep(msg, session.language);
        break;
      case 'counter':
        await handleCounterStep(msg, session.language);
        break;
      default:
        log.warn('Unknown onboarding step');
    }
  } catch (error) {
    log.error({ error }, 'Error handling onboarding step');
    await sendMessage(msg.chat.id, t(session.language, 'common.error', { error: String(error) }));
  }
}

/**
 * Handle business name step
 */
async function handleBusinessNameStep(msg: TelegramMessage, language: Language): Promise<void> {
  const chatId = msg.chat.id;
  const businessName = msg.text?.trim();

  if (!businessName) {
    await sendMessage(chatId, t(language, 'onboarding.step1Prompt'));
    return;
  }

  // Validate business name
  const businessNameValidation = businessNameSchema.safeParse(businessName);
  if (!businessNameValidation.success) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step1Prompt') + '\n\n❌ שם העסק לא תקין - חייב להכיל בין 2-100 תווים'
    );
    return;
  }

  await updateOnboardingData(chatId, { businessName });
  await updateOnboardingSession(chatId, { step: 'owner_details' });

  const message =
    t(language, 'onboarding.step1Confirm', { name: businessName }) +
    '\n\n' +
    t(language, 'onboarding.step2Title') +
    '\n' +
    t(language, 'onboarding.step2Prompt');

  await sendMessage(chatId, message);
}

/**
 * Handle owner details step
 */
async function handleOwnerDetailsStep(msg: TelegramMessage, language: Language): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) {
    return;
  }

  // Parse format: Name, Tax ID, Phone, Email
  const parts = text.split(',').map((p) => p.trim());

  if (parts.length !== 4) {
    await sendMessage(chatId, t(language, 'onboarding.step2Invalid'));
    return;
  }

  const [ownerName, ownerIdNumber, phone, email] = parts;

  // Validate owner name
  const ownerNameValidation = ownerNameSchema.safeParse(ownerName);
  if (!ownerNameValidation.success) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step2Invalid') + '\n\n❌ שם לא תקין - חייב להכיל בין 2-100 תווים'
    );
    return;
  }

  // Validate tax ID (Israeli format: 9 digits)
  const taxIdValidation = taxIdSchema.safeParse(ownerIdNumber);
  if (!taxIdValidation.success) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step2Invalid') + '\n\n❌ ת.ז/ח.פ לא תקין - חייב להכיל 9 ספרות בדיוק'
    );
    return;
  }

  // Validate phone
  const phoneValidation = phoneSchema.safeParse(phone);
  if (!phoneValidation.success) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step2Invalid') +
        '\n\n❌ טלפון לא תקין - דוגמה: 0501234567 או +972501234567'
    );
    return;
  }

  // Validate email
  const emailValidation = emailSchema.safeParse(email);
  if (!emailValidation.success) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step2Invalid') + '\n\n❌ אימייל לא תקין - דוגמה: name@example.com'
    );
    return;
  }

  await updateOnboardingData(chatId, { ownerName, ownerIdNumber, phone, email });
  await updateOnboardingSession(chatId, { step: 'address' });

  const message =
    t(language, 'onboarding.step2Confirm', {
      name: ownerName,
      taxId: ownerIdNumber,
      phone,
      email,
    }) +
    '\n\n' +
    t(language, 'onboarding.step3Title') +
    '\n' +
    t(language, 'onboarding.step3Prompt');

  await sendMessage(chatId, message);
}

/**
 * Send tax status selection with inline keyboard
 */
async function sendTaxStatusSelection(chatId: number, language: Language): Promise<void> {
  const keyboard: TelegramInlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: t(language, 'taxStatus.exempt'), callback_data: 'onboard_tax_exempt' },
        { text: t(language, 'taxStatus.licensed'), callback_data: 'onboard_tax_licensed' },
      ],
    ],
  };

  const message =
    t(language, 'onboarding.step4Title') + '\n' + t(language, 'onboarding.step4Prompt');

  await sendMessage(chatId, message, { replyMarkup: keyboard });
}

/**
 * Handle tax status selection callback
 */
export async function handleTaxStatusSelection(query: TelegramCallbackQuery): Promise<void> {
  if (!query.message || !query.data) {
    return;
  }
  const chatId = query.message.chat.id;
  const data = query.data;

  const session = await getOnboardingSession(chatId);
  if (!session || !session.language) {
    return;
  }

  const language = session.language;
  const taxStatus =
    data === 'onboard_tax_exempt'
      ? t(language, 'taxStatus.exempt')
      : t(language, 'taxStatus.licensed');

  // Update session with tax status
  await updateOnboardingData(chatId, { taxStatus });
  await updateOnboardingSession(chatId, { step: 'logo' });

  // Acknowledge callback
  await answerCallbackQuery(query.id);

  // Send next step
  const message =
    t(language, 'onboarding.step4Confirm', { status: taxStatus }) +
    '\n\n' +
    t(language, 'onboarding.step5Title') +
    '\n' +
    t(language, 'onboarding.step5Prompt');

  await sendMessage(chatId, message);

  logger.info({ chatId, taxStatus }, 'Tax status selected, moved to logo step');
}

/**
 * Handle address step
 */
async function handleAddressStep(msg: TelegramMessage, language: Language): Promise<void> {
  const chatId = msg.chat.id;
  const address = msg.text?.trim();

  if (!address) {
    await sendMessage(chatId, t(language, 'onboarding.step3Prompt'));
    return;
  }

  // Validate address
  const addressValidation = addressSchema.safeParse(address);
  if (!addressValidation.success) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step3Prompt') + '\n\n❌ כתובת לא תקינה - חייבת להכיל בין 5-200 תווים'
    );
    return;
  }

  await updateOnboardingData(chatId, { address });
  await updateOnboardingSession(chatId, { step: 'tax_status' });

  // First acknowledge the address
  await sendMessage(chatId, t(language, 'onboarding.step3Confirm', { address }));

  // Then send tax status selection with buttons
  await sendTaxStatusSelection(chatId, language);
}

/**
 * Handle logo step (supports both photo and document uploads)
 */
async function handleLogoStep(msg: TelegramMessage, language: Language): Promise<void> {
  const chatId = msg.chat.id;

  // Check if user wants to skip
  if (msg.text?.trim() === '/skip') {
    await updateOnboardingSession(chatId, { step: 'sheet' });

    const message = await getSheetStepMessage(language);
    await sendMessage(chatId, t(language, 'onboarding.step4Skipped') + '\n\n' + message);
    return;
  }

  // Check if photo or document uploaded
  let fileId: string | undefined;

  if (msg.photo && msg.photo.length > 0) {
    // Photo upload (compressed by Telegram)
    const photo = msg.photo[msg.photo.length - 1];
    fileId = photo.file_id;
  } else if (msg.document) {
    // Document upload (original quality, check if image)
    const mimeType = msg.document.mime_type || '';
    const supportedImageTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ];

    if (
      supportedImageTypes.includes(mimeType) ||
      msg.document.file_name?.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)
    ) {
      fileId = msg.document.file_id;
    }
  }

  if (!fileId) {
    await sendMessage(chatId, t(language, 'onboarding.step4Invalid'));
    return;
  }

  try {
    const { buffer, filePath } = await downloadFileById(fileId);
    const extension = getFileExtension(filePath);

    // Upload logo to Cloud Storage
    const config = getConfig();
    const filename = `logo.${extension}`;
    const logoUrl = await uploadLogo(buffer, filename, config.storageBucket, chatId);

    await updateOnboardingData(chatId, { logoUrl });
    await updateOnboardingSession(chatId, { step: 'sheet' });

    const message = await getSheetStepMessage(language);
    await sendMessage(chatId, t(language, 'onboarding.step4Confirm') + '\n\n' + message);
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to upload logo');
    await sendMessage(chatId, t(language, 'onboarding.step4Invalid'));
  }
}

/**
 * Get sheet step message with service account email
 */
async function getSheetStepMessage(language: Language): Promise<string> {
  // Get or cache service account email
  if (!SERVICE_ACCOUNT_CACHE.email) {
    SERVICE_ACCOUNT_CACHE.email = await getServiceAccountEmail();
  }

  return (
    t(language, 'onboarding.step5Title') +
    '\n' +
    t(language, 'onboarding.step5Prompt', { serviceAccount: SERVICE_ACCOUNT_CACHE.email })
  );
}

/**
 * Handle sheet step
 */
async function handleSheetStep(msg: TelegramMessage, language: Language): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) {
    return;
  }

  // Check if user wants to skip
  if (text === '/skip') {
    await updateOnboardingSession(chatId, { step: 'counter' });

    await sendMessage(chatId, t(language, 'onboarding.step6Skipped'));
    await sendCounterSelection(chatId, language);
    return;
  }

  // Validate sheet ID format
  const sheetIdValidation = googleSheetIdSchema.safeParse(text);
  if (!sheetIdValidation.success) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step6Invalid') +
        '\n\n❌ מזהה גיליון לא תקין - חייב להכיל לפחות 20 תווים (אותיות, מספרים, מקפים)'
    );
    return;
  }

  // Test sheet access
  try {
    const tabs = await testSheetAccess(text);

    await updateOnboardingData(chatId, { sheetId: text });
    await updateOnboardingSession(chatId, { step: 'counter' });

    await sendMessage(chatId, t(language, 'onboarding.step6Confirm', { tabs: tabs.join(', ') }));
    await sendCounterSelection(chatId, language);
  } catch (error) {
    logger.error({ error, chatId, sheetId: text }, 'Failed to access sheet');

    if (!SERVICE_ACCOUNT_CACHE.email) {
      SERVICE_ACCOUNT_CACHE.email = await getServiceAccountEmail();
    }

    await sendMessage(
      chatId,
      t(language, 'onboarding.step6Error', { serviceAccount: SERVICE_ACCOUNT_CACHE.email })
    );
  }
}

/**
 * Test if we can access the Google Sheet
 */
async function testSheetAccess(sheetId: string): Promise<string[]> {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
  });

  // Get tab names
  const tabNames =
    response.data.sheets?.map((sheet) => sheet.properties?.title || 'Untitled') || [];

  return tabNames;
}

/**
 * Send counter selection with inline keyboard
 */
async function sendCounterSelection(chatId: number, language: Language): Promise<void> {
  const keyboard: TelegramInlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: t(language, 'counter.startFromOne'), callback_data: 'onboard_counter_1' }],
      [{ text: t(language, 'counter.haveExisting'), callback_data: 'onboard_counter_custom' }],
    ],
  };

  const message =
    t(language, 'onboarding.step7Title') + '\n' + t(language, 'onboarding.step7Prompt');

  await sendMessage(chatId, message, { replyMarkup: keyboard });
}

/**
 * Handle counter selection callback
 */
export async function handleCounterSelection(query: TelegramCallbackQuery): Promise<void> {
  if (!query.message || !query.data) {
    return;
  }
  const chatId = query.message.chat.id;
  const data = query.data;

  const session = await getOnboardingSession(chatId);
  if (!session || !session.language) {
    return;
  }

  const language = session.language;

  // Acknowledge callback
  await answerCallbackQuery(query.id);

  if (data === 'onboard_counter_1') {
    // Start from 1 - finalize immediately
    await updateOnboardingData(chatId, { startingCounter: 0 });
    await finalizeOnboarding(chatId, language);
  } else if (data === 'onboard_counter_custom') {
    // User has existing invoices - ask for the number
    await sendMessage(
      chatId,
      t(language, 'onboarding.step7Title') + '\n' + 'Please send the starting invoice number:'
    );
    // Stay in counter step to receive the number
  }

  logger.info({ chatId, choice: data }, 'Counter option selected');
}

/**
 * Handle counter step (final step)
 */
async function handleCounterStep(msg: TelegramMessage, language: Language): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) {
    return;
  }

  let startingCounter = 0;

  // Check if user wants to skip
  if (text === '/skip') {
    startingCounter = 0; // Will start from 1
  } else {
    // Parse number
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 0) {
      await sendMessage(chatId, t(language, 'onboarding.step7Invalid'));
      return;
    }
    startingCounter = num;
  }

  await updateOnboardingData(chatId, { startingCounter });

  // Now create the business config and complete onboarding
  await finalizeOnboarding(chatId, language);
}

/**
 * Finalize onboarding: create business config and complete session
 */
async function finalizeOnboarding(chatId: number, language: Language): Promise<void> {
  const session = await getOnboardingSession(chatId);
  if (!session) {
    throw new Error('Onboarding session not found');
  }

  const data = session.data;

  // Validate all required fields
  if (
    !data.businessName ||
    !data.ownerName ||
    !data.ownerIdNumber ||
    !data.phone ||
    !data.email ||
    !data.address ||
    !data.taxStatus
  ) {
    throw new Error('Missing required onboarding data');
  }

  // Create business config document
  const config: BusinessConfigDocument = {
    language,
    business: {
      name: data.businessName,
      taxId: data.ownerIdNumber,
      taxStatus: data.taxStatus, // Use selected tax status
      email: data.email,
      phone: data.phone,
      address: data.address,
      logoUrl: data.logoUrl,
      sheetId: data.sheetId, // Per-customer Google Sheet ID
    },
    invoice: {
      digitalSignatureText: 'מסמך ממוחשב חתום דיגיטלית',
      generatedByText: 'הופק ע"י Papertrail',
    },
  };

  // Save business config
  await saveBusinessConfig(config, chatId);
  logger.info({ chatId }, 'Business config created');

  // Initialize counter if specified
  if (data.startingCounter && data.startingCounter > 0) {
    await initializeCounter(chatId, data.startingCounter);
    logger.info({ chatId, startingCounter: data.startingCounter }, 'Invoice counter initialized');
  }

  // Complete onboarding session
  await completeOnboarding(chatId);

  // Send completion message
  const message = t(language, 'onboarding.complete', {
    businessName: data.businessName,
    ownerName: data.ownerName,
    taxId: data.ownerIdNumber,
    address: data.address,
    phone: data.phone,
    email: data.email,
    logo: data.logoUrl ? '✅' : '⏭️',
    sheet: data.sheetId ? '✅' : '⏭️',
    counter:
      data.startingCounter && data.startingCounter > 0 ? data.startingCounter.toString() : '1',
  });

  await sendMessage(chatId, message);

  logger.info({ chatId }, 'Onboarding completed successfully');
}

// ============================================================================
// Express-compatible handlers (called from routes)
// ============================================================================

import { Request, Response } from 'express';
import type {
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
  TaskPayload,
} from '../../../../shared/types';

/**
 * Express handler for /onboard command
 */
export async function handleOnboardCommandExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceCommandPayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleOnboardCommandExpress',
  });

  log.info('Processing onboard command');

  try {
    // Build TelegramMessage-like object from payload
    const msg: TelegramMessage = {
      message_id: payload.messageId,
      chat: {
        id: payload.chatId,
        type: payload.chatId < 0 ? 'supergroup' : 'private',
        title: payload.chatTitle,
      },
      date: new Date(payload.receivedAt).getTime() / 1000,
      text: payload.text,
      from: {
        id: payload.userId,
        is_bot: false,
        first_name: payload.firstName,
        username: payload.username,
      },
    };

    await handleOnboardCommand(msg);

    res.status(200).json({ ok: true });
  } catch (error) {
    log.error({ error }, 'Error handling onboard command');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Express handler for onboarding messages
 */
export async function handleOnboardingMessageExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceMessagePayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleOnboardingMessageExpress',
  });

  log.debug('Processing onboarding message');

  try {
    // Check if user is in onboarding flow
    const session = await getOnboardingSession(payload.chatId);
    if (!session) {
      // Not in onboarding, ignore
      res.status(200).json({ ok: true, action: 'ignored_not_in_onboarding' });
      return;
    }

    // Build TelegramMessage-like object from payload
    const msg: TelegramMessage = {
      message_id: payload.messageId,
      chat: {
        id: payload.chatId,
        type: payload.chatId < 0 ? 'supergroup' : 'private',
      },
      date: new Date(payload.receivedAt).getTime() / 1000,
      text: payload.text,
      from: {
        id: payload.userId,
        is_bot: false,
        first_name: payload.firstName,
        username: payload.username,
      },
    };

    await handleOnboardingMessage(msg);

    res.status(200).json({ ok: true });
  } catch (error) {
    log.error({ error }, 'Error handling onboarding message');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Express handler for onboarding callbacks
 */
export async function handleOnboardingCallbackExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceCallbackPayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleOnboardingCallbackExpress',
  });

  log.debug('Processing onboarding callback');

  try {
    // Build TelegramCallbackQuery-like object from payload
    const query: TelegramCallbackQuery = {
      id: payload.callbackQueryId,
      from: {
        id: payload.userId,
        is_bot: false,
        first_name: 'User',
        username: payload.username,
      },
      message: {
        message_id: payload.messageId,
        chat: {
          id: payload.chatId,
          type: payload.chatId < 0 ? 'supergroup' : 'private',
        },
        date: Date.now() / 1000,
      },
      chat_instance: 'onboarding',
      data: payload.data,
    };

    // Check if this is a language selection callback
    if (payload.data.startsWith('onboard_lang_')) {
      await handleLanguageSelection(query);
      res.status(200).json({ ok: true });
    }
    // Check if this is a tax status selection callback
    else if (payload.data.startsWith('onboard_tax_')) {
      await handleTaxStatusSelection(query);
      res.status(200).json({ ok: true });
    }
    // Check if this is a counter selection callback
    else if (payload.data.startsWith('onboard_counter_')) {
      await handleCounterSelection(query);
      res.status(200).json({ ok: true });
    } else {
      // Unknown onboarding callback
      log.warn({ data: payload.data }, 'Unknown onboarding callback data');
      res.status(200).json({ ok: true, action: 'ignored_unknown_callback' });
    }
  } catch (error) {
    log.error({ error }, 'Error handling onboarding callback');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Check if message contains a photo for onboarding
 */
export async function handleOnboardingPhoto(msg: TelegramMessage): Promise<boolean> {
  const chatId = msg.chat.id;
  const session = await getOnboardingSession(chatId);

  // Check if in logo step
  if (!session || !session.language || session.step !== 'logo') {
    return false;
  }

  // Handle as logo upload
  await handleLogoStep(msg, session.language);
  return true;
}

/**
 * Express handler for onboarding photo/document uploads (logo)
 */
export async function handleOnboardingPhotoExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as TaskPayload;
  const log = logger.child({
    chatId: payload.chatId,
    messageId: payload.messageId,
    handler: 'handleOnboardingPhotoExpress',
  });

  log.debug('Processing onboarding photo/document');

  try {
    // Check if user is in onboarding flow at logo step
    const session = await getOnboardingSession(payload.chatId);
    if (!session || session.step !== 'logo' || !session.language) {
      // Not in logo step or language not set, ignore
      log.debug('Not in logo step or language not set, ignoring photo');
      res.status(200).json({ ok: true, action: 'ignored_not_in_logo_step' });
      return;
    }

    // Build TelegramMessage-like object with photo from payload
    const msg: TelegramMessage = {
      message_id: payload.messageId,
      chat: {
        id: payload.chatId,
        type: payload.chatId < 0 ? 'supergroup' : 'private',
      },
      date: new Date(payload.receivedAt).getTime() / 1000,
      // Use fileId to construct photo array (Telegram format)
      // Note: file_unique_id is set to empty string as we only have file_id in TaskPayload
      // This is acceptable since handleLogoStep only uses file_id for downloading
      photo: [
        {
          file_id: payload.fileId,
          file_unique_id: '',
          width: 0,
          height: 0,
        },
      ],
    };

    await handleLogoStep(msg, session.language);

    res.status(200).json({ ok: true });
  } catch (error) {
    log.error({ error }, 'Error handling onboarding photo');
    res.status(500).json({ error: 'Internal server error' });
  }
}

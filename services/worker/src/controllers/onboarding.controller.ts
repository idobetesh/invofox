/**
 * Onboarding Controller (Refactored)
 * Thin routing layer - delegates to services
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type {
  TelegramMessage,
  TelegramCallbackQuery,
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
  TaskPayload,
} from '../../../../shared/types';
import {
  getOnboardingSession,
  updateOnboardingSession,
  startOnboarding,
} from '../services/onboarding/onboarding.service';
import {
  handleBusinessNameStep,
  handleOwnerDetailsStep,
  handleAddressStep,
  handleLogoStep,
  handleSheetStep,
  handleCounterStep,
  handleTaxStatusSelection,
  handleCounterSelection,
} from '../services/onboarding/steps.service';
import {
  getLanguageSelectionMessage,
  getLanguageSelectionKeyboard,
} from '../services/onboarding/messages.service';
import { hasBusinessConfig } from '../services/business-config/config.service';
import { sendMessage, answerCallbackQuery } from '../services/telegram.service';
import { validateInviteCode, markInviteCodeAsUsed } from '../services/invite-code.service';
import { isChatApproved, approveChatWithInviteCode } from '../services/approved-chats.service';
import { recordFailedOnboardingAttempt, clearRateLimit } from '../services/rate-limiter.service';
import { t, type Language } from '../services/i18n/languages';
import logger from '../logger';

/**
 * Handle /onboard command
 */
export async function handleOnboardCommand(msg: TelegramMessage): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const chatTitle = msg.chat.title || msg.chat.first_name || 'Private Chat';
  const log = logger.child({ chatId, userId, command: 'onboard' });

  if (!userId) {
    log.warn('Onboard command ignored: could not identify user');
    await recordFailedOnboardingAttempt(chatId);
    return;
  }

  const configExists = await hasBusinessConfig(chatId);
  if (configExists) {
    await sendMessage(
      chatId,
      '⚠️ Your business is already configured.\n\nUse /settings to view or edit your configuration.'
    );
    log.info('Onboarding blocked: config already exists');
    return;
  }

  const isApproved = await isChatApproved(chatId);

  if (!isApproved) {
    const inviteCode = msg.text?.trim().split(/\s+/)[1];

    if (!inviteCode) {
      log.warn('Onboard command ignored: no invite code provided');
      await recordFailedOnboardingAttempt(chatId);
      return;
    }

    const validation = await validateInviteCode(inviteCode);

    if (!validation.valid) {
      log.warn({ inviteCode, reason: validation.reason }, 'Invalid invite code');
      await recordFailedOnboardingAttempt(chatId);
      return;
    }

    await approveChatWithInviteCode(chatId, chatTitle, inviteCode, userId);
    await markInviteCodeAsUsed(inviteCode, { chatId, chatTitle });
    await clearRateLimit(chatId);

    log.info({ inviteCode }, 'Chat approved');
  }

  await startOnboarding(chatId, userId);
  log.info('Onboarding started');

  await sendMessage(chatId, getLanguageSelectionMessage(), {
    replyMarkup: getLanguageSelectionKeyboard(),
  });
}

/**
 * Handle language selection
 */
export async function handleLanguageSelection(query: TelegramCallbackQuery): Promise<void> {
  if (!query.message || !query.data) {
    return;
  }

  const chatId = query.message.chat.id;
  const language: Language = query.data === 'onboard_lang_en' ? 'en' : 'he';

  await updateOnboardingSession(chatId, { language, step: 'business_name' });
  await answerCallbackQuery(query.id);

  const message =
    t(language, 'onboarding.languageSet') +
    '\n\n' +
    t(language, 'onboarding.step1Title') +
    '\n' +
    t(language, 'onboarding.step1Prompt');

  await sendMessage(chatId, message);
  logger.info({ chatId, language }, 'Language selected');
}

/**
 * Handle tax status selection
 */
export async function handleTaxStatusCallback(query: TelegramCallbackQuery): Promise<void> {
  if (!query.message || !query.data) {
    return;
  }

  const chatId = query.message.chat.id;
  const session = await getOnboardingSession(chatId);

  if (!session || !session.language) {
    return;
  }

  const language = session.language;
  const taxStatus =
    query.data === 'onboard_tax_exempt'
      ? t(language, 'taxStatus.exempt')
      : t(language, 'taxStatus.licensed');

  await answerCallbackQuery(query.id);
  await handleTaxStatusSelection(chatId, taxStatus, language);

  logger.info({ chatId, taxStatus }, 'Tax status selected');
}

/**
 * Handle counter selection
 */
export async function handleCounterCallback(query: TelegramCallbackQuery): Promise<void> {
  const log = logger.child({ function: 'handleCounterCallback', queryId: query.id });
  log.info({ data: query.data }, 'Counter callback received');

  if (!query.message || !query.data) {
    log.warn('Missing message or data');
    return;
  }

  const chatId = query.message.chat.id;
  log.info({ chatId }, 'Got chat ID');

  const session = await getOnboardingSession(chatId);
  log.info({ hasSession: !!session, language: session?.language }, 'Session retrieved');

  if (!session || !session.language) {
    log.warn('No session or language');
    return;
  }

  const startFromOne = query.data === 'onboard_counter_1';
  log.info({ startFromOne }, 'Determined counter choice');

  await answerCallbackQuery(query.id);
  log.info('Answered callback query');

  await handleCounterSelection(chatId, startFromOne, session.language, session);
  log.info('Counter selection handled');

  logger.info({ chatId, choice: query.data }, 'Counter selected');
}

/**
 * Route message to appropriate step handler
 */
export async function handleOnboardingMessage(msg: TelegramMessage): Promise<void> {
  const session = await getOnboardingSession(msg.chat.id);

  if (!session || !session.language) {
    return;
  }

  const chatId = msg.chat.id;
  const language = session.language;
  const text = msg.text?.trim() || '';
  const log = logger.child({ chatId, step: session.step });

  try {
    switch (session.step) {
      case 'business_name':
        await handleBusinessNameStep(chatId, text, language);
        break;
      case 'owner_details':
        await handleOwnerDetailsStep(chatId, text, language);
        break;
      case 'address':
        await handleAddressStep(chatId, text, language);
        break;
      case 'logo':
        await handleLogoStep(msg, chatId, language);
        break;
      case 'sheet':
        await handleSheetStep(chatId, text, language);
        break;
      case 'counter':
        await handleCounterStep(chatId, text, language, session);
        break;
      default:
        log.warn('Unknown step');
    }
  } catch (error) {
    log.error({ error }, 'Error handling step');
    await sendMessage(chatId, t(language, 'common.error', { error: String(error) }));
  }
}

/**
 * Handle photo for onboarding
 */
export async function handleOnboardingPhoto(msg: TelegramMessage): Promise<boolean> {
  const session = await getOnboardingSession(msg.chat.id);

  if (!session || !session.language || session.step !== 'logo') {
    return false;
  }

  await handleLogoStep(msg, msg.chat.id, session.language);
  return true;
}

// Express handlers
export async function handleOnboardCommandExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceCommandPayload;
  const log = logger.child({ chatId: payload.chatId, userId: payload.userId });

  log.info('Processing onboard command');

  try {
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
    res.status(StatusCodes.OK).json({ ok: true });
  } catch (error) {
    log.error({ error }, 'Error handling command');
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
  }
}

export async function handleOnboardingMessageExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceMessagePayload;
  const log = logger.child({ chatId: payload.chatId });

  try {
    const session = await getOnboardingSession(payload.chatId);
    if (!session) {
      res.status(StatusCodes.OK).json({ ok: true, action: 'ignored' });
      return;
    }

    const msg: TelegramMessage = {
      message_id: payload.messageId,
      chat: { id: payload.chatId, type: payload.chatId < 0 ? 'supergroup' : 'private' },
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
    res.status(StatusCodes.OK).json({ ok: true });
  } catch (error) {
    log.error({ error }, 'Error handling message');
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
  }
}

export async function handleOnboardingCallbackExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceCallbackPayload;

  try {
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
        chat: { id: payload.chatId, type: payload.chatId < 0 ? 'supergroup' : 'private' },
        date: Date.now() / 1000,
      },
      chat_instance: 'onboarding',
      data: payload.data,
    };

    if (payload.data.startsWith('onboard_lang_')) {
      await handleLanguageSelection(query);
    } else if (payload.data.startsWith('onboard_tax_')) {
      await handleTaxStatusCallback(query);
    } else if (payload.data.startsWith('onboard_counter_')) {
      await handleCounterCallback(query);
    }

    res.status(StatusCodes.OK).json({ ok: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: errorMessage, stack: errorStack, payload }, 'Error handling callback');
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
  }
}

export async function handleOnboardingPhotoExpress(req: Request, res: Response): Promise<void> {
  const payload = req.body as TaskPayload;

  try {
    const session = await getOnboardingSession(payload.chatId);
    if (!session || session.step !== 'logo' || !session.language) {
      res.status(StatusCodes.OK).json({ ok: true, action: 'ignored' });
      return;
    }

    const msg: TelegramMessage = {
      message_id: payload.messageId,
      chat: { id: payload.chatId, type: payload.chatId < 0 ? 'supergroup' : 'private' },
      date: new Date(payload.receivedAt).getTime() / 1000,
      photo: [{ file_id: payload.fileId, file_unique_id: '', width: 0, height: 0 }],
    };

    await handleLogoStep(msg, payload.chatId, session.language);
    res.status(StatusCodes.OK).json({ ok: true });
  } catch (error) {
    logger.error({ error }, 'Error handling photo');
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
  }
}

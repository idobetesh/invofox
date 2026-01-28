/**
 * Webhook controller - handles Telegram webhook requests
 * Delegates to specialized handlers for each command type
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getConfig } from '../config';
import * as telegramService from '../services/telegram';
import * as tasksService from '../services/tasks.service';
import * as approvedChatsService from '../services/approved-chats.service';
import logger from '../logger';

// Import specialized handlers
import {
  handleCallbackQuery,
  handleInvoiceCommand,
  handleTextMessage,
  handleOnboardCommand,
  handleReportCommand,
} from '../handlers';

/**
 * Handle incoming Telegram webhook updates
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const config = getConfig();
  const { secretPath } = req.params;

  // Validate secret path
  if (secretPath !== config.webhookSecretPath) {
    logger.warn('Invalid webhook secret path received');
    res.status(StatusCodes.NOT_FOUND).json({ error: 'Not found' });
    return;
  }

  // Validate and parse update with Zod
  const update = telegramService.parseUpdate(req.body);
  if (!update) {
    logger.warn({ body: req.body }, 'Invalid Telegram update received');
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid update' });
    return;
  }

  logger.info(
    {
      updateId: update.update_id,
      hasMessage: !!update.message,
      hasText: !!update.message?.text,
      text: update.message?.text,
      hasDocument: !!update.message?.document,
      hasPhoto: !!update.message?.photo,
    },
    'Received Telegram update'
  );

  // Handle callback queries (button presses)
  if (telegramService.isCallbackQuery(update)) {
    logger.info('Processing callback query');
    await handleCallbackQuery(update, config, res);
    return;
  }

  // Handle /invoice command
  if (telegramService.isInvoiceCommand(update)) {
    logger.info('Processing /invoice command');
    await handleInvoiceCommand(update, config, res);
    return;
  }

  // Handle /onboard command
  if (telegramService.isOnboardCommand(update)) {
    logger.info('Processing /onboard command');
    await handleOnboardCommand(update, config, res);
    return;
  }

  // Handle /report command
  if (telegramService.isReportCommand(update)) {
    logger.info('Processing /report command');
    await handleReportCommand(update, config, res);
    return;
  }

  // Handle text messages (including /skip during onboarding)
  if (telegramService.isTextMessage(update)) {
    logger.debug('Processing text message');
    await handleTextMessage(update, config, res);
    return;
  }

  // Handle other commands (could add /status, /help later)
  // This is checked AFTER text messages so /skip can work during onboarding
  if (telegramService.isCommand(update)) {
    logger.debug('Ignoring unknown command message');
    res.status(StatusCodes.OK).json({ ok: true, action: 'ignored_command' });
    return;
  }

  // Process photo messages
  if (telegramService.isPhotoMessage(update)) {
    // Extract payload for worker
    const payload = telegramService.extractTaskPayload(update);
    if (!payload) {
      logger.error('Failed to extract payload from photo message');
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'Failed to extract payload' });
      return;
    }

    // Check if this photo is for onboarding (logo upload)
    const inOnboarding = await approvedChatsService.isInOnboarding(payload.chatId);

    if (inOnboarding) {
      logger.info(
        { chatId: payload.chatId, messageId: payload.messageId },
        'Processing photo for onboarding (logo upload)'
      );

      try {
        const taskName = await tasksService.enqueueOnboardingPhotoTask(payload, config);
        logger.info({ taskName }, 'Onboarding photo task enqueued successfully');

        res.status(StatusCodes.OK).json({
          ok: true,
          action: 'onboarding_photo_enqueued',
          task: taskName,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to enqueue onboarding photo task');
        res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .json({ error: 'Failed to enqueue onboarding photo task' });
      }
      return;
    }

    // Regular invoice photo processing
    logger.info(
      { chatId: payload.chatId, messageId: payload.messageId },
      'Enqueueing photo message for worker'
    );

    try {
      const taskName = await tasksService.enqueueProcessingTask(payload, config);
      logger.info({ taskName }, 'Photo task enqueued successfully');

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'photo_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue photo task');
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to enqueue photo task' });
    }
    return;
  }

  // Process document messages (PDF invoices)
  if (telegramService.isDocumentMessage(update)) {
    const payload = telegramService.extractDocumentTaskPayload(update);
    if (!payload) {
      logger.error('Failed to extract document payload');
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'Failed to extract payload' });
      return;
    }

    logger.info(
      { chatId: payload.chatId, messageId: payload.messageId },
      'Enqueueing document message for worker'
    );

    try {
      const taskName = await tasksService.enqueueProcessingTask(payload, config);
      logger.info({ taskName }, 'Document task enqueued successfully');

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'document_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue document task');
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to enqueue document task' });
    }
    return;
  }

  // Ignore all other updates (stickers, voice messages, etc.)
  logger.debug('Ignoring non-processable update');
  res.status(StatusCodes.OK).json({ ok: true, action: 'ignored' });
}

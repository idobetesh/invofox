/**
 * Webhook controller - handles Telegram webhook requests
 */

import { Request, Response } from 'express';
import { getConfig } from '../config';
import * as telegramService from '../services/telegram.service';
import * as tasksService from '../services/tasks.service';
import * as rateLimiter from '../services/rate-limiter.service';
import * as approvedChatsService from '../services/approved-chats.service';
import logger from '../logger';

/**
 * Handle incoming Telegram webhook updates
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const config = getConfig();
  const { secretPath } = req.params;

  // Validate secret path
  if (secretPath !== config.webhookSecretPath) {
    logger.warn('Invalid webhook secret path received');
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Validate and parse update with Zod
  const update = telegramService.parseUpdate(req.body);
  if (!update) {
    logger.warn({ body: req.body }, 'Invalid Telegram update received');
    res.status(400).json({ error: 'Invalid update' });
    return;
  }

  logger.info({ updateId: update.update_id }, 'Received Telegram update');

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

  // Handle other commands (could add /status, /help later)
  if (telegramService.isCommand(update)) {
    logger.debug('Ignoring unknown command message');
    res.status(200).json({ ok: true, action: 'ignored_command' });
    return;
  }

  // Handle text messages (might be part of invoice conversation)
  if (telegramService.isTextMessage(update)) {
    logger.debug('Processing text message');
    await handleTextMessage(update, config, res);
    return;
  }

  // Process photo messages
  if (telegramService.isPhotoMessage(update)) {
    // Extract payload for worker
    const payload = telegramService.extractTaskPayload(update);
    if (!payload) {
      logger.error('Failed to extract payload from photo message');
      res.status(400).json({ error: 'Failed to extract payload' });
      return;
    }

    logger.info(
      { chatId: payload.chatId, messageId: payload.messageId, uploader: payload.uploaderUsername },
      'Processing photo message'
    );

    try {
      const taskName = await tasksService.enqueueProcessingTask(payload, config);
      logger.info({ taskName }, 'Task enqueued successfully');

      res.status(200).json({
        ok: true,
        action: 'enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue task');
      res.status(500).json({ error: 'Failed to enqueue task' });
    }
    return;
  }

  // Process document files (PDF, images)
  if (telegramService.isDocumentMessage(update)) {
    if (!telegramService.isSupportedDocument(update)) {
      logger.debug('Ignoring unsupported document type');
      res.status(200).json({ ok: true, action: 'ignored_unsupported_document' });
      return;
    }

    // Extract document info for validation
    const message = update.message || update.channel_post;
    const document = message?.document;

    if (!document || !telegramService.isFileSizeValid(document)) {
      logger.warn({ fileSize: document?.file_size }, 'Document exceeds size limit (5 MB)');
      res.status(200).json({ ok: true, action: 'rejected_size_limit' });
      return;
    }

    // Extract payload for worker
    const payload = telegramService.extractDocumentTaskPayload(update);
    if (!payload) {
      logger.error('Failed to extract document payload');
      res.status(400).json({ error: 'Failed to extract payload' });
      return;
    }

    logger.info(
      {
        chatId: payload.chatId,
        messageId: payload.messageId,
        uploader: payload.uploaderUsername,
        fileName: document.file_name,
        mimeType: document.mime_type,
      },
      'Processing document'
    );

    try {
      const taskName = await tasksService.enqueueProcessingTask(payload, config);
      logger.info({ taskName }, 'Document task enqueued successfully');

      res.status(200).json({
        ok: true,
        action: 'enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue document task');
      res.status(500).json({ error: 'Failed to enqueue task' });
    }
    return;
  }

  // Ignore all other message types
  logger.debug('Ignoring non-photo, non-document message');
  res.status(200).json({ ok: true, action: 'ignored' });
}

/**
 * Handle callback query by enqueueing task for worker
 */
async function handleCallbackQuery(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: ReturnType<typeof getConfig>,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(400).json({ error: 'Invalid update' });
    return;
  }

  const callbackPayload = telegramService.extractCallbackPayload(update);
  if (!callbackPayload) {
    logger.error('Failed to extract callback payload');
    res.status(400).json({ error: 'Failed to extract callback payload' });
    return;
  }

  // Check if this is an onboarding-related callback
  if (telegramService.isOnboardingCallback(callbackPayload.data)) {
    const onboardingPayload = telegramService.extractInvoiceCallbackPayload(update);
    if (!onboardingPayload) {
      logger.error('Failed to extract onboarding callback payload');
      res.status(400).json({ error: 'Failed to extract onboarding callback payload' });
      return;
    }

    logger.info(
      { callbackQueryId: onboardingPayload.callbackQueryId },
      'Enqueueing onboarding callback for worker'
    );

    try {
      const taskName = await tasksService.enqueueOnboardCallbackTask(onboardingPayload, config);
      logger.info({ taskName }, 'Onboarding callback task enqueued successfully');

      res.status(200).json({
        ok: true,
        action: 'onboarding_callback_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue onboarding callback task');
      res.status(500).json({ error: 'Failed to enqueue onboarding callback task' });
    }
    return;
  }

  // Check if this is an invoice-related callback
  if (telegramService.isInvoiceCallback(callbackPayload.data)) {
    const invoicePayload = telegramService.extractInvoiceCallbackPayload(update);
    if (!invoicePayload) {
      logger.error('Failed to extract invoice callback payload');
      res.status(400).json({ error: 'Failed to extract invoice callback payload' });
      return;
    }

    logger.info(
      { callbackQueryId: invoicePayload.callbackQueryId },
      'Enqueueing invoice callback for worker'
    );

    try {
      const taskName = await tasksService.enqueueInvoiceCallbackTask(invoicePayload, config);
      logger.info({ taskName }, 'Invoice callback task enqueued successfully');

      res.status(200).json({
        ok: true,
        action: 'invoice_callback_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue invoice callback task');
      res.status(500).json({ error: 'Failed to enqueue invoice callback task' });
    }
    return;
  }

  // Regular callback (duplicate handling, etc.)
  logger.info(
    { callbackQueryId: callbackPayload.callbackQueryId },
    'Enqueueing callback query for worker'
  );

  try {
    const taskName = await tasksService.enqueueCallbackTask(callbackPayload, config);
    logger.info({ taskName }, 'Callback task enqueued successfully');

    res.status(200).json({
      ok: true,
      action: 'callback_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue callback task');
    res.status(500).json({ error: 'Failed to enqueue callback task' });
  }
}

/**
 * Handle /invoice command
 */
async function handleInvoiceCommand(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: ReturnType<typeof getConfig>,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(400).json({ error: 'Invalid update' });
    return;
  }

  const payload = telegramService.extractInvoiceCommandPayload(update);
  if (!payload) {
    logger.error('Failed to extract invoice command payload');
    res.status(400).json({ error: 'Failed to extract invoice command payload' });
    return;
  }

  logger.info(
    { chatId: payload.chatId, userId: payload.userId },
    'Enqueueing invoice command for worker'
  );

  try {
    const taskName = await tasksService.enqueueInvoiceCommandTask(payload, config);
    logger.info({ taskName }, 'Invoice command task enqueued successfully');

    res.status(200).json({
      ok: true,
      action: 'invoice_command_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue invoice command task');
    res.status(500).json({ error: 'Failed to enqueue invoice command task' });
  }
}

/**
 * Handle text message (might be part of invoice conversation or onboarding)
 */
async function handleTextMessage(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: ReturnType<typeof getConfig>,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(400).json({ error: 'Invalid update' });
    return;
  }

  const payload = telegramService.extractInvoiceMessagePayload(update);
  if (!payload) {
    // Not a valid message
    logger.debug('Text message not suitable for processing');
    res.status(200).json({ ok: true, action: 'ignored_text' });
    return;
  }

  // Check if chat is approved to determine routing
  const isApproved = await approvedChatsService.isChatApproved(payload.chatId);

  if (isApproved) {
    // Approved chat - route to invoice flow
    logger.info(
      { chatId: payload.chatId, userId: payload.userId },
      'Enqueueing invoice message for worker'
    );

    try {
      const taskName = await tasksService.enqueueInvoiceMessageTask(payload, config);
      logger.info({ taskName }, 'Invoice message task enqueued successfully');

      res.status(200).json({
        ok: true,
        action: 'invoice_message_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue invoice message task');
      res.status(500).json({ error: 'Failed to enqueue invoice message task' });
    }
  } else {
    // Not approved - route to onboarding flow
    logger.info(
      { chatId: payload.chatId, userId: payload.userId },
      'Enqueueing onboarding message for worker'
    );

    try {
      const taskName = await tasksService.enqueueOnboardMessageTask(payload, config);
      logger.info({ taskName }, 'Onboarding message task enqueued successfully');

      res.status(200).json({
        ok: true,
        action: 'onboarding_message_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue onboarding message task');
      res.status(500).json({ error: 'Failed to enqueue onboarding message task' });
    }
  }
}

/**
 * Handle /onboard command
 */
async function handleOnboardCommand(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: ReturnType<typeof getConfig>,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(400).json({ error: 'Invalid update' });
    return;
  }

  const payload = telegramService.extractInvoiceCommandPayload(update);
  if (!payload) {
    logger.error('Failed to extract onboard command payload');
    res.status(400).json({ error: 'Failed to extract onboard command payload' });
    return;
  }

  // Rate limiting: Check if chat is blocked due to too many unauthorized attempts
  if (await rateLimiter.isRateLimited(payload.chatId)) {
    const status = await rateLimiter.getRateLimitStatus(payload.chatId);
    logger.warn({ chatId: payload.chatId, status }, 'Onboard command blocked: rate limit exceeded');
    // Silently ignore (no task created, no further processing)
    res.status(200).json({
      ok: true,
      action: 'ignored_rate_limited',
    });
    return;
  }

  logger.info(
    { chatId: payload.chatId, userId: payload.userId },
    'Enqueueing onboard command for worker'
  );

  try {
    const taskName = await tasksService.enqueueOnboardCommandTask(payload, config);
    logger.info({ taskName }, 'Onboard command task enqueued successfully');

    res.status(200).json({
      ok: true,
      action: 'onboard_command_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue onboard command task');
    res.status(500).json({ error: 'Failed to enqueue onboard command task' });
  }
}

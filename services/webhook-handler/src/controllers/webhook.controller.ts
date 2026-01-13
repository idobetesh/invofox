/**
 * Webhook controller - handles Telegram webhook requests
 */

import { Request, Response } from 'express';
import { getConfig } from '../config';
import * as telegramService from '../services/telegram.service';
import * as tasksService from '../services/tasks.service';
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

  // Ignore commands for now (could add /status, /help later)
  if (telegramService.isCommand(update)) {
    logger.debug('Ignoring command message');
    res.status(200).json({ ok: true, action: 'ignored_command' });
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

  // Process PDF documents
  if (telegramService.isDocumentMessage(update)) {
    if (!telegramService.isPdfDocument(update)) {
      logger.debug('Ignoring non-PDF document');
      res.status(200).json({ ok: true, action: 'ignored_non_pdf' });
      return;
    }

    // Extract document info for validation
    const message = update.message || update.channel_post;
    const document = message?.document;

    if (!document || !telegramService.isFileSizeValid(document)) {
      logger.warn({ fileSize: document?.file_size }, 'PDF exceeds size limit (5 MB)');
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
      { chatId: payload.chatId, messageId: payload.messageId, uploader: payload.uploaderUsername, fileName: document.file_name },
      'Processing PDF document'
    );

    try {
      const taskName = await tasksService.enqueueProcessingTask(payload, config);
      logger.info({ taskName }, 'PDF task enqueued successfully');

      res.status(200).json({
        ok: true,
        action: 'enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue PDF task');
      res.status(500).json({ error: 'Failed to enqueue task' });
    }
    return;
  }

  // Ignore all other message types
  logger.debug('Ignoring non-photo, non-PDF message');
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

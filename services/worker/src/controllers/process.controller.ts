/**
 * Invoice processing controller
 */

import { Request, Response } from 'express';
import { getRetryCount, getMaxRetries } from '../middlewares/cloudTasks';
import * as invoiceService from '../services/invoice.service';
import * as storeService from '../services/store.service';
import logger from '../logger';
import type { TaskPayload, PipelineStep, CallbackPayload, DuplicateAction } from '../../../../shared/types';
import * as telegramService from '../services/telegram.service';

/**
 * Process an invoice image
 */
export async function processInvoice(req: Request, res: Response): Promise<void> {
  const payload = req.body as TaskPayload;

  // Validate payload
  if (
    typeof payload.chatId !== 'number' ||
    typeof payload.messageId !== 'number' ||
    typeof payload.fileId !== 'string'
  ) {
    logger.error({ payload }, 'Invalid payload');
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const retryCount = getRetryCount(req);
  const maxRetries = getMaxRetries();

  logger.info(
    { chatId: payload.chatId, messageId: payload.messageId, retry: retryCount, maxRetries },
    'Processing invoice'
  );

  try {
    const result = await invoiceService.processInvoice(payload);

    if (result.alreadyProcessed) {
      logger.info({ chatId: payload.chatId, messageId: payload.messageId }, 'Invoice already processed');
      res.status(200).json({ ok: true, action: 'already_processed' });
      return;
    }

    logger.info(
      { chatId: payload.chatId, messageId: payload.messageId, driveLink: result.driveLink },
      'Invoice processed successfully'
    );
    res.status(200).json({ ok: true, action: 'processed' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ chatId: payload.chatId, messageId: payload.messageId, error: errorMessage }, 'Processing error');

    // Check if this was the last retry
    if (retryCount >= maxRetries - 1) {
      logger.warn(
        { chatId: payload.chatId, messageId: payload.messageId },
        'Max retries reached, sending failure notification'
      );

      // Get job to find last step
      const job = await storeService.getJob(payload.chatId, payload.messageId);
      const lastStep: PipelineStep = job?.lastStep || 'download';
      const lastError = job?.lastError || errorMessage;

      await invoiceService.sendFailureNotification(
        payload.chatId,
        payload.messageId,
        lastStep,
        lastError
      );

      // Return success to prevent further retries
      res.status(200).json({
        ok: false,
        action: 'failed_permanently',
        error: lastError,
      });
      return;
    }

    // Return 500 to trigger retry
    res.status(500).json({
      ok: false,
      action: 'retry',
      error: errorMessage,
      retry: retryCount + 1,
    });
  }
}

/**
 * Manual failure notification endpoint (for testing)
 */
export async function notifyFailure(req: Request, res: Response): Promise<void> {
  const { chatId, messageId, lastStep, error } = req.body as {
    chatId: number;
    messageId: number;
    lastStep: PipelineStep;
    error: string;
  };

  if (!chatId || !messageId || !lastStep || !error) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    await invoiceService.sendFailureNotification(chatId, messageId, lastStep, error);
    res.status(200).json({ ok: true });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: errMessage });
  }
}

/**
 * Handle callback query from Telegram inline buttons
 * Used for duplicate invoice decisions
 */
export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { callbackQueryId, data, botMessageId } = req.body as {
    callbackQueryId: string;
    data: string;
    botMessageChatId: number;
    botMessageId: number;
  };

  if (!callbackQueryId || !data) {
    res.status(400).json({ error: 'Missing callback data' });
    return;
  }

  const log = logger.child({ callbackQueryId });
  log.info({ data }, 'Processing callback query');

  try {
    // Parse callback data
    const payload = JSON.parse(data) as CallbackPayload;
    const { action, chatId, messageId } = payload;

    if (!action || !chatId || !messageId) {
      throw new Error('Invalid callback payload');
    }

    // Answer callback immediately to remove loading state
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: action === 'keep_both' ? 'Keeping both...' : 'Deleting...',
    });

    // Process the decision
    const result = await invoiceService.handleDuplicateDecision(
      chatId,
      messageId,
      action as DuplicateAction,
      botMessageId
    );

    if (result.success) {
      log.info({ action, chatId, messageId }, 'Callback processed successfully');
      res.status(200).json({ ok: true, action });
    } else {
      log.warn({ error: result.error }, 'Callback processing failed');
      res.status(200).json({ ok: false, error: result.error });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Failed to process callback');

    // Try to answer callback with error
    try {
      await telegramService.answerCallbackQuery(callbackQueryId, {
        text: 'Error processing request',
        showAlert: true,
      });
    } catch {
      // Ignore answer errors
    }

    res.status(500).json({ error: errorMessage });
  }
}

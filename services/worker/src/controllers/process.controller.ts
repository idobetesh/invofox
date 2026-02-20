/**
 * Invoice processing controller
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getRetryCount, getMaxRetries } from '../middlewares/cloudTasks';
import * as invoiceService from '../services/invoice.service';
import * as storeService from '../services/firestore.service';
import logger from '../logger';
import type { TaskPayload, PipelineStep, DuplicateAction } from '../../../../shared/types';
import * as telegramService from '../services/telegram.service';
import { MESSAGES } from '../constants/messages';
import { t } from '../services/i18n/languages';

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
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid payload' });
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
      logger.info(
        { chatId: payload.chatId, messageId: payload.messageId },
        'Invoice already processed'
      );
      res.status(StatusCodes.OK).json({ ok: true, action: 'already_processed' });
      return;
    }

    logger.info(
      { chatId: payload.chatId, messageId: payload.messageId, driveLink: result.driveLink },
      'Invoice processed successfully'
    );
    res.status(StatusCodes.OK).json({ ok: true, action: 'processed' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      { chatId: payload.chatId, messageId: payload.messageId, error: errorMessage },
      'Processing error'
    );

    // Check if this was the last retry
    if (retryCount >= maxRetries - 1) {
      logger.warn(
        { chatId: payload.chatId, messageId: payload.messageId, retryCount, maxRetries },
        'Max retries reached, marking as permanently failed'
      );

      // Get job to find last step
      const job = await storeService.getJob(payload.chatId, payload.messageId);
      const lastStep: PipelineStep = job?.lastStep || 'download';
      const lastError = job?.lastError || errorMessage;

      // NOW mark as permanently failed (prevents future retries)
      await storeService.markJobFailed(payload.chatId, payload.messageId, lastStep, lastError);

      await invoiceService.sendFailureNotification(
        payload.chatId,
        payload.messageId,
        lastStep,
        lastError
      );

      // Return success to prevent further retries
      res.status(StatusCodes.OK).json({
        ok: false,
        action: 'failed_permanently',
        error: lastError,
      });
      return;
    }

    // Return 500 to trigger retry
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
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
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing required fields' });
    return;
  }

  try {
    await invoiceService.sendFailureNotification(chatId, messageId, lastStep, error);
    res.status(StatusCodes.OK).json({ ok: true });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: errMessage });
  }
}

/**
 * Handle callback query from Telegram inline buttons
 * Used for duplicate invoice decisions
 */
export async function handleCallback(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    callbackQueryId: string;
    data: string;
    botMessageChatId: number;
    botMessageId: number;
  };

  const { callbackQueryId, data, botMessageChatId, botMessageId } = body;

  logger.info({ receivedBody: JSON.stringify(body) }, 'Callback request received');

  if (!callbackQueryId || !data) {
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing callback data' });
    return;
  }

  const log = logger.child({ callbackQueryId });
  log.info({ data, botMessageChatId, botMessageId }, 'Processing callback query');

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;

    // Support both compact keys (a/j/f/s) and legacy full keys (action/jobId/field/successMessageId)
    const COMPACT_ACTIONS: Record<string, string> = {
      ei: 'edit_invoice',
      ef: 'edit_field',
      ec: 'edit_cancel',
    };
    const COMPACT_FIELDS: Record<string, string> = {
      amt: 'totalAmount',
      dat: 'invoiceDate',
      vnd: 'vendorName',
    };
    const resolvedAction = COMPACT_ACTIONS[parsed.a as string] ?? (parsed.action as string);

    if (!resolvedAction) {
      throw new Error('Invalid callback payload: missing action');
    }

    // -----------------------------------------------------------------------
    // Edit correction flow
    // -----------------------------------------------------------------------
    if (resolvedAction === 'edit_invoice') {
      const jobId = (parsed.j ?? parsed.jobId) as string | undefined;
      if (!jobId || typeof jobId !== 'string') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing jobId' });
        return;
      }

      await telegramService.answerCallbackQuery(callbackQueryId);
      await telegramService.editMessageText(
        botMessageChatId,
        botMessageId,
        t('he', 'correction.whatToEdit'),
        {
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: t('he', 'correction.btnAmount'),
                  callback_data: JSON.stringify({ a: 'ef', j: jobId, f: 'amt', s: botMessageId }),
                },
                {
                  text: t('he', 'correction.btnDate'),
                  callback_data: JSON.stringify({ a: 'ef', j: jobId, f: 'dat', s: botMessageId }),
                },
                {
                  text: t('he', 'correction.btnVendor'),
                  callback_data: JSON.stringify({ a: 'ef', j: jobId, f: 'vnd', s: botMessageId }),
                },
              ],
              [
                {
                  text: t('he', 'correction.btnCancel'),
                  callback_data: JSON.stringify({ a: 'ec', j: jobId, s: botMessageId }),
                },
              ],
            ],
          },
        }
      );

      log.info({ jobId }, 'Edit invoice: field selection shown');
      res.status(StatusCodes.OK).json({ ok: true, action: 'edit_invoice' });
      return;
    }

    if (resolvedAction === 'edit_field') {
      const jobId = (parsed.j ?? parsed.jobId) as string | undefined;
      const fieldAbbrev = parsed.f as string | undefined;
      const field = (COMPACT_FIELDS[fieldAbbrev ?? ''] ?? parsed.field) as string | undefined;
      const successMessageId = (parsed.s ?? parsed.successMessageId) as number | undefined;

      if (!jobId || typeof jobId !== 'string') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing jobId' });
        return;
      }
      if (!field || !['totalAmount', 'invoiceDate', 'vendorName'].includes(field)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid or missing field' });
        return;
      }
      if (successMessageId === undefined || typeof successMessageId !== 'number') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing successMessageId' });
        return;
      }

      await telegramService.answerCallbackQuery(callbackQueryId);

      const promptText =
        field === 'totalAmount'
          ? t('he', 'correction.promptAmount')
          : field === 'invoiceDate'
            ? t('he', 'correction.promptDate')
            : t('he', 'correction.promptVendor');

      // Use botMessageChatId from the request (not client-controlled chatId from callback_data)
      const prompt = await telegramService.sendMessage(botMessageChatId, promptText);

      await storeService.setCorrectionPending(
        jobId,
        field as 'totalAmount' | 'invoiceDate' | 'vendorName',
        prompt.message_id,
        successMessageId
      );

      log.info({ jobId, field }, 'Correction pending set, ForceReply sent');
      res.status(StatusCodes.OK).json({ ok: true, action: 'edit_field' });
      return;
    }

    if (resolvedAction === 'edit_cancel') {
      const jobId = (parsed.j ?? parsed.jobId) as string | undefined;
      const successMessageId = (parsed.s ?? parsed.successMessageId) as number | undefined;

      if (!jobId || typeof jobId !== 'string') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing jobId' });
        return;
      }
      if (successMessageId === undefined || typeof successMessageId !== 'number') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing successMessageId' });
        return;
      }

      await telegramService.answerCallbackQuery(callbackQueryId);

      // Derive chatId/messageId from jobId to look up the job
      const jobParts = jobId.split('_');
      const jobChatId = parseInt(jobParts[0]);
      const jobMessageId = parseInt(jobParts[1]);
      const job = await storeService.getJob(jobChatId, jobMessageId);

      if (job) {
        const originalText = telegramService.formatSuccessMessage(
          job.invoiceDate || null,
          job.totalAmount ?? null,
          job.currency || null,
          job.driveLink || ''
        );
        // Use botMessageChatId from the request (not client-controlled chatId from callback_data)
        await telegramService.editMessageText(botMessageChatId, successMessageId, originalText, {
          parseMode: 'Markdown',
          disableWebPagePreview: true,
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: t('he', 'correction.editButton'),
                  callback_data: JSON.stringify({ a: 'ei', j: jobId }),
                },
              ],
            ],
          },
        });
      } else {
        log.warn({ jobId }, 'Job not found when cancelling edit');
      }

      await storeService.clearCorrectionPending(jobId);

      log.info({ jobId }, 'Edit cancelled');
      res.status(StatusCodes.OK).json({ ok: true, action: 'edit_cancel' });
      return;
    }

    // -----------------------------------------------------------------------
    // Duplicate decision flow
    // Support both compact keys (a/c/m) and legacy full keys (action/chatId/messageId)
    // -----------------------------------------------------------------------
    const action = ((parsed.a ?? parsed.action) as DuplicateAction) || null;
    const chatId = (parsed.c ?? parsed.chatId) as number | undefined;
    const messageId = (parsed.m ?? parsed.messageId) as number | undefined;

    if (!action || !chatId || !messageId) {
      throw new Error('Invalid callback payload');
    }

    // Answer callback immediately to remove loading state
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: action === 'keep_both' ? MESSAGES.LOADING_KEEPING_BOTH : MESSAGES.LOADING_DELETING,
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
      res.status(StatusCodes.OK).json({ ok: true, action });
    } else {
      log.warn({ error: result.error }, 'Callback processing failed');
      res.status(StatusCodes.OK).json({ ok: false, error: result.error });
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

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: errorMessage });
  }
}

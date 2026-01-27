/**
 * Callback Query Handler
 * Handles button press callbacks from Telegram
 */

import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as telegramService from '../services/telegram';
import * as tasksService from '../services/tasks.service';
import type { Config } from '../config';
import logger from '../logger';

export async function handleCallbackQuery(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: Config,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid update' });
    return;
  }

  const callbackPayload = telegramService.extractCallbackPayload(update);
  if (!callbackPayload) {
    logger.error('Failed to extract callback payload');
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Failed to extract callback payload' });
    return;
  }

  // Check if this is an onboarding-related callback
  if (telegramService.isOnboardingCallback(callbackPayload.data)) {
    const onboardingPayload = telegramService.extractInvoiceCallbackPayload(update);
    if (!onboardingPayload) {
      logger.error('Failed to extract onboarding callback payload');
      res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: 'Failed to extract onboarding callback payload' });
      return;
    }

    logger.info(
      { callbackQueryId: onboardingPayload.callbackQueryId },
      'Enqueueing onboarding callback for worker'
    );

    try {
      const taskName = await tasksService.enqueueOnboardCallbackTask(onboardingPayload, config);
      logger.info({ taskName }, 'Onboarding callback task enqueued successfully');

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'onboarding_callback_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue onboarding callback task');
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to enqueue onboarding callback task' });
    }
    return;
  }

  // Check if this is a report-related callback
  if (telegramService.isReportCallback(callbackPayload.data)) {
    const reportPayload = telegramService.extractReportCallbackPayload(update);
    if (!reportPayload) {
      logger.error('Failed to extract report callback payload');
      res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: 'Failed to extract report callback payload' });
      return;
    }

    logger.info(
      { callbackQueryId: reportPayload.callback_query.id },
      'Enqueueing report callback for worker'
    );

    try {
      const taskName = await tasksService.enqueueReportCallbackTask(reportPayload, config);
      logger.info({ taskName }, 'Report callback task enqueued successfully');

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'report_callback_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue report callback task');
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to enqueue report callback task' });
    }
    return;
  }

  // Check if this is an invoice-related callback
  if (telegramService.isInvoiceCallback(callbackPayload.data)) {
    const invoicePayload = telegramService.extractInvoiceCallbackPayload(update);
    if (!invoicePayload) {
      logger.error('Failed to extract invoice callback payload');
      res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: 'Failed to extract invoice callback payload' });
      return;
    }

    logger.info(
      { callbackQueryId: invoicePayload.callbackQueryId },
      'Enqueueing invoice callback for worker'
    );

    try {
      const taskName = await tasksService.enqueueInvoiceCallbackTask(invoicePayload, config);
      logger.info({ taskName }, 'Invoice callback task enqueued successfully');

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'invoice_callback_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue invoice callback task');
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to enqueue invoice callback task' });
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

    res.status(StatusCodes.OK).json({
      ok: true,
      action: 'callback_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue callback task');
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to enqueue callback task' });
  }
}

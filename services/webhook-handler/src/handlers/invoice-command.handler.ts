/**
 * Invoice Command Handler
 * Handles /invoice command from Telegram
 */

import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as telegramService from '../services/telegram';
import * as tasksService from '../services/tasks.service';
import type { Config } from '../config';
import logger from '../logger';

export async function handleInvoiceCommand(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: Config,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid update' });
    return;
  }

  const payload = telegramService.extractInvoiceCommandPayload(update);
  if (!payload) {
    logger.error('Failed to extract invoice command payload');
    res
      .status(StatusCodes.BAD_REQUEST)
      .json({ error: 'Failed to extract invoice command payload' });
    return;
  }

  logger.info(
    { chatId: payload.chatId, userId: payload.userId },
    'Enqueueing invoice command for worker'
  );

  try {
    const taskName = await tasksService.enqueueInvoiceCommandTask(payload, config);
    logger.info({ taskName }, 'Invoice command task enqueued successfully');

    res.status(StatusCodes.OK).json({
      ok: true,
      action: 'invoice_command_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue invoice command task');
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to enqueue invoice command task' });
  }
}

/**
 * Onboard Command Handler
 * Handles /onboard command from Telegram
 */

import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as telegramService from '../services/telegram';
import * as tasksService from '../services/tasks.service';
import * as rateLimiter from '../services/rate-limiter.service';
import type { Config } from '../config';
import logger from '../logger';

export async function handleOnboardCommand(
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
    logger.error('Failed to extract onboard command payload');
    res
      .status(StatusCodes.BAD_REQUEST)
      .json({ error: 'Failed to extract onboard command payload' });
    return;
  }

  // Rate limiting: Check if chat is blocked due to too many unauthorized attempts
  if (await rateLimiter.isRateLimited(payload.chatId)) {
    const status = await rateLimiter.getRateLimitStatus(payload.chatId);
    logger.warn({ chatId: payload.chatId, status }, 'Onboard command blocked: rate limit exceeded');
    // Silently ignore (no task created, no further processing)
    res.status(StatusCodes.OK).json({
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

    res.status(StatusCodes.OK).json({
      ok: true,
      action: 'onboard_command_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue onboard command task');
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to enqueue onboard command task' });
  }
}

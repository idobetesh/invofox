/**
 * Report Command Handler
 * Handles /report command from Telegram
 */

import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as telegramService from '../services/telegram';
import * as tasksService from '../services/tasks.service';
import type { Config } from '../config';
import logger from '../logger';

export async function handleReportCommand(
  update: NonNullable<ReturnType<typeof telegramService.parseUpdate>>,
  config: Config,
  res: Response
): Promise<void> {
  const payload = telegramService.extractReportCommandPayload(update);
  if (!payload) {
    logger.error('Failed to extract report command payload');
    res.status(StatusCodes.BAD_REQUEST).json({
      error: 'Failed to extract report command payload',
    });
    return;
  }

  logger.info(
    { chatId: payload.chatId, userId: payload.userId },
    'Enqueueing report command for worker'
  );

  try {
    const taskName = await tasksService.enqueueReportCommandTask(payload, config);
    logger.info({ taskName }, 'Report command task enqueued successfully');

    res.status(StatusCodes.OK).json({
      ok: true,
      action: 'report_command_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue report command task');
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to enqueue report command task' });
  }
}

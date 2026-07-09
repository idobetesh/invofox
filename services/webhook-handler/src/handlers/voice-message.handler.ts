/**
 * Voice Message Handler
 * Routes voice messages to invoice NL flow when chat is approved
 */

import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as telegramService from '../services/telegram';
import * as tasksService from '../services/tasks.service';
import * as approvedChatsService from '../services/approved-chats.service';
import type { Config } from '../config';
import logger from '../logger';

export async function handleVoiceMessage(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: Config,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid update' });
    return;
  }

  const payload = telegramService.extractInvoiceMessagePayload(update);
  if (!payload?.voiceFileId) {
    logger.debug('Voice message not suitable for processing');
    res.status(StatusCodes.OK).json({ ok: true, action: 'ignored_voice' });
    return;
  }

  const inOnboarding = await approvedChatsService.isInOnboarding(payload.chatId);
  if (inOnboarding) {
    logger.debug({ chatId: payload.chatId }, 'Ignoring voice during onboarding');
    res.status(StatusCodes.OK).json({ ok: true, action: 'ignored_voice_onboarding' });
    return;
  }

  const isApproved = await approvedChatsService.isChatApproved(payload.chatId);
  if (!isApproved) {
    logger.debug({ chatId: payload.chatId }, 'Ignoring voice for unapproved chat');
    res.status(StatusCodes.OK).json({ ok: true, action: 'ignored_voice_unapproved' });
    return;
  }

  logger.info(
    { chatId: payload.chatId, userId: payload.userId },
    'Enqueueing invoice voice message for worker'
  );

  try {
    const taskName = await tasksService.enqueueInvoiceMessageTask(payload, config);
    logger.info({ taskName }, 'Invoice voice message task enqueued successfully');

    res.status(StatusCodes.OK).json({
      ok: true,
      action: 'invoice_voice_enqueued',
      task: taskName,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue invoice voice message task');
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to enqueue invoice voice message task' });
  }
}

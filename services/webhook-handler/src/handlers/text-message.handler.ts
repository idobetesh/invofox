/**
 * Text Message Handler
 * Handles text messages (might be part of invoice conversation or onboarding)
 */

import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as telegramService from '../services/telegram';
import * as tasksService from '../services/tasks.service';
import * as approvedChatsService from '../services/approved-chats.service';
import type { Config } from '../config';
import logger from '../logger';

export async function handleTextMessage(
  update: ReturnType<typeof telegramService.parseUpdate>,
  config: Config,
  res: Response
): Promise<void> {
  if (!update) {
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid update' });
    return;
  }

  const payload = telegramService.extractInvoiceMessagePayload(update);
  if (!payload) {
    // Not a valid message
    logger.debug('Text message not suitable for processing');
    res.status(StatusCodes.OK).json({ ok: true, action: 'ignored_text' });
    return;
  }

  // Check if chat has active onboarding session first (takes priority)
  const inOnboarding = await approvedChatsService.isInOnboarding(payload.chatId);

  if (inOnboarding) {
    // In active onboarding - route to onboarding flow
    logger.info(
      { chatId: payload.chatId, userId: payload.userId },
      'Enqueueing onboarding message for worker'
    );

    try {
      const taskName = await tasksService.enqueueOnboardMessageTask(payload, config);
      logger.info({ taskName }, 'Onboarding message task enqueued successfully');

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'onboarding_message_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue onboarding message task');
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to enqueue onboarding message task' });
    }
    return;
  }

  // Not in onboarding - check if chat is approved for invoice flow
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

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'invoice_message_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue invoice message task');
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to enqueue invoice message task' });
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

      res.status(StatusCodes.OK).json({
        ok: true,
        action: 'onboarding_message_enqueued',
        task: taskName,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue onboarding message task');
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to enqueue onboarding message task' });
    }
  }
}

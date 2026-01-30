/**
 * Report Controller
 * Handles HTTP routing for report generation endpoints
 * All business logic is delegated to service layer
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { ReportCommandPayload } from '../../../../shared/task.types';
import type { ReportType, ReportFormat, DatePreset } from '../../../../shared/report.types';
import * as userMappingService from '../services/customer/user-mapping.service';
import * as reportRateLimiterService from '../services/report/report-rate-limiter.service';
import * as reportSessionService from '../services/report/report-session.service';
import * as reportFlowService from '../services/report/report-flow.service';
import * as reportMessageService from '../services/report/report-message.service';
import * as reportDedupService from '../services/report/report-dedup.service';
import * as telegramService from '../services/telegram.service';
import logger from '../logger';

/**
 * Handle /report command
 * Creates new session and starts conversation flow
 */
export async function handleReportCommand(req: Request, res: Response): Promise<void> {
  const payload = req.body as ReportCommandPayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleReportCommand',
  });

  log.info('Processing /report command');

  try {
    // 1. Check user access
    const userCustomers = await userMappingService.getUserCustomers(payload.userId);
    const hasAccess = userCustomers.some((c) => c.chatId === payload.chatId);

    if (!hasAccess) {
      await telegramService.sendMessage(
        payload.chatId,
        "❌ אין לך הרשאה ליצור דוחות עבור צ'אט זה."
      );
      log.warn('User has no access to this chat');
      res.status(StatusCodes.FORBIDDEN).json({ error: 'No access' });
      return;
    }

    // 2. Check rate limit
    const rateLimit = await reportRateLimiterService.checkReportLimit(payload.chatId);
    if (!rateLimit.allowed) {
      const resetTime = rateLimit.resetAt?.toLocaleString('he-IL') || 'מחר';
      await telegramService.sendMessage(
        payload.chatId,
        `⏸️ הגעת למכסת הדוחות היומית\n\n` + `דוח הבא יהיה זמין ב: ${resetTime}\n\n`
      );
      log.info({ resetAt: rateLimit.resetAt }, 'Rate limit exceeded');
      res.status(StatusCodes.TOO_MANY_REQUESTS).json({ error: 'Rate limit exceeded' });
      return;
    }

    // 3. Cancel any existing active session
    const existingSession = await reportSessionService.getActiveSession(
      payload.chatId,
      payload.userId
    );
    if (existingSession) {
      await reportSessionService.cancelReportSession(existingSession.sessionId);
      log.info({ sessionId: existingSession.sessionId }, 'Cancelled existing session');
    }

    // 4. Create new session
    const session = await reportSessionService.createReportSession(payload.chatId, payload.userId);
    log.info({ sessionId: session.sessionId }, 'Created new report session');

    // 5. Send type selection message
    await reportMessageService.sendTypeSelectionMessage(payload.chatId, session.sessionId);

    res.status(StatusCodes.OK).json({
      ok: true,
      action: 'session_created',
      sessionId: session.sessionId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to start report flow');

    await telegramService.sendMessage(
      payload.chatId,
      '❌ שגיאה בהפעלת דוח\nאנא נסה שוב מאוחר יותר.'
    );

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: 'Failed to start report flow',
    });
  }
}

/**
 * Map abbreviated callback data to full values
 * Abbreviated format: {a: action, s: sessionId, v: value}
 */
function parseCallbackData(rawData: string): {
  action: string;
  sessionId: string;
  value?: string;
} {
  const data = JSON.parse(rawData);

  // Action mapping
  const actionMap: Record<string, string> = {
    type: 'select_type',
    date: 'select_date',
    fmt: 'select_format',
    cancel: 'cancel',
  };

  // Value mapping
  const valueMap: Record<string, string> = {
    // Type values
    rev: 'revenue',
    exp: 'expenses',
    // Date presets
    tm: 'this_month',
    lm: 'last_month',
    ytd: 'ytd',
    // Formats
    pdf: 'pdf',
    xls: 'excel',
    csv: 'csv',
  };

  return {
    action: actionMap[data.a] || data.a,
    sessionId: data.s,
    value: data.v ? valueMap[data.v] || data.v : undefined,
  };
}

/**
 * Handle callback query from inline buttons
 */
export async function handleReportCallback(req: Request, res: Response): Promise<void> {
  const body = req.body;
  const log = logger.child({ handler: 'handleReportCallback' });

  try {
    // Parse callback query
    const callbackQuery = body.callback_query;
    if (!callbackQuery) {
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'No callback_query in request' });
      return;
    }

    const updateId = body.update_id;
    const callbackQueryId = callbackQuery.id;
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    const data = parseCallbackData(callbackQuery.data);

    if (!chatId || !messageId) {
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'No chatId or messageId in callback' });
      return;
    }

    // Deduplication: Check if this update was already processed
    if (updateId) {
      const alreadyProcessed = await reportDedupService.isCallbackProcessed(updateId);
      if (alreadyProcessed) {
        log.info({ updateId, action: data.action }, 'Skipping duplicate callback');
        res.status(StatusCodes.OK).json({ ok: true, duplicate: true });
        return;
      }

      // Mark as processed IMMEDIATELY to prevent race condition with Telegram retries
      await reportDedupService.markCallbackProcessed(updateId);
    }

    log.info(
      { action: data.action, sessionId: data.sessionId, chatId, updateId },
      'Processing callback'
    );

    // Route to appropriate handler based on action
    switch (data.action) {
      case 'select_type':
        await reportFlowService.handleTypeSelection(
          data.sessionId,
          data.value as ReportType,
          chatId,
          callbackQueryId
        );
        break;

      case 'select_date':
        await reportFlowService.handleDateSelection(
          data.sessionId,
          data.value as DatePreset,
          chatId,
          messageId,
          callbackQueryId
        );
        break;

      case 'select_format':
        await reportFlowService.handleFormatSelection(
          data.sessionId,
          data.value as ReportFormat,
          chatId,
          messageId,
          callbackQueryId
        );
        // Record rate limit after successful generation
        await reportRateLimiterService.recordReportGeneration(chatId);
        break;

      case 'cancel':
        await reportFlowService.handleCancelAction(data.sessionId, chatId, callbackQueryId);
        break;

      default:
        log.warn({ action: data.action }, 'Unknown callback action');
        await telegramService.answerCallbackQuery(callbackQueryId, {
          text: '❌ פעולה לא מוכרת',
          showAlert: true,
        });
    }

    res.status(StatusCodes.OK).json({ ok: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle callback');

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: 'Failed to handle callback',
    });
  }
}

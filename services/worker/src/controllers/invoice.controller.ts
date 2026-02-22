/**
 * Document generation controller
 * Handles /new command, conversation messages, and button callbacks.
 * Thin HTTP layer — all business logic lives in service files.
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type {
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
} from '../../../../shared/task.types';
import type { InvoiceCallbackAction } from '../../../../shared/invoice.types';
import type { InvoiceSession } from '../../../../shared/types';
import * as sessionService from '../services/document-generator/session.service';
import { getGeneratedInvoice } from '../services/document-generator';
import * as storeService from '../services/firestore.service';
import * as telegramService from '../services/telegram.service';
import * as userMappingService from '../services/customer/user-mapping.service';
import {
  buildDocumentTypeKeyboard,
  buildConfirmationKeyboard,
  buildPaymentMethodKeyboard,
} from '../services/document-generator/keyboards.service';
import { parseInvoiceDetails } from '../services/document-generator/parser.service';
import { buildConfirmationMessage } from '../services/document-generator/messages.service';
import * as callbackService from '../services/document-generator/invoice-callback.service';
import * as correctionService from '../services/correction.service';
import { t } from '../services/i18n/languages';
import logger from '../logger';

/**
 * Handle /new command for creating documents (invoices, receipts, invoice-receipts)
 */
export async function handleInvoiceCommand(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceCommandPayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleInvoiceCommand',
  });

  log.info('Processing /new command');

  if (typeof payload.userId !== 'number' || typeof payload.chatId !== 'number') {
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing required fields: chatId, userId' });
    return;
  }

  try {
    const userCustomers = await userMappingService.getUserCustomers(payload.userId);
    const hasAccess = userCustomers.some((c) => c.chatId === payload.chatId);

    if (!hasAccess) {
      if (payload.chatId < 0) {
        const chatTitle = payload.chatTitle || `Chat ${payload.chatId}`;
        await userMappingService.addUserToCustomer(
          payload.userId,
          payload.username,
          payload.chatId,
          chatTitle
        );
        log.info('Auto-added user to customer on first interaction');
      } else {
        if (userCustomers.length === 0) {
          await telegramService.sendMessage(payload.chatId, t('he', 'invoice.noAccess'));
          log.warn('User has no customer access');
          res.status(StatusCodes.FORBIDDEN).json({ error: 'User has no customer access' });
          return;
        }
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.useInGroup'));
        log.debug('User sent command in private chat');
        res.status(StatusCodes.FORBIDDEN).json({ error: 'Command must be sent in group chat' });
        return;
      }
    }

    userMappingService
      .updateUserActivity(payload.userId)
      .catch((err) => log.warn({ err, userId: payload.userId }, 'Failed to update user activity'));

    await sessionService.createSession(payload.chatId, payload.userId);

    await telegramService.sendMessage(payload.chatId, t('he', 'invoice.newDocument'), {
      replyMarkup: buildDocumentTypeKeyboard(),
    });

    log.info('Sent document type selection');
    res.status(StatusCodes.OK).json({ ok: true, action: 'awaiting_type_selection' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle /new command');
    await telegramService.sendMessage(payload.chatId, t('he', 'invoice.error'));
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to handle /new command' });
  }
}

/**
 * Handle text message during invoice conversation
 */
export async function handleInvoiceMessage(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceMessagePayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleInvoiceMessage',
  });

  log.info('Processing invoice message');

  try {
    // Correction flow takes priority over session flow
    const pendingJob = await storeService.getCorrectionPendingJob(payload.chatId);
    if (pendingJob?.correctionPending) {
      await correctionService.handleCorrectionInput(pendingJob, payload.text, payload.chatId);
      res.status(StatusCodes.OK).json({ ok: true, action: 'correction_handled' });
      return;
    }

    const session = await sessionService.getSession(payload.chatId, payload.userId);

    if (!session) {
      log.debug('No active session');
      res.status(StatusCodes.OK).json({ ok: true, action: 'no_session' });
      return;
    }

    if (session.status === 'awaiting_details') {
      const details = parseInvoiceDetails(payload.text);

      if (!details) {
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.invalidFormat'));
        res.status(StatusCodes.OK).json({ ok: true, action: 'invalid_format' });
        return;
      }

      const updatedSession = await sessionService.setDetails(payload.chatId, payload.userId, {
        customerName: details.customerName,
        description: details.description,
        amount: details.amount,
        customerTaxId: details.customerTaxId,
      });

      if (updatedSession.documentType === 'invoice') {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        await sessionService.updateSession(payload.chatId, payload.userId, {
          status: 'confirming',
          date: dateStr,
        });

        const confirmText = buildConfirmationMessage({
          documentType: 'invoice',
          customerName: details.customerName,
          description: details.description,
          amount: details.amount,
          paymentMethod: '',
          date: dateStr,
        });

        await telegramService.sendMessage(payload.chatId, confirmText);
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectAction'), {
          replyMarkup: buildConfirmationKeyboard(),
        });

        log.info('Invoice: skipped payment method, sent confirmation');
        res.status(StatusCodes.OK).json({ ok: true, action: 'invoice_confirmation' });
        return;
      }

      await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectPaymentMethod'), {
        replyMarkup: buildPaymentMethodKeyboard(),
      });

      log.info('Sent payment method selection');
      res.status(StatusCodes.OK).json({ ok: true, action: 'awaiting_payment' });
      return;
    }

    if (session.status === 'awaiting_payment' && session.documentType === 'receipt') {
      const amount = parseFloat(payload.text.trim());

      if (isNaN(amount) || amount <= 0) {
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.invalidAmount'));
        res.status(StatusCodes.OK).json({ ok: true, action: 'invalid_amount' });
        return;
      }

      if (session.relatedInvoiceNumber) {
        const invoice = await getGeneratedInvoice(payload.chatId, session.relatedInvoiceNumber);

        if (!invoice) {
          await telegramService.sendMessage(payload.chatId, t('he', 'invoice.invoiceNotFound'));
          res.status(StatusCodes.OK).json({ ok: true, action: 'invoice_not_found' });
          return;
        }

        const remainingBalance = invoice.remainingBalance || invoice.amount;

        if (amount > remainingBalance) {
          const errorMsg = t('he', 'invoice.amountTooHigh', {
            amount: amount.toLocaleString(),
            remainingBalance: remainingBalance.toLocaleString(),
          });
          await telegramService.sendMessage(payload.chatId, errorMsg);
          log.info({ amount, remainingBalance }, 'Amount exceeds remaining balance');
          res.status(StatusCodes.OK).json({ ok: true, action: 'amount_too_high' });
          return;
        }

        const isFullPayment = amount === remainingBalance;
        const feedbackMsg = isFullPayment
          ? t('he', 'invoice.fullPaymentFeedback', { amount: amount.toLocaleString() })
          : t('he', 'invoice.partialPaymentFeedback', {
              amount: amount.toLocaleString(),
              newRemaining: (remainingBalance - amount).toLocaleString(),
            });

        await telegramService.sendMessage(payload.chatId, feedbackMsg);
      }

      await sessionService.updateSession(payload.chatId, payload.userId, { amount });

      await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectPaymentMethod'), {
        replyMarkup: buildPaymentMethodKeyboard(),
      });

      log.info({ amount }, 'Receipt payment amount entered');
      res.status(StatusCodes.OK).json({ ok: true, action: 'receipt_amount_entered' });
      return;
    }

    log.debug({ status: session.status }, 'Ignoring message for session status');
    res.status(StatusCodes.OK).json({ ok: true, action: 'ignored' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle invoice message');
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to handle invoice message' });
  }
}

/**
 * Handle button callback during invoice conversation
 */
export async function handleInvoiceCallback(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceCallbackPayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleInvoiceCallback',
  });

  log.info('Processing invoice callback');

  try {
    let action: InvoiceCallbackAction;
    try {
      action = JSON.parse(payload.data) as InvoiceCallbackAction;
    } catch {
      log.warn('Invalid callback data');
      await telegramService.answerCallbackQuery(payload.callbackQueryId, {
        text: t('he', 'invoice.errorRetry'),
      });
      res.status(StatusCodes.OK).json({ ok: true, action: 'invalid_callback' });
      return;
    }

    const session = await sessionService.getSession(payload.chatId, payload.userId);

    if (!session && action.action !== 'cancel') {
      log.debug('No active session');
      await telegramService.answerCallbackQuery(payload.callbackQueryId, {
        text: t('he', 'invoice.sessionExpired'),
        showAlert: true,
      });
      res.status(StatusCodes.OK).json({ ok: true, action: 'session_expired' });
      return;
    }

    switch (action.action) {
      case 'select_type': {
        const resultAction = await callbackService.handleSelectType(
          payload.chatId,
          payload.userId,
          payload.messageId,
          payload.callbackQueryId,
          action.documentType
        );
        res.status(StatusCodes.OK).json({ ok: true, action: resultAction });
        break;
      }

      case 'select_invoice': {
        const resultAction = await callbackService.handleSelectInvoice(
          payload.chatId,
          payload.userId,
          payload.messageId,
          payload.callbackQueryId,
          action.invoiceNumber
        );
        res.status(StatusCodes.OK).json({ ok: true, action: resultAction });
        break;
      }

      case 'toggle_invoice': {
        const resultAction = await callbackService.handleToggleInvoice(
          payload.chatId,
          payload.userId,
          payload.messageId,
          payload.callbackQueryId,
          action.invoiceNumber,
          session as InvoiceSession
        );
        res.status(StatusCodes.OK).json({ ok: true, action: resultAction });
        break;
      }

      case 'confirm_selection': {
        const resultAction = await callbackService.handleConfirmSelection(
          payload.chatId,
          payload.userId,
          payload.messageId,
          payload.callbackQueryId
        );
        res.status(StatusCodes.OK).json({ ok: true, action: resultAction });
        break;
      }

      case 'show_more': {
        const resultAction = await callbackService.handleShowMore(
          payload.chatId,
          payload.userId,
          payload.messageId,
          payload.callbackQueryId,
          action.offset,
          session as InvoiceSession
        );
        res.status(StatusCodes.OK).json({ ok: true, action: resultAction });
        break;
      }

      case 'select_payment': {
        const resultAction = await callbackService.handleSelectPayment(
          payload.chatId,
          payload.userId,
          payload.messageId,
          payload.callbackQueryId,
          action.paymentMethod
        );
        res.status(StatusCodes.OK).json({ ok: true, action: resultAction });
        break;
      }

      case 'confirm': {
        const result = await callbackService.handleConfirm(
          payload.chatId,
          payload.userId,
          payload.username,
          payload.messageId,
          payload.callbackQueryId
        );
        res.status(StatusCodes.OK).json({ ok: true, ...result });
        break;
      }

      case 'cancel': {
        const resultAction = await callbackService.handleCancel(
          payload.chatId,
          payload.userId,
          payload.messageId,
          payload.callbackQueryId
        );
        res.status(StatusCodes.OK).json({ ok: true, action: resultAction });
        break;
      }

      default:
        log.warn({ action }, 'Unknown callback action');
        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        res.status(StatusCodes.OK).json({ ok: true, action: 'unknown_action' });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    const isExpectedTelegramError =
      errorMessage.includes('query is too old') ||
      errorMessage.includes('query ID is invalid') ||
      errorMessage.includes('message is not modified');

    if (isExpectedTelegramError) {
      log.warn(
        { error: errorMessage },
        'Expected Telegram API error (callback likely already handled)'
      );
      res.status(StatusCodes.OK).json({ ok: true, warning: 'callback_already_handled' });
      return;
    }

    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle invoice callback');

    try {
      await telegramService.answerCallbackQuery(payload.callbackQueryId, {
        text: t('he', 'invoice.errorRetry'),
        showAlert: true,
      });
    } catch {
      // Ignore if answering fails
    }

    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to handle invoice callback' });
  }
}

/**
 * Invoice generation controller
 * Handles /invoice command, conversation messages, and button callbacks
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type {
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
  InvoiceCallbackAction,
} from '../../../../shared/types';
import * as sessionService from '../services/invoice-generator/session.service';
import { generateInvoice } from '../services/invoice-generator';
import * as telegramService from '../services/telegram.service';
import * as userMappingService from '../services/customer/user-mapping.service';
import {
  buildDocumentTypeKeyboard,
  buildPaymentMethodKeyboard,
  buildConfirmationKeyboard,
} from '../services/invoice-generator/keyboards.service';
import { parseFastPathCommand } from '../services/invoice-generator/fast-path.service';
import { parseInvoiceDetails } from '../services/invoice-generator/parser.service';
import {
  buildConfirmationMessage,
  buildSuccessMessage,
  getDocumentTypeLabel,
} from '../services/invoice-generator/messages.service';
import { t } from '../services/i18n/languages';
import logger from '../logger';

/**
 * Handle /invoice command
 */
export async function handleInvoiceCommand(req: Request, res: Response): Promise<void> {
  const payload = req.body as InvoiceCommandPayload;
  const log = logger.child({
    chatId: payload.chatId,
    userId: payload.userId,
    handler: 'handleInvoiceCommand',
  });

  log.info('Processing invoice command');

  try {
    // Get user's customers (single Firestore read, avoids duplicate reads)
    const userCustomers = await userMappingService.getUserCustomers(payload.userId);

    // Check if user has access to this customer
    const hasAccess = userCustomers.some((c) => c.chatId === payload.chatId);

    if (!hasAccess) {
      // Auto-add user if command sent in group chat
      if (payload.chatId < 0) {
        // Negative chatId = group/supergroup
        const chatTitle = payload.chatTitle || `Chat ${payload.chatId}`;
        await userMappingService.addUserToCustomer(
          payload.userId,
          payload.username,
          payload.chatId,
          chatTitle
        );
        log.info('Auto-added user to customer on first interaction');
      } else {
        // Private chat - check if user has any customers (from already-fetched data)
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

    // OPTIMIZATION: Fire-and-forget user activity update (non-critical, saves 50-100ms)
    userMappingService
      .updateUserActivity(payload.userId)
      .catch((err) => log.warn({ err, userId: payload.userId }, 'Failed to update user activity'));

    // Check for fast-path (all arguments in one message)
    const fastPath = parseFastPathCommand(payload.text);

    if (fastPath) {
      log.info('Using fast path');

      // Create session in confirming state with all data
      await sessionService.createSession(payload.chatId, payload.userId);
      await sessionService.setDocumentType(payload.chatId, payload.userId, 'invoice_receipt');
      await sessionService.setDetails(payload.chatId, payload.userId, {
        customerName: fastPath.customerName,
        description: fastPath.description,
        amount: fastPath.amount,
      });

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      await sessionService.setPaymentMethod(
        payload.chatId,
        payload.userId,
        fastPath.paymentMethod,
        dateStr
      );

      const confirmText = buildConfirmationMessage({
        documentType: 'invoice_receipt',
        customerName: fastPath.customerName,
        description: fastPath.description,
        amount: fastPath.amount,
        paymentMethod: fastPath.paymentMethod,
        date: dateStr,
      });

      await telegramService.sendMessage(payload.chatId, confirmText, {
        replyMarkup: buildConfirmationKeyboard(),
      });

      res.status(StatusCodes.OK).json({ ok: true, action: 'fast_path_confirmation' });
      return;
    }

    // Start guided flow - create session and ask for document type
    await sessionService.createSession(payload.chatId, payload.userId);

    await telegramService.sendMessage(payload.chatId, t('he', 'invoice.newDocument'), {
      replyMarkup: buildDocumentTypeKeyboard(),
    });

    log.info('Sent document type selection');
    res.status(StatusCodes.OK).json({ ok: true, action: 'awaiting_type_selection' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle invoice command');
    await telegramService.sendMessage(payload.chatId, t('he', 'invoice.error'));
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to handle invoice command' });
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
    // Get current session
    const session = await sessionService.getSession(payload.chatId, payload.userId);

    if (!session) {
      log.debug('No active session');
      res.status(StatusCodes.OK).json({ ok: true, action: 'no_session' });
      return;
    }

    // Handle based on session status
    if (session.status === 'awaiting_details') {
      const details = parseInvoiceDetails(payload.text);

      if (!details) {
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.invalidFormat'));
        res.status(StatusCodes.OK).json({ ok: true, action: 'invalid_format' });
        return;
      }

      // Update session with details
      await sessionService.setDetails(payload.chatId, payload.userId, {
        customerName: details.customerName,
        description: details.description,
        amount: details.amount,
        customerTaxId: details.customerTaxId,
      });

      await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectPaymentMethod'), {
        replyMarkup: buildPaymentMethodKeyboard(),
      });

      log.info('Sent payment method selection');
      res.status(StatusCodes.OK).json({ ok: true, action: 'awaiting_payment' });
      return;
    }

    // Unknown state - ignore
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
    // Parse callback data
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

    // Get current session
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

    // Handle action
    switch (action.action) {
      case 'select_type': {
        await sessionService.setDocumentType(payload.chatId, payload.userId, action.documentType);

        const typeLabel = getDocumentTypeLabel(action.documentType);

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          t('he', 'invoice.typeSelected', { type: typeLabel })
        );

        log.info({ documentType: action.documentType }, 'Document type selected');
        res.status(StatusCodes.OK).json({ ok: true, action: 'type_selected' });
        break;
      }

      case 'select_payment': {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // setPaymentMethod now returns the updated session, eliminating the double-read
        const updatedSession = await sessionService.setPaymentMethod(
          payload.chatId,
          payload.userId,
          action.paymentMethod,
          dateStr
        );

        if (
          !updatedSession.documentType ||
          !updatedSession.customerName ||
          !updatedSession.description ||
          !updatedSession.amount
        ) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.missingDetails'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'missing_data' });
          return;
        }

        const confirmText = buildConfirmationMessage({
          documentType: updatedSession.documentType as 'invoice' | 'invoice_receipt',
          customerName: updatedSession.customerName,
          description: updatedSession.description,
          amount: updatedSession.amount,
          paymentMethod: action.paymentMethod,
          date: dateStr,
        });

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(payload.chatId, payload.messageId, confirmText);
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectAction'), {
          replyMarkup: buildConfirmationKeyboard(),
        });

        log.info({ paymentMethod: action.paymentMethod }, 'Payment method selected');
        res.status(StatusCodes.OK).json({ ok: true, action: 'payment_selected' });
        break;
      }

      case 'confirm': {
        const confirmedSession = await sessionService.getConfirmedSession(
          payload.chatId,
          payload.userId
        );

        if (!confirmedSession) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.missingDetails'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'incomplete_session' });
          return;
        }

        // Answer callback query with popup feedback (shows generating status)
        await telegramService.answerCallbackQuery(payload.callbackQueryId, {
          text: t('he', 'invoice.creating'),
        });

        // Remove confirmation buttons and show brief confirmation
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          t('he', 'invoice.creating')
        );

        try {
          // Generate invoice
          const result = await generateInvoice(
            confirmedSession,
            payload.userId,
            payload.username,
            payload.chatId
          );

          // Delete session on success
          await sessionService.deleteSession(payload.chatId, payload.userId);

          const docType = confirmedSession.documentType as 'invoice' | 'invoice_receipt';
          const typeLabel = getDocumentTypeLabel(docType);
          const invoiceNum =
            typeof result.invoiceNumber === 'string'
              ? parseInt(result.invoiceNumber)
              : result.invoiceNumber;

          await telegramService.sendDocument(
            payload.chatId,
            result.pdfBuffer,
            `${typeLabel}_${invoiceNum}.pdf`,
            { caption: buildSuccessMessage(docType, invoiceNum) }
          );

          log.info({ invoiceNumber: result.invoiceNumber }, 'Invoice generated and sent');
          res
            .status(StatusCodes.OK)
            .json({ ok: true, action: 'invoice_generated', invoiceNumber: result.invoiceNumber });
        } catch (error) {
          // PDF generation failed - notify user with detailed error
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error({ error: errorMessage }, 'Invoice generation failed');

          // Clean up session
          await sessionService.deleteSession(payload.chatId, payload.userId);

          // Update the "Generating..." message with error details
          await telegramService.editMessageText(
            payload.chatId,
            payload.messageId,
            t('he', 'invoice.error')
          );

          await telegramService.sendMessage(payload.chatId, t('he', 'invoice.errorDetails'));

          res
            .status(StatusCodes.INTERNAL_SERVER_ERROR)
            .json({ error: 'Invoice generation failed', details: errorMessage });
        }
        break;
      }

      case 'cancel': {
        await sessionService.deleteSession(payload.chatId, payload.userId);

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          t('he', 'invoice.cancelled')
        );

        log.info('Invoice creation cancelled');
        res.status(StatusCodes.OK).json({ ok: true, action: 'cancelled' });
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

    // These are expected Telegram API errors that don't indicate actual failures
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

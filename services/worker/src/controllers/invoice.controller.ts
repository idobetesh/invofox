/**
 * Document generation controller
 * Handles /new command, conversation messages, and button callbacks
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type {
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
} from '../../../../shared/task.types';
import type { InvoiceCallbackAction, InvoiceDocumentType } from '../../../../shared/invoice.types';
import * as sessionService from '../services/document-generator/session.service';
import { generateInvoice, getGeneratedInvoice } from '../services/document-generator';
import * as telegramService from '../services/telegram.service';
import * as userMappingService from '../services/customer/user-mapping.service';
import {
  buildDocumentTypeKeyboard,
  buildPaymentMethodKeyboard,
  buildConfirmationKeyboard,
  buildInvoiceSelectionKeyboard,
} from '../services/document-generator/keyboards.service';
import {
  getOpenInvoices,
  countOpenInvoices,
} from '../services/document-generator/open-invoices.service';
import { parseInvoiceDetails } from '../services/document-generator/parser.service';
import {
  buildConfirmationMessage,
  buildSuccessMessage,
  getDocumentTypeLabel,
} from '../services/document-generator/messages.service';
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
      const updatedSession = await sessionService.setDetails(payload.chatId, payload.userId, {
        customerName: details.customerName,
        description: details.description,
        amount: details.amount,
        customerTaxId: details.customerTaxId,
      });

      // For invoices: skip payment method (not paid yet), go straight to confirmation
      // For invoice-receipts: ask for payment method
      if (updatedSession.documentType === 'invoice') {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // Set empty payment method for invoices (undefined means no payment yet)
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

      // For invoice-receipts and receipts: ask for payment method
      await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectPaymentMethod'), {
        replyMarkup: buildPaymentMethodKeyboard(),
      });

      log.info('Sent payment method selection');
      res.status(StatusCodes.OK).json({ ok: true, action: 'awaiting_payment' });
      return;
    }

    // Handle receipt payment amount input
    if (session.status === 'awaiting_payment' && session.documentType === 'receipt') {
      // Parse payment amount
      const amount = parseFloat(payload.text.trim());

      if (isNaN(amount) || amount <= 0) {
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.invalidAmount'));
        res.status(StatusCodes.OK).json({ ok: true, action: 'invalid_amount' });
        return;
      }

      // Validate amount doesn't exceed remaining balance
      if (session.relatedInvoiceNumber) {
        const invoice = await getGeneratedInvoice(payload.chatId, session.relatedInvoiceNumber);

        if (!invoice) {
          await telegramService.sendMessage(payload.chatId, t('he', 'invoice.invoiceNotFound'));
          res.status(StatusCodes.OK).json({ ok: true, action: 'invoice_not_found' });
          return;
        }

        const remainingBalance = invoice.remainingBalance || invoice.amount;

        // Check if amount exceeds remaining balance
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

        // Provide feedback on partial vs full payment
        const isFullPayment = amount === remainingBalance;
        const feedbackMsg = isFullPayment
          ? t('he', 'invoice.fullPaymentFeedback', { amount: amount.toLocaleString() })
          : t('he', 'invoice.partialPaymentFeedback', {
              amount: amount.toLocaleString(),
              newRemaining: (remainingBalance - amount).toLocaleString(),
            });

        await telegramService.sendMessage(payload.chatId, feedbackMsg);
      }

      // Store amount in session
      await sessionService.updateSession(payload.chatId, payload.userId, {
        amount,
      });

      // Show payment method selection
      await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectPaymentMethod'), {
        replyMarkup: buildPaymentMethodKeyboard(),
      });

      log.info({ amount }, 'Receipt payment amount entered');
      res.status(StatusCodes.OK).json({ ok: true, action: 'receipt_amount_entered' });
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

        // For receipts: show open invoices (multi-select)
        if (action.documentType === 'receipt') {
          const [openInvoices, totalCount] = await Promise.all([
            getOpenInvoices(payload.chatId, 0, 10),
            countOpenInvoices(payload.chatId),
          ]);

          if (totalCount === 0) {
            await telegramService.editMessageText(
              payload.chatId,
              payload.messageId,
              t('he', 'invoice.noOpenInvoicesHe')
            );
            await sessionService.deleteSession(payload.chatId, payload.userId);
            log.info('No open invoices found for receipt creation');
            res.status(StatusCodes.OK).json({ ok: true, action: 'no_open_invoices' });
            return;
          }

          await telegramService.editMessageText(
            payload.chatId,
            payload.messageId,
            t('he', 'invoice.typeSelected', { type: typeLabel })
          );

          // Build message with pagination info
          const showing = Math.min(10, totalCount);
          const invoiceListMsg = `${t('he', 'invoice.selectInvoiceHe')}\n\n📋 מציג ${showing} מתוך ${totalCount} חשבוניות\n💡 ניתן לבחור מספר חשבוניות ליצירת קבלה אחת`;

          await telegramService.sendMessage(payload.chatId, invoiceListMsg, {
            replyMarkup: buildInvoiceSelectionKeyboard(openInvoices, [], 0, totalCount),
          });

          log.info(
            { count: openInvoices.length, total: totalCount },
            'Showed open invoices for receipt creation (multi-select)'
          );
          res.status(StatusCodes.OK).json({ ok: true, action: 'showing_open_invoices' });
          return;
        }

        // For invoice and invoice_receipt: show next prompt
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          t('he', 'invoice.typeSelected', { type: typeLabel })
        );

        log.info({ documentType: action.documentType }, 'Document type selected');
        res.status(StatusCodes.OK).json({ ok: true, action: 'type_selected' });
        break;
      }

      case 'select_invoice': {
        // Get invoice details first
        const invoice = await getGeneratedInvoice(payload.chatId, action.invoiceNumber);

        if (!invoice) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.invoiceNotFound'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'invoice_not_found' });
          return;
        }

        // Save selected invoice with customer details for receipt (single DB write)
        await sessionService.updateSession(payload.chatId, payload.userId, {
          status: 'awaiting_payment',
          relatedInvoiceNumber: action.invoiceNumber,
          customerName: invoice.customerName,
          description: t('he', 'invoice.receiptDescription', {
            invoiceNumber: action.invoiceNumber,
          }),
        });

        const remainingBalance = invoice.remainingBalance || invoice.amount;
        const paidAmount = invoice.paidAmount || 0;

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          t('he', 'invoice.invoiceSelected', { invoiceNumber: action.invoiceNumber })
        );

        // Send prompt with invoice details and remaining balance
        const promptMsg = t('he', 'invoice.invoiceDetails', {
          customerName: invoice.customerName,
          amount: invoice.amount.toLocaleString(),
          paidAmount: paidAmount.toLocaleString(),
          remainingBalance: remainingBalance.toLocaleString(),
          exampleAmount: Math.floor(remainingBalance / 2).toLocaleString(),
        });

        await telegramService.sendMessage(payload.chatId, promptMsg);

        log.info(
          { invoiceNumber: action.invoiceNumber, remainingBalance },
          'Invoice selected for receipt'
        );
        res.status(StatusCodes.OK).json({ ok: true, action: 'invoice_selected' });
        break;
      }

      case 'toggle_invoice': {
        // Get invoice details first
        const invoice = await getGeneratedInvoice(payload.chatId, action.invoiceNumber);

        if (!invoice) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.invoiceNotFound'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'invoice_not_found' });
          return;
        }

        if (!session) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.sessionExpired'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'session_expired' });
          return;
        }

        const selectedNumbers = session.selectedInvoiceNumbers || [];
        const selectedData = session.selectedInvoiceData || [];

        // Check max limit when adding
        const isCurrentlySelected = selectedNumbers.includes(action.invoiceNumber);
        if (!isCurrentlySelected && selectedNumbers.length >= 10) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.multiInvoiceMaxError'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'max_limit_reached' });
          return;
        }

        // Check customer consistency when adding
        if (!isCurrentlySelected && selectedData.length > 0) {
          const firstCustomer = selectedData[0].customerName;
          if (invoice.customerName !== firstCustomer) {
            await telegramService.answerCallbackQuery(payload.callbackQueryId, {
              text: t('he', 'invoice.multiInvoiceCustomerError'),
              showAlert: true,
            });
            res.status(StatusCodes.OK).json({ ok: true, action: 'customer_mismatch' });
            return;
          }
        }

        // Toggle selection in session
        const remainingBalance = invoice.remainingBalance || invoice.amount;
        const updatedSession = await sessionService.toggleInvoiceSelection(
          payload.chatId,
          payload.userId,
          action.invoiceNumber,
          {
            customerName: invoice.customerName,
            remainingBalance,
            date: invoice.date,
          }
        );

        // Provide feedback
        const feedbackText = isCurrentlySelected
          ? `הוסר: ${action.invoiceNumber}`
          : `נבחר: ${action.invoiceNumber}`;

        await telegramService.answerCallbackQuery(payload.callbackQueryId, {
          text: feedbackText,
        });

        // Refresh keyboard with updated selection
        const [openInvoices, totalCount] = await Promise.all([
          getOpenInvoices(payload.chatId, 0, 10),
          countOpenInvoices(payload.chatId),
        ]);

        await telegramService.editMessageReplyMarkup(payload.chatId, payload.messageId, {
          inline_keyboard: buildInvoiceSelectionKeyboard(
            openInvoices,
            updatedSession.selectedInvoiceNumbers || [],
            0,
            totalCount
          ).inline_keyboard,
        });

        log.info(
          {
            invoiceNumber: action.invoiceNumber,
            selectedCount: updatedSession.selectedInvoiceNumbers?.length || 0,
          },
          'Invoice selection toggled'
        );
        res.status(StatusCodes.OK).json({ ok: true, action: 'invoice_toggled' });
        break;
      }

      case 'confirm_selection': {
        if (!session) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.sessionExpired'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'session_expired' });
          return;
        }

        // Validate and confirm selection
        const validationResult = await sessionService.validateAndConfirmSelection(
          payload.chatId,
          payload.userId
        );

        if (!validationResult.success) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: validationResult.error,
            showAlert: true,
          });
          res
            .status(StatusCodes.OK)
            .json({ ok: true, action: 'validation_failed', error: validationResult.error });
          return;
        }

        const confirmedSession = validationResult.session;
        const selectedCount = confirmedSession.selectedInvoiceNumbers?.length || 0;
        const totalAmount = confirmedSession.amount || 0;

        await telegramService.answerCallbackQuery(payload.callbackQueryId);

        // Show selection summary
        const summaryText = `✅ נבחרו ${selectedCount} חשבוניות\nסה״כ לתשלום: ₪${totalAmount.toFixed(2)}\n\nעבור לקוח: ${confirmedSession.customerName}`;

        await telegramService.editMessageText(payload.chatId, payload.messageId, summaryText);

        // Show payment method selection
        await telegramService.sendMessage(payload.chatId, t('he', 'invoice.selectPaymentMethod'), {
          replyMarkup: buildPaymentMethodKeyboard(),
        });

        log.info(
          { selectedCount, totalAmount, customerName: confirmedSession.customerName },
          'Multi-invoice selection confirmed'
        );
        res.status(StatusCodes.OK).json({ ok: true, action: 'selection_confirmed' });
        break;
      }

      case 'show_more': {
        if (!session) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: t('he', 'invoice.sessionExpired'),
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'session_expired' });
          return;
        }

        // Preserve selection state during pagination
        const selectedInvoiceNumbers = session.selectedInvoiceNumbers || [];

        // Fetch next batch of invoices with pagination
        const [openInvoices, totalCount] = await Promise.all([
          getOpenInvoices(payload.chatId, action.offset, 10),
          countOpenInvoices(payload.chatId),
        ]);

        if (openInvoices.length === 0) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: 'אין עוד חשבוניות להצגה',
            showAlert: true,
          });
          res.status(StatusCodes.OK).json({ ok: true, action: 'no_more_invoices' });
          return;
        }

        await telegramService.answerCallbackQuery(payload.callbackQueryId);

        // Update message with new pagination info
        const endIndex = Math.min(action.offset + openInvoices.length, totalCount);
        const invoiceListMsg = `${t('he', 'invoice.selectInvoiceHe')}\n\n📋 מציג ${action.offset + 1}-${endIndex} מתוך ${totalCount} חשבוניות\n💡 ניתן לבחור מספר חשבוניות ליצירת קבלה אחת`;

        await telegramService.editMessageText(payload.chatId, payload.messageId, invoiceListMsg);

        // Update keyboard with new invoices, preserving selection
        await telegramService.editMessageReplyMarkup(payload.chatId, payload.messageId, {
          inline_keyboard: buildInvoiceSelectionKeyboard(
            openInvoices,
            selectedInvoiceNumbers,
            action.offset,
            totalCount
          ).inline_keyboard,
        });

        log.info(
          {
            offset: action.offset,
            count: openInvoices.length,
            total: totalCount,
            selectedCount: selectedInvoiceNumbers.length,
          },
          'Showed more invoices with preserved selection'
        );
        res.status(StatusCodes.OK).json({ ok: true, action: 'showed_more_invoices' });
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
          documentType: updatedSession.documentType,
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

        // Build summary message with context
        const docType = confirmedSession.documentType as InvoiceDocumentType;
        const typeLabel = getDocumentTypeLabel(docType);
        const currencySymbol =
          confirmedSession.currency === 'USD'
            ? '$'
            : confirmedSession.currency === 'EUR'
              ? '€'
              : '₪';
        const summaryText = `⏳ מייצר ${typeLabel} עבור ${confirmedSession.customerName} - ${currencySymbol}${confirmedSession.amount?.toLocaleString('he-IL')}...`;

        // Remove confirmation buttons and show summary
        await telegramService.editMessageText(payload.chatId, payload.messageId, summaryText);

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

          // Delete "generating" message (clean UI)
          try {
            await telegramService.deleteMessage(payload.chatId, payload.messageId);
          } catch (error) {
            // Ignore error if message already deleted
            log.debug({ error }, 'Failed to delete generating message (may already be deleted)');
          }

          await telegramService.sendDocument(
            payload.chatId,
            result.pdfBuffer,
            `${typeLabel}_${result.invoiceNumber}.pdf`,
            { caption: buildSuccessMessage(docType, result.invoiceNumber) }
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

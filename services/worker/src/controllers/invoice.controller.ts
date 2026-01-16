/**
 * Invoice generation controller
 * Handles /invoice command, conversation messages, and button callbacks
 */

import { Request, Response } from 'express';
import type {
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
  PaymentMethod,
  TelegramInlineKeyboardMarkup,
  InvoiceCallbackAction,
} from '../../../../shared/types';
import * as sessionService from '../services/invoice-generator/session.service';
import { generateInvoice } from '../services/invoice-generator';
import * as telegramService from '../services/telegram.service';
import logger from '../logger';

// Payment method options
const PAYMENT_METHODS: PaymentMethod[] = ['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק'];

/**
 * Build document type selection keyboard
 */
function buildDocumentTypeKeyboard(): TelegramInlineKeyboardMarkup {
  const invoiceData: InvoiceCallbackAction = { action: 'select_type', documentType: 'invoice' };
  const invoiceReceiptData: InvoiceCallbackAction = {
    action: 'select_type',
    documentType: 'invoice_receipt',
  };

  return {
    inline_keyboard: [
      [
        { text: 'חשבונית', callback_data: JSON.stringify(invoiceData) },
        { text: 'חשבונית-קבלה', callback_data: JSON.stringify(invoiceReceiptData) },
      ],
    ],
  };
}

/**
 * Build payment method selection keyboard
 */
function buildPaymentMethodKeyboard(): TelegramInlineKeyboardMarkup {
  const rows: { text: string; callback_data: string }[][] = [];

  // Create rows of 3 buttons each
  for (let i = 0; i < PAYMENT_METHODS.length; i += 3) {
    const row = PAYMENT_METHODS.slice(i, i + 3).map((method) => {
      const data: InvoiceCallbackAction = { action: 'select_payment', paymentMethod: method };
      return { text: method, callback_data: JSON.stringify(data) };
    });
    rows.push(row);
  }

  return { inline_keyboard: rows };
}

/**
 * Build confirmation keyboard
 */
function buildConfirmationKeyboard(): TelegramInlineKeyboardMarkup {
  const confirmData: InvoiceCallbackAction = { action: 'confirm' };
  const cancelData: InvoiceCallbackAction = { action: 'cancel' };

  return {
    inline_keyboard: [
      [
        { text: '✅ אשר וצור', callback_data: JSON.stringify(confirmData) },
        { text: '❌ בטל', callback_data: JSON.stringify(cancelData) },
      ],
    ],
  };
}

/**
 * Parse fast-path invoice command
 * Format: /invoice name, amount, description, payment_method
 * Returns null if parsing fails
 */
function parseFastPath(text: string): {
  customerName: string;
  amount: number;
  description: string;
  paymentMethod: PaymentMethod;
} | null {
  // Remove /invoice prefix
  const args = text.replace(/^\/invoice\s*/i, '').trim();

  if (!args) {
    return null;
  }

  // Split by comma
  const parts = args.split(',').map((p) => p.trim());

  if (parts.length < 4) {
    return null;
  }

  const customerName = parts[0];
  const amountStr = parts[1];
  const description = parts[2];
  const paymentMethodStr = parts[3];

  // Parse amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return null;
  }

  // Validate payment method
  const paymentMethod = PAYMENT_METHODS.find(
    (m) => m.toLowerCase() === paymentMethodStr.toLowerCase()
  );
  if (!paymentMethod) {
    return null;
  }

  return { customerName, amount, description, paymentMethod };
}

/**
 * Parse details from message
 * Format: name, amount, description[, tax_id (optional)]
 */
function parseDetails(text: string): {
  customerName: string;
  amount: number;
  description: string;
  customerTaxId?: string;
} | null {
  const parts = text.split(',').map((p) => p.trim());

  if (parts.length < 3) {
    return null;
  }

  const customerName = parts[0];
  const amountStr = parts[1];

  // Check if 4th field (tax ID) is provided
  let description: string;
  let customerTaxId: string | undefined;

  if (parts.length >= 4) {
    // Tax ID is the last field, description is everything in between
    description = parts.slice(2, parts.length - 1).join(', ');
    customerTaxId = parts[parts.length - 1];

    // If tax ID is empty or looks invalid, treat it as part of description
    if (!customerTaxId || customerTaxId.length === 0) {
      description = parts.slice(2).join(', ');
      customerTaxId = undefined;
    }
  } else {
    // No tax ID, description is everything after amount
    description = parts.slice(2).join(', ');
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return null;
  }

  return { customerName, amount, description, customerTaxId };
}

/**
 * Format date for display (DD/MM/YYYY)
 */
function formatDateDisplay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    return dateStr;
  }
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

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
    // Check for fast-path (all arguments in one message)
    const fastPath = parseFastPath(payload.text);

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

      // Send confirmation
      const confirmText = `✅ אישור יצירת מסמך:
━━━━━━━━━━━━━━━━
סוג: חשבונית-קבלה
לקוח: ${fastPath.customerName}
תיאור: ${fastPath.description}
סכום: ₪${fastPath.amount}
תשלום: ${fastPath.paymentMethod}
תאריך: ${formatDateDisplay(dateStr)}
━━━━━━━━━━━━━━━━`;

      await telegramService.sendMessage(payload.chatId, confirmText, {
        replyMarkup: buildConfirmationKeyboard(),
      });

      res.status(200).json({ ok: true, action: 'fast_path_confirmation' });
      return;
    }

    // Start guided flow - create session and ask for document type
    await sessionService.createSession(payload.chatId, payload.userId);

    await telegramService.sendMessage(payload.chatId, '📄 יצירת מסמך חדש\nבחר סוג מסמך:', {
      replyMarkup: buildDocumentTypeKeyboard(),
    });

    log.info('Sent document type selection');
    res.status(200).json({ ok: true, action: 'awaiting_type_selection' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle invoice command');
    await telegramService.sendMessage(payload.chatId, '❌ שגיאה ביצירת מסמך. נסה שוב מאוחר יותר.');
    res.status(500).json({ error: 'Failed to handle invoice command' });
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
      res.status(200).json({ ok: true, action: 'no_session' });
      return;
    }

    // Handle based on session status
    if (session.status === 'awaiting_details') {
      const details = parseDetails(payload.text);

      if (!details) {
        await telegramService.sendMessage(
          payload.chatId,
          '❌ פורמט לא תקין. שלח בפורמט:\nשם לקוח, סכום, תיאור, ח.פ/ע.מ (אופציונלי)\n(לדוגמה: אלעד, 275, אלבום חתונה, 123456789)'
        );
        res.status(200).json({ ok: true, action: 'invalid_format' });
        return;
      }

      // Update session with details
      await sessionService.setDetails(payload.chatId, payload.userId, {
        customerName: details.customerName,
        description: details.description,
        amount: details.amount,
        customerTaxId: details.customerTaxId,
      });

      // Ask for payment method
      await telegramService.sendMessage(payload.chatId, '💳 אמצעי תשלום:', {
        replyMarkup: buildPaymentMethodKeyboard(),
      });

      log.info('Sent payment method selection');
      res.status(200).json({ ok: true, action: 'awaiting_payment' });
      return;
    }

    // Unknown state - ignore
    log.debug({ status: session.status }, 'Ignoring message for session status');
    res.status(200).json({ ok: true, action: 'ignored' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle invoice message');
    res.status(500).json({ error: 'Failed to handle invoice message' });
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
      await telegramService.answerCallbackQuery(payload.callbackQueryId, { text: 'שגיאה' });
      res.status(200).json({ ok: true, action: 'invalid_callback' });
      return;
    }

    // Get current session
    const session = await sessionService.getSession(payload.chatId, payload.userId);

    if (!session && action.action !== 'cancel') {
      log.debug('No active session');
      await telegramService.answerCallbackQuery(payload.callbackQueryId, {
        text: 'הפעולה פגה תוקף. שלח /invoice מחדש.',
        showAlert: true,
      });
      res.status(200).json({ ok: true, action: 'session_expired' });
      return;
    }

    // Handle action
    switch (action.action) {
      case 'select_type': {
        await sessionService.setDocumentType(payload.chatId, payload.userId, action.documentType);

        const typeLabel = action.documentType === 'invoice' ? 'חשבונית' : 'חשבונית-קבלה';

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          `📄 נבחר: ${typeLabel}\n\n📝 שלח בפורמט:\nשם לקוח, סכום, תיאור, ח.פ/ע.מ (אופציונלי)\n(לדוגמה: אלעד, 275, אלבום חתונה, 123456789)`
        );

        log.info({ documentType: action.documentType }, 'Document type selected');
        res.status(200).json({ ok: true, action: 'type_selected' });
        break;
      }

      case 'select_payment': {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        await sessionService.setPaymentMethod(
          payload.chatId,
          payload.userId,
          action.paymentMethod,
          dateStr
        );

        // Get updated session for confirmation
        const updatedSession = await sessionService.getSession(payload.chatId, payload.userId);

        if (!updatedSession) {
          throw new Error('Session lost after update');
        }

        const typeLabel = updatedSession.documentType === 'invoice' ? 'חשבונית' : 'חשבונית-קבלה';

        const confirmText = `✅ אישור יצירת מסמך:
━━━━━━━━━━━━━━━━
סוג: ${typeLabel}
לקוח: ${updatedSession.customerName}
תיאור: ${updatedSession.description}
סכום: ₪${updatedSession.amount}
תשלום: ${action.paymentMethod}
תאריך: ${formatDateDisplay(dateStr)}
━━━━━━━━━━━━━━━━`;

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(payload.chatId, payload.messageId, confirmText);
        await telegramService.sendMessage(payload.chatId, 'בחר פעולה:', {
          replyMarkup: buildConfirmationKeyboard(),
        });

        log.info({ paymentMethod: action.paymentMethod }, 'Payment method selected');
        res.status(200).json({ ok: true, action: 'payment_selected' });
        break;
      }

      case 'confirm': {
        const confirmedSession = await sessionService.getConfirmedSession(
          payload.chatId,
          payload.userId
        );

        if (!confirmedSession) {
          await telegramService.answerCallbackQuery(payload.callbackQueryId, {
            text: 'חסרים פרטים. שלח /invoice מחדש.',
            showAlert: true,
          });
          res.status(200).json({ ok: true, action: 'incomplete_session' });
          return;
        }

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          '⏳ מייצר מסמך...'
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

          // Send PDF
          const typeLabel =
            confirmedSession.documentType === 'invoice' ? 'חשבונית' : 'חשבונית-קבלה';

          await telegramService.sendDocument(
            payload.chatId,
            result.pdfBuffer,
            `${typeLabel}_${result.invoiceNumber}.pdf`,
            { caption: `📄 ${typeLabel} מספר ${result.invoiceNumber}` }
          );

          await telegramService.editMessageText(
            payload.chatId,
            payload.messageId,
            `✅ ${typeLabel} מספר ${result.invoiceNumber} נוצרה בהצלחה!`
          );

          log.info({ invoiceNumber: result.invoiceNumber }, 'Invoice generated and sent');
          res
            .status(200)
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
            '❌ שגיאה ביצירת המסמך!'
          );

          // Send detailed error message
          const errorText = `⚠️ לא הצלחנו ליצור את המסמך.

אנא נסה שוב עם /invoice`;

          await telegramService.sendMessage(payload.chatId, errorText);

          res.status(500).json({ error: 'Invoice generation failed', details: errorMessage });
        }
        break;
      }

      case 'cancel': {
        await sessionService.deleteSession(payload.chatId, payload.userId);

        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        await telegramService.editMessageText(
          payload.chatId,
          payload.messageId,
          '❌ יצירת המסמך בוטלה.'
        );

        log.info('Invoice creation cancelled');
        res.status(200).json({ ok: true, action: 'cancelled' });
        break;
      }

      default:
        log.warn({ action }, 'Unknown callback action');
        await telegramService.answerCallbackQuery(payload.callbackQueryId);
        res.status(200).json({ ok: true, action: 'unknown_action' });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error({ error: errorMessage, stack: errorStack }, 'Failed to handle invoice callback');

    try {
      await telegramService.answerCallbackQuery(payload.callbackQueryId, {
        text: 'שגיאה. נסה שוב.',
        showAlert: true,
      });
    } catch {
      // Ignore if answering fails
    }

    res.status(500).json({ error: 'Failed to handle invoice callback' });
  }
}

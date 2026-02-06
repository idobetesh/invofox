/**
 * Invoice Keyboards Service
 * Generates Telegram inline keyboards for invoice flow
 */

import type {
  TelegramInlineKeyboardMarkup,
  InvoiceCallbackAction,
  PaymentMethod,
} from '../../../../../shared/types';
import type { OpenInvoice } from './open-invoices.service';
import { formatInvoiceForButton } from './open-invoices.service';

const PAYMENT_METHODS: PaymentMethod[] = ['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק'];

/**
 * Build document type selection keyboard
 */
export function buildDocumentTypeKeyboard(): TelegramInlineKeyboardMarkup {
  const invoiceData: InvoiceCallbackAction = { action: 'select_type', documentType: 'invoice' };
  const invoiceReceiptData: InvoiceCallbackAction = {
    action: 'select_type',
    documentType: 'invoice_receipt',
  };
  const receiptData: InvoiceCallbackAction = { action: 'select_type', documentType: 'receipt' };

  return {
    inline_keyboard: [
      [
        { text: 'חשבונית', callback_data: JSON.stringify(invoiceData) },
        { text: 'חשבונית-קבלה', callback_data: JSON.stringify(invoiceReceiptData) },
      ],
      [{ text: 'קבלה', callback_data: JSON.stringify(receiptData) }],
    ],
  };
}

/**
 * Build payment method selection keyboard
 */
export function buildPaymentMethodKeyboard(): TelegramInlineKeyboardMarkup {
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
export function buildConfirmationKeyboard(): TelegramInlineKeyboardMarkup {
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
 * Build invoice selection keyboard for receipt creation
 * Shows open invoices with invoice number, customer name, and remaining balance
 */
export function buildInvoiceSelectionKeyboard(
  openInvoices: OpenInvoice[]
): TelegramInlineKeyboardMarkup {
  const rows: { text: string; callback_data: string }[][] = [];

  // Add a button for each open invoice (max 10 to avoid message size limits)
  const invoicesToShow = openInvoices.slice(0, 10);

  for (const invoice of invoicesToShow) {
    const data: InvoiceCallbackAction = {
      action: 'select_invoice',
      invoiceNumber: invoice.invoiceNumber,
    };
    rows.push([
      {
        text: formatInvoiceForButton(invoice),
        callback_data: JSON.stringify(data),
      },
    ]);
  }

  // Add cancel button
  const cancelData: InvoiceCallbackAction = { action: 'cancel' };
  rows.push([{ text: '❌ בטל', callback_data: JSON.stringify(cancelData) }]);

  return { inline_keyboard: rows };
}

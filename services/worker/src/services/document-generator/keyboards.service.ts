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
 * @param openInvoices - List of open invoices to display
 * @param offset - Current pagination offset
 * @param totalCount - Total number of open invoices available
 */
export function buildInvoiceSelectionKeyboard(
  openInvoices: OpenInvoice[],
  offset: number = 0,
  totalCount: number = 0
): TelegramInlineKeyboardMarkup {
  const rows: { text: string; callback_data: string }[][] = [];

  // Add a button for each open invoice
  for (const invoice of openInvoices) {
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

  // Add "Show More" button if there are more invoices to display
  const hasMore = offset + openInvoices.length < totalCount;
  if (hasMore) {
    const showMoreData: InvoiceCallbackAction = {
      action: 'show_more',
      offset: offset + openInvoices.length,
    };
    rows.push([
      {
        text: `📄 הצג עוד (${offset + openInvoices.length}/${totalCount})`,
        callback_data: JSON.stringify(showMoreData),
      },
    ]);
  }

  // Add cancel button
  const cancelData: InvoiceCallbackAction = { action: 'cancel' };
  rows.push([{ text: '❌ בטל', callback_data: JSON.stringify(cancelData) }]);

  return { inline_keyboard: rows };
}

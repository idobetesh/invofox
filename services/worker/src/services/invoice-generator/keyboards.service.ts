/**
 * Invoice Keyboards Service
 * Generates Telegram inline keyboards for invoice flow
 */

import type {
  TelegramInlineKeyboardMarkup,
  InvoiceCallbackAction,
  PaymentMethod,
} from '../../../../../shared/types';

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

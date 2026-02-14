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
 * Build invoice selection keyboard for receipt creation (multi-select)
 * Shows open invoices with checkbox selection, customer validation, and selection limits
 * @param openInvoices - List of open invoices to display
 * @param selectedInvoiceNumbers - Currently selected invoice numbers
 * @param offset - Current pagination offset
 * @param totalCount - Total number of open invoices available
 */
export function buildInvoiceSelectionKeyboard(
  openInvoices: OpenInvoice[],
  selectedInvoiceNumbers: string[] = [],
  offset: number = 0,
  totalCount: number = 0
): TelegramInlineKeyboardMarkup {
  const rows: { text: string; callback_data: string }[][] = [];

  // Determine the first selected customer (for customer consistency validation)
  const selectedInvoicesData = openInvoices.filter((inv) =>
    selectedInvoiceNumbers.includes(inv.invoiceNumber)
  );
  const firstSelectedCustomer =
    selectedInvoicesData.length > 0 ? selectedInvoicesData[0].customerName : null;

  // Check if max limit reached
  const maxLimitReached = selectedInvoiceNumbers.length >= 10;

  // Add a button for each open invoice
  for (const invoice of openInvoices) {
    const isSelected = selectedInvoiceNumbers.includes(invoice.invoiceNumber);
    const isDifferentCustomer =
      firstSelectedCustomer !== null && invoice.customerName !== firstSelectedCustomer;
    const isDisabled = (maxLimitReached && !isSelected) || isDifferentCustomer;

    // Build button text with checkbox and status prefixes
    let prefix = '';
    if (isDifferentCustomer) {
      prefix = '⛔ ☐ ';
    } else if (isSelected) {
      prefix = '☑ ';
    } else {
      prefix = '☐ ';
    }

    const data: InvoiceCallbackAction = {
      action: 'toggle_invoice',
      invoiceNumber: invoice.invoiceNumber,
    };

    rows.push([
      {
        text: `${prefix}${formatInvoiceForButton(invoice)}`,
        callback_data: isDisabled && !isSelected ? 'noop' : JSON.stringify(data),
      },
    ]);
  }

  // Add selection summary row if invoices are selected
  if (selectedInvoiceNumbers.length > 0) {
    const totalAmount = selectedInvoicesData.reduce(
      (sum, inv) => sum + (inv.remainingBalance || 0),
      0
    );
    // Use the currency from the first selected invoice, default to ILS
    const currency = selectedInvoicesData[0]?.currency || 'ILS';
    const currencySymbol = currency === 'ILS' ? '₪' : currency;

    const summaryText = `✅ נבחרו: ${selectedInvoiceNumbers.length} חשבוניות | סה״כ: ${currencySymbol}${totalAmount.toFixed(2)}`;
    rows.push([{ text: summaryText, callback_data: 'noop' }]);
  }

  // Add "Continue with Selection" button if 2+ invoices selected
  if (selectedInvoiceNumbers.length >= 2) {
    const confirmData: InvoiceCallbackAction = { action: 'confirm_selection' };
    rows.push([
      {
        text: '▶️ המשך עם הבחירה',
        callback_data: JSON.stringify(confirmData),
      },
    ]);
  } else if (selectedInvoiceNumbers.length === 0) {
    // Show helper text when no selection
    rows.push([{ text: '💡 בחר לפחות 2 חשבוניות', callback_data: 'noop' }]);
  } else if (selectedInvoiceNumbers.length === 1) {
    // Show helper text when only 1 selected
    rows.push([{ text: '💡 בחר עוד חשבונית אחת לפחות', callback_data: 'noop' }]);
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

/**
 * Invoice Messages Service
 * Formats invoice-related messages
 */

import { t } from '../i18n/languages';

/**
 * Get document type label
 */
export function getDocumentTypeLabel(
  documentType: 'invoice' | 'invoice_receipt',
  language: 'en' | 'he' = 'he'
): string {
  return documentType === 'invoice'
    ? t(language, 'invoice.typeInvoice')
    : t(language, 'invoice.typeInvoiceReceipt');
}

/**
 * Format date for display (DD/MM/YYYY)
 */
export function formatDateDisplay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    return dateStr;
  }
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Build confirmation message
 */
export function buildConfirmationMessage(params: {
  documentType: 'invoice' | 'invoice_receipt';
  customerName: string;
  description: string;
  amount: number;
  paymentMethod: string;
  date: string;
  language?: 'en' | 'he';
}): string {
  const language = params.language || 'he';
  const typeLabel = getDocumentTypeLabel(params.documentType, language);

  const title = t(language, 'invoice.confirmationTitle');
  const fields = t(language, 'invoice.confirmationFields', {
    type: typeLabel,
    customer: params.customerName,
    description: params.description,
    amount: params.amount.toString(),
    payment: params.paymentMethod,
    date: formatDateDisplay(params.date),
  });

  return `${title}\n━━━━━━━━━━━━━━━━\n${fields}\n━━━━━━━━━━━━━━━━`;
}

/**
 * Build success message
 */
export function buildSuccessMessage(
  documentType: 'invoice' | 'invoice_receipt',
  invoiceNumber: number,
  language: 'en' | 'he' = 'he'
): string {
  const typeLabel = getDocumentTypeLabel(documentType, language);
  return t(language, 'invoice.created', {
    type: typeLabel,
    number: invoiceNumber.toString(),
  });
}

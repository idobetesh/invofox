/**
 * Invoice Messages Service
 * Formats invoice-related messages
 */

import { t } from '../i18n/languages';
import type { InvoiceDocumentType } from '../../../../../shared/types';

/**
 * Get document type label
 */
export function getDocumentTypeLabel(
  documentType: InvoiceDocumentType,
  language: 'en' | 'he' = 'he'
): string {
  switch (documentType) {
    case 'invoice':
      return t(language, 'invoice.typeInvoice');
    case 'invoice_receipt':
      return t(language, 'invoice.typeInvoiceReceipt');
    case 'receipt':
      return t(language, 'invoice.typeReceipt');
    default:
      return documentType;
  }
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
  documentType: InvoiceDocumentType;
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

  // For invoices (no payment yet), use a version without payment method
  // For invoice-receipts and receipts, include payment method
  const fields = params.paymentMethod
    ? t(language, 'invoice.confirmationFields', {
        type: typeLabel,
        customer: params.customerName,
        description: params.description,
        amount: params.amount.toString(),
        payment: params.paymentMethod,
        date: formatDateDisplay(params.date),
      })
    : t(language, 'invoice.confirmationFieldsNoPayment', {
        type: typeLabel,
        customer: params.customerName,
        description: params.description,
        amount: params.amount.toString(),
        date: formatDateDisplay(params.date),
      });

  return `${title}\n━━━━━━━━━━━━━━━━\n${fields}\n━━━━━━━━━━━━━━━━`;
}

/**
 * Build success message
 */
export function buildSuccessMessage(
  documentType: InvoiceDocumentType,
  invoiceNumber: number,
  language: 'en' | 'he' = 'he'
): string {
  const typeLabel = getDocumentTypeLabel(documentType, language);
  return t(language, 'invoice.created', {
    type: typeLabel,
    number: invoiceNumber.toString(),
  });
}

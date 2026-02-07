/**
 * Invoice Sheet Helpers
 * Helper functions for generating Google Sheets data from invoice records
 */

import type { InvoiceSession } from '../../../../../shared/types';

/**
 * Get Hebrew document type label for Google Sheets
 * @param type - Document type (invoice, invoice_receipt, receipt)
 * @returns Hebrew label (חשבונית, חשבונית-קבלה, קבלה)
 */
export function getDocumentTypeLabel(type: string): string {
  switch (type) {
    case 'invoice':
      return 'חשבונית';
    case 'invoice_receipt':
      return 'חשבונית-קבלה';
    case 'receipt':
      return 'קבלה';
    default:
      return type;
  }
}

/**
 * Get related invoice number for Google Sheets (receipts only)
 * @param type - Document type
 * @param session - Invoice session data
 * @returns Related invoice number (empty string for non-receipts)
 */
export function getRelatedInvoice(type: string, session: InvoiceSession): string {
  if (type === 'receipt' && session.relatedInvoiceNumber) {
    return session.relatedInvoiceNumber;
  }
  return ''; // Only receipts have related invoices
}

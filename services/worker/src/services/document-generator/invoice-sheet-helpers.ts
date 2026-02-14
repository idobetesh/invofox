/**
 * Invoice Sheet Helpers
 * Helper functions for generating Google Sheets data from invoice records
 */

import type { InvoiceSession } from '../../../../../shared/types';

/**
 * Get related invoice number for Google Sheets (receipts only)
 * For multi-invoice receipts, returns comma-separated list
 * @param type - Document type
 * @param session - Invoice session data
 * @returns Related invoice number(s) (empty string for non-receipts)
 */
export function getRelatedInvoice(type: string, session: InvoiceSession): string {
  if (type !== 'receipt') {
    return ''; // Only receipts have related invoices
  }

  // NEW: Multi-invoice receipts (2+ invoices)
  if (session.selectedInvoiceNumbers && session.selectedInvoiceNumbers.length >= 2) {
    return session.selectedInvoiceNumbers.join(', ');
  }

  // NEW: Single-invoice receipt (1 invoice in array)
  if (session.selectedInvoiceNumbers && session.selectedInvoiceNumbers.length === 1) {
    return session.selectedInvoiceNumbers[0];
  }

  // LEGACY: Old receipts with relatedInvoiceNumber field
  if (session.relatedInvoiceNumber) {
    return session.relatedInvoiceNumber;
  }

  return '';
}

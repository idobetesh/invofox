/**
 * Invoice Sheet Helpers
 * Helper functions for generating Google Sheets data from invoice records
 */

import type { InvoiceSession } from '../../../../../shared/types';

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

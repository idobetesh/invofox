/**
 * Open Invoices Service
 * Queries unpaid/partially paid invoices for receipt creation
 */

import { GENERATED_INVOICES_COLLECTION } from '../../../../../shared/collections';
import logger from '../../logger';
import { getFirestore } from '../store.service';

export interface OpenInvoice {
  invoiceNumber: string;
  customerName: string;
  amount: number;
  paidAmount: number;
  remainingBalance: number;
  date: string;
}

/**
 * Query open invoices (unpaid or partially paid) for a customer
 * Returns invoices sorted by date (newest first)
 * @param chatId - Customer's chat ID
 * @param offset - Pagination offset (default 0)
 * @param limit - Number of invoices to fetch (default 10)
 */
export async function getOpenInvoices(
  chatId: number,
  offset: number = 0,
  limit: number = 10
): Promise<OpenInvoice[]> {
  const db = getFirestore();
  const log = logger.child({ chatId, offset, limit, function: 'getOpenInvoices' });

  try {
    // Query invoices that are not fully paid
    // paymentStatus can be 'unpaid' or 'partial'
    const snapshot = await db
      .collection(GENERATED_INVOICES_COLLECTION)
      .where('chatId', '==', chatId)
      .where('documentType', '==', 'invoice')
      .where('paymentStatus', 'in', ['unpaid', 'partial'])
      .orderBy('generatedAt', 'desc')
      .offset(offset) // Skip already shown invoices
      .limit(limit) // Fetch next batch
      .get();

    if (snapshot.empty) {
      log.info('No open invoices found for customer');
      return [];
    }

    const openInvoices: OpenInvoice[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // Double-check that remaining balance > 0
      if (data.remainingBalance && data.remainingBalance > 0) {
        openInvoices.push({
          invoiceNumber: data.invoiceNumber || doc.id,
          customerName: data.customerName || 'Unknown',
          amount: data.amount || 0,
          paidAmount: data.paidAmount || 0,
          remainingBalance: data.remainingBalance,
          date: data.date || '',
        });
      }
    }

    log.info({ count: openInvoices.length, offset }, 'Found open invoices');
    return openInvoices;
  } catch (error) {
    log.error({ error }, 'Failed to query open invoices');
    throw error;
  }
}

/**
 * Count total open invoices for a customer
 * Used to determine if "Show More" button should be displayed
 */
export async function countOpenInvoices(chatId: number): Promise<number> {
  const db = getFirestore();
  const log = logger.child({ chatId, function: 'countOpenInvoices' });

  try {
    const snapshot = await db
      .collection(GENERATED_INVOICES_COLLECTION)
      .where('chatId', '==', chatId)
      .where('documentType', '==', 'invoice')
      .where('paymentStatus', 'in', ['unpaid', 'partial'])
      .count()
      .get();

    const count = snapshot.data().count;
    log.info({ count }, 'Counted open invoices');
    return count;
  } catch (error) {
    log.error({ error }, 'Failed to count open invoices');
    return 0; // Return 0 on error to avoid breaking the flow
  }
}

/**
 * Format open invoice for display in keyboard button
 * Format: "I-2026-5 | John Doe | ₪500"
 */
export function formatInvoiceForButton(invoice: OpenInvoice): string {
  return `${invoice.invoiceNumber} | ${invoice.customerName} | ₪${invoice.remainingBalance}`;
}

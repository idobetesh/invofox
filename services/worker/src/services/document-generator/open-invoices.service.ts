/**
 * Open Invoices Service
 * Queries unpaid/partially paid invoices for receipt creation
 */

import { Firestore } from '@google-cloud/firestore';
import { GENERATED_INVOICES_COLLECTION } from '../../../../../shared/collections';
import logger from '../../logger';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

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
 */
export async function getOpenInvoices(chatId: number): Promise<OpenInvoice[]> {
  const db = getFirestore();
  const log = logger.child({ chatId, function: 'getOpenInvoices' });

  try {
    // Query invoices that are not fully paid
    // paymentStatus can be 'unpaid' or 'partial'
    const snapshot = await db
      .collection(GENERATED_INVOICES_COLLECTION)
      .where('chatId', '==', chatId)
      .where('documentType', '==', 'invoice')
      .where('paymentStatus', 'in', ['unpaid', 'partial'])
      .orderBy('generatedAt', 'desc')
      .limit(20) // Limit to 20 most recent open invoices
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

    log.info({ count: openInvoices.length }, 'Found open invoices');
    return openInvoices;
  } catch (error) {
    log.error({ error }, 'Failed to query open invoices');
    throw error;
  }
}

/**
 * Format open invoice for display in keyboard button
 * Format: "I-2026-5 | John Doe | ₪500"
 */
export function formatInvoiceForButton(invoice: OpenInvoice): string {
  return `${invoice.invoiceNumber} | ${invoice.customerName} | ₪${invoice.remainingBalance}`;
}

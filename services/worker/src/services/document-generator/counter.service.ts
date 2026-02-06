/**
 * Invoice counter service
 * Manages sequential invoice numbering with yearly reset
 * Uses Firestore transactions for atomic increment
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import type { InvoiceCounter } from '../../../../../shared/types';
import {
  INVOICE_COUNTERS_COLLECTION,
  GENERATED_INVOICES_COLLECTION,
  formatDocumentNumber,
} from '../../../../../shared/collections';
import logger from '../../logger';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Get current year as string
 */
function getCurrentYear(): string {
  return new Date().getFullYear().toString();
}

/**
 * Get the next document number atomically for a specific customer and document type
 * Format: I-{year}-{sequence} for invoice (e.g., "I-2026-1", "I-2026-2")
 * Format: R-{year}-{sequence} for receipt (e.g., "R-2026-1", "R-2026-2")
 * Format: IR-{year}-{sequence} for invoice_receipt (e.g., "IR-2026-1", "IR-2026-2")
 * Counter resets to 1 on January 1st each year
 * Each customer has their own independent counter per document type
 * @param chatId - Customer's Telegram chat ID
 * @param documentType - Type of document to generate number for
 */
export async function getNextDocumentNumber(
  chatId: number,
  documentType: 'invoice' | 'receipt' | 'invoice_receipt' = 'invoice'
): Promise<string> {
  const db = getFirestore();
  const year = getCurrentYear();
  const docId = `chat_${chatId}_${year}`;
  const docRef = db.collection(INVOICE_COUNTERS_COLLECTION).doc(docId);
  const log = logger.child({ year, chatId, documentType, collection: INVOICE_COUNTERS_COLLECTION });

  const counter = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    let counter: number;

    if (doc.exists) {
      const data = doc.data() as InvoiceCounter;
      const currentCounter = data[documentType]?.counter || 0;
      counter = currentCounter + 1;

      log.debug(
        { previousCounter: currentCounter, newCounter: counter },
        `Incrementing ${documentType} counter`
      );

      transaction.update(docRef, {
        [`${documentType}.counter`]: counter,
        [`${documentType}.lastUpdated`]: FieldValue.serverTimestamp(),
      });
    } else {
      // First document of the year for this customer
      counter = 1;

      log.info({ counter }, 'Creating new counter for customer and year');

      transaction.set(docRef, {
        invoice: {
          counter: documentType === 'invoice' ? 1 : 0,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        receipt: {
          counter: documentType === 'receipt' ? 1 : 0,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        invoice_receipt: {
          counter: documentType === 'invoice_receipt' ? 1 : 0,
          lastUpdated: FieldValue.serverTimestamp(),
        },
      });
    }

    return counter;
  });

  const documentNumber = formatDocumentNumber(documentType, year, counter);
  log.info({ documentNumber }, `Generated ${documentType} number for customer`);

  return documentNumber;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use getNextDocumentNumber instead
 */
export async function getNextInvoiceNumber(chatId: number): Promise<string> {
  return getNextDocumentNumber(chatId, 'invoice');
}

/**
 * Get current counter value for a customer and year (for display/debugging)
 * @param chatId - Customer's Telegram chat ID
 * @param year - Optional year (defaults to current year)
 */
export async function getCurrentCounter(chatId: number, year?: string): Promise<number> {
  const db = getFirestore();
  const targetYear = year || getCurrentYear();
  const docId = `chat_${chatId}_${targetYear}`;
  const docRef = db.collection(INVOICE_COUNTERS_COLLECTION).doc(docId);

  const doc = await docRef.get();

  if (!doc.exists) {
    return 0;
  }

  const data = doc.data() as InvoiceCounter;
  return data.invoice?.counter || 0;
}

/**
 * Initialize counter for a customer at a specific starting number
 * Useful for onboarding existing businesses with previous invoices
 * @param chatId - Customer's Telegram chat ID
 * @param startingNumber - Starting counter value
 * @param year - Optional year (defaults to current year)
 * @throws Error if counter already exists
 */
export async function initializeCounter(
  chatId: number,
  startingNumber: number,
  year?: string
): Promise<void> {
  const db = getFirestore();
  const targetYear = year || getCurrentYear();
  const docId = `chat_${chatId}_${targetYear}`;
  const docRef = db.collection(INVOICE_COUNTERS_COLLECTION).doc(docId);

  // Safety check: prevent any overwrites
  const existing = await docRef.get();
  if (existing.exists) {
    const data = existing.data() as InvoiceCounter;
    const currentCounter = data.invoice?.counter || 0;
    throw new Error(
      `Counter already exists for customer ${chatId} in year ${targetYear} (current value: ${currentCounter}). ` +
        `Cannot overwrite existing counter to prevent invoice number collisions. ` +
        `If you need to modify it, use Firestore console directly.`
    );
  }

  await docRef.set({
    invoice: {
      counter: startingNumber,
      lastUpdated: FieldValue.serverTimestamp(),
    },
    receipt: {
      counter: 0,
      lastUpdated: FieldValue.serverTimestamp(),
    },
    invoice_receipt: {
      counter: 0,
      lastUpdated: FieldValue.serverTimestamp(),
    },
  });

  logger.info({ chatId, startingNumber, year: targetYear }, 'Counter initialized for customer');
}

/**
 * Check if invoice number already exists for a customer
 * Used for validation before generating PDF
 * @param chatId - Customer's Telegram chat ID
 * @param invoiceNumber - Invoice number to check
 */
export async function invoiceNumberExists(chatId: number, invoiceNumber: string): Promise<boolean> {
  const db = getFirestore();
  const docId = `chat_${chatId}_${invoiceNumber}`;
  const docRef = db.collection(GENERATED_INVOICES_COLLECTION).doc(docId);

  const doc = await docRef.get();
  return doc.exists;
}

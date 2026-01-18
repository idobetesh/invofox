/**
 * Invoice counter service
 * Manages sequential invoice numbering with yearly reset
 * Uses Firestore transactions for atomic increment
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import type { InvoiceCounter } from '../../../../../shared/types';
import logger from '../../logger';

const COLLECTION_NAME = 'invoice_counters';

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
 * Get the next invoice number atomically for a specific customer
 * Format: {year}{sequence} (e.g., "20261", "20262", ...)
 * Counter resets to 1 on January 1st each year
 * Each customer has their own independent counter
 * @param chatId - Customer's Telegram chat ID
 */
export async function getNextInvoiceNumber(chatId: number): Promise<string> {
  const db = getFirestore();
  const year = getCurrentYear();
  const docId = `chat_${chatId}_${year}`;
  const docRef = db.collection(COLLECTION_NAME).doc(docId);
  const log = logger.child({ year, chatId, collection: COLLECTION_NAME });

  return db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    let counter: number;

    if (doc.exists) {
      const data = doc.data() as InvoiceCounter;
      counter = data.counter + 1;

      log.debug({ previousCounter: data.counter, newCounter: counter }, 'Incrementing counter');

      transaction.update(docRef, {
        counter,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    } else {
      // First invoice of the year for this customer
      counter = 1;

      log.info({ counter }, 'Creating new counter for customer and year');

      transaction.set(docRef, {
        counter,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }

    // Format: year + counter (e.g., "2026" + "1" = "20261")
    const invoiceNumber = `${year}${counter}`;

    log.info({ invoiceNumber }, 'Generated invoice number for customer');

    return invoiceNumber;
  });
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
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  const doc = await docRef.get();

  if (!doc.exists) {
    return 0;
  }

  const data = doc.data() as InvoiceCounter;
  return data.counter;
}

/**
 * Initialize counter for a customer at a specific starting number
 * Useful for onboarding existing businesses with previous invoices
 * @param chatId - Customer's Telegram chat ID
 * @param startingNumber - Starting counter value
 * @param year - Optional year (defaults to current year)
 */
export async function initializeCounter(
  chatId: number,
  startingNumber: number,
  year?: string
): Promise<void> {
  const db = getFirestore();
  const targetYear = year || getCurrentYear();
  const docId = `chat_${chatId}_${targetYear}`;
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  await docRef.set({
    counter: startingNumber,
    lastUpdated: FieldValue.serverTimestamp(),
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
  const docRef = db.collection('generated_invoices').doc(docId);

  const doc = await docRef.get();
  return doc.exists;
}

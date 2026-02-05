/**
 * Document Counter Service
 * Manages sequential document numbering with yearly reset
 * Supports 3 document types: invoice, receipt, invoice_receipt
 *
 * NOTE: Assumes counters have been migrated to new format.
 * Run migrate-counters.ts if you have legacy counters.
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';

const COLLECTION_NAME = 'invoice_counters';

/**
 * Document type for counter tracking
 */
export type DocumentType = 'invoice' | 'receipt' | 'invoice_receipt';

/**
 * Document counter structure
 */
interface DocumentCounter {
  counter: number;
  lastUpdated: any;
}

/**
 * Invoice counter format (3 separate counters)
 */
interface InvoiceCounter {
  invoice: DocumentCounter;
  receipt: DocumentCounter;
  invoice_receipt: DocumentCounter;
}

/**
 * Create initial counter document with all types initialized to 0
 */
function createInitialCounter(): InvoiceCounter {
  const timestamp = FieldValue.serverTimestamp();
  return {
    invoice: { counter: 0, lastUpdated: timestamp },
    receipt: { counter: 0, lastUpdated: timestamp },
    invoice_receipt: { counter: 0, lastUpdated: timestamp },
  };
}

export class CounterService {
  private firestore: Firestore;

  constructor(firestore: Firestore) {
    this.firestore = firestore;
  }

  /**
   * Get the next document number atomically for a specific customer and document type
   * Format: {year}{sequence} for invoice/invoice_receipt (e.g., "20261", "20262")
   * Format: R-{year}-{sequence} for receipt (e.g., "R-2026-1", "R-2026-2")
   * Counter resets on January 1st each year
   * Each customer has their own independent counters per document type
   */
  async getNextDocumentNumber(chatId: number, documentType: DocumentType): Promise<string> {
    const year = new Date().getFullYear();
    const counterDocId = `chat_${chatId}_${year}`;
    const counterRef = this.firestore.collection(COLLECTION_NAME).doc(counterDocId);

    const result = await this.firestore.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);

      let counter: number;

      if (!counterDoc.exists) {
        // Create new counter document
        counter = 1;
        const initialData = createInitialCounter();
        initialData[documentType] = {
          counter,
          lastUpdated: FieldValue.serverTimestamp(),
        };
        transaction.set(counterRef, initialData);
      } else {
        const data = counterDoc.data();
        if (!data) {
          throw new Error('Counter document exists but has no data');
        }

        // Increment specific document type counter
        const currentCounter = data[documentType]?.counter || 0;
        counter = currentCounter + 1;

        transaction.update(counterRef, {
          [`${documentType}.counter`]: counter,
          [`${documentType}.lastUpdated`]: FieldValue.serverTimestamp(),
        });
      }

      return counter;
    });

    // Format document number based on type with prefixes
    switch (documentType) {
      case 'invoice':
        return `I-${year}-${result}`;
      case 'receipt':
        return `R-${year}-${result}`;
      case 'invoice_receipt':
        return `IR-${year}-${result}`;
      default:
        throw new Error(`Unknown document type: ${documentType}`);
    }
  }

  /**
   * Get current counter value for a document type (for display/debugging)
   */
  async getCurrentCounter(
    chatId: number,
    documentType: DocumentType,
    year?: number
  ): Promise<number> {
    const targetYear = year || new Date().getFullYear();
    const counterDocId = `chat_${chatId}_${targetYear}`;
    const counterRef = this.firestore.collection(COLLECTION_NAME).doc(counterDocId);

    const counterDoc = await counterRef.get();

    if (!counterDoc.exists) {
      return 0;
    }

    const data = counterDoc.data();
    if (!data) {
      return 0;
    }
    return data[documentType]?.counter || 0;
  }

  /**
   * Get all counters for a customer and year (for display/debugging)
   */
  async getAllCounters(
    chatId: number,
    year?: number
  ): Promise<{ invoice: number; receipt: number; invoice_receipt: number }> {
    const targetYear = year || new Date().getFullYear();
    const counterDocId = `chat_${chatId}_${targetYear}`;
    const counterRef = this.firestore.collection(COLLECTION_NAME).doc(counterDocId);

    const counterDoc = await counterRef.get();

    if (!counterDoc.exists) {
      return { invoice: 0, receipt: 0, invoice_receipt: 0 };
    }

    const data = counterDoc.data();
    if (!data) {
      return { invoice: 0, receipt: 0, invoice_receipt: 0 };
    }

    return {
      invoice: data.invoice?.counter || 0,
      receipt: data.receipt?.counter || 0,
      invoice_receipt: data.invoice_receipt?.counter || 0,
    };
  }
}

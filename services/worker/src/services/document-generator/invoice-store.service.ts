/**
 * Invoice Store Service
 * Firestore read/write operations for invoice documents
 */

import { FieldValue, Timestamp } from '@google-cloud/firestore';
import type {
  InvoiceData,
  GeneratedInvoice,
  InvoiceSession,
  PaymentStatus,
} from '../../../../../shared/types';
import {
  getCollectionForDocumentType,
  GENERATED_INVOICES_COLLECTION,
  GENERATED_RECEIPTS_COLLECTION,
  GENERATED_INVOICE_RECEIPTS_COLLECTION,
} from '../../../../../shared/collections';
import { getFirestore } from '../firestore.service';
import logger from '../../logger';

/**
 * Format date from YYYY-MM-DD to DD/MM/YYYY (internal helper)
 */
function formatDateDisplay(date: string): string {
  const parts = date.split('-');
  if (parts.length !== 3) {
    return date;
  }
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Get generated document by customer and number (searches all collections after split)
 * @param chatId - Customer's Telegram chat ID
 * @param invoiceNumber - Document number to look up
 */
export async function getGeneratedInvoice(
  chatId: number,
  invoiceNumber: string
): Promise<GeneratedInvoice | null> {
  const db = getFirestore();
  const docId = `chat_${chatId}_${invoiceNumber}`;

  // Try all 3 collections after collection split
  const collections = [
    GENERATED_INVOICES_COLLECTION,
    GENERATED_RECEIPTS_COLLECTION,
    GENERATED_INVOICE_RECEIPTS_COLLECTION,
  ];

  for (const collectionName of collections) {
    const docRef = db.collection(collectionName).doc(docId);
    const doc = await docRef.get();

    if (doc.exists) {
      return doc.data() as GeneratedInvoice;
    }
  }

  return null;
}

/**
 * Save invoice record to Firestore for audit trail with per-customer document ID
 * Document ID format: chat_{chatId}_{invoiceNumber}
 */
export async function saveInvoiceRecord(
  invoiceNumber: string,
  data: InvoiceData,
  userId: number,
  username: string,
  chatId: number,
  storageUrl: string,
  session?: InvoiceSession
): Promise<void> {
  const db = getFirestore();
  const docId = `chat_${chatId}_${invoiceNumber}`;
  const collectionName = getCollectionForDocumentType(data.documentType);
  const docRef = db.collection(collectionName).doc(docId);

  // Detect multi-invoice receipt (2+ invoices)
  const isMultiInvoiceReceipt =
    data.documentType === 'receipt' &&
    session?.selectedInvoiceNumbers &&
    session.selectedInvoiceNumbers.length >= 2;

  // Detect single-invoice receipt using new flow (1 invoice in selectedInvoiceNumbers)
  const isSingleInvoiceNew =
    data.documentType === 'receipt' &&
    session?.selectedInvoiceNumbers &&
    session.selectedInvoiceNumbers.length === 1;

  const record: GeneratedInvoice = {
    chatId,
    invoiceNumber,
    documentType: data.documentType,
    customerName: data.customerName,
    ...(data.customerTaxId !== undefined && { customerTaxId: data.customerTaxId }),
    description: data.description,
    amount: data.amount,
    currency: data.currency || 'ILS', // Use currency from data, default to ILS
    ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
    date: formatDateDisplay(data.date),
    generatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    generatedBy: {
      telegramUserId: userId,
      username,
      chatId,
    },
    storagePath: `${chatId}/${new Date().getFullYear()}/${invoiceNumber}.pdf`,
    storageUrl,
    // Payment tracking fields (for invoices that can receive receipts later)
    ...(data.documentType === 'invoice' && {
      paymentStatus: 'unpaid' as const,
      paidAmount: 0,
      remainingBalance: data.amount,
      relatedReceiptIds: [],
    }),
    // For invoice-receipts and receipts, mark as fully paid
    ...(data.documentType !== 'invoice' && {
      paymentStatus: 'paid' as const,
      paidAmount: data.amount,
      remainingBalance: 0,
    }),
    // Multi-invoice receipt fields (2+ invoices)
    ...(isMultiInvoiceReceipt &&
      session.selectedInvoiceNumbers &&
      session.selectedInvoiceNumbers.length > 0 && {
        isMultiInvoiceReceipt: true,
        relatedInvoiceNumbers: session.selectedInvoiceNumbers,
        relatedInvoiceIds: session.selectedInvoiceNumbers.map((num) => `chat_${chatId}_${num}`),
        // Set single fields for backward compatibility (use first invoice)
        relatedInvoiceId: `chat_${chatId}_${session.selectedInvoiceNumbers[0]}`,
        relatedInvoiceNumber: session.selectedInvoiceNumbers[0],
      }),
    // Single-invoice receipt using NEW flow (1 invoice in selectedInvoiceNumbers)
    ...(isSingleInvoiceNew &&
      session.selectedInvoiceNumbers &&
      session.selectedInvoiceNumbers.length > 0 && {
        relatedInvoiceId: `chat_${chatId}_${session.selectedInvoiceNumbers[0]}`,
        relatedInvoiceNumber: session.selectedInvoiceNumbers[0],
        // Store selectedInvoiceNumbers for consistency
        relatedInvoiceNumbers: session.selectedInvoiceNumbers,
        relatedInvoiceIds: [`chat_${chatId}_${session.selectedInvoiceNumbers[0]}`],
      }),
    // Single-invoice receipt using LEGACY flow (relatedInvoiceNumber field)
    ...(!isMultiInvoiceReceipt &&
      !isSingleInvoiceNew &&
      data.documentType === 'receipt' &&
      session?.relatedInvoiceNumber && {
        relatedInvoiceId: `chat_${chatId}_${session.relatedInvoiceNumber}`,
        relatedInvoiceNumber: session.relatedInvoiceNumber,
      }),
  };

  await docRef.set(record);
}

/**
 * Update parent invoice payment tracking after receipt creation
 * @param chatId - Customer's Telegram chat ID
 * @param parentInvoiceNumber - Parent invoice number to update
 * @param receiptNumber - Receipt number to add to relatedReceiptIds
 * @param paymentAmount - Amount paid in this receipt
 */
export async function updateParentInvoicePayment(
  chatId: number,
  parentInvoiceNumber: string,
  receiptNumber: string,
  paymentAmount: number
): Promise<void> {
  const db = getFirestore();
  const docId = `chat_${chatId}_${parentInvoiceNumber}`;
  const docRef = db.collection(GENERATED_INVOICES_COLLECTION).doc(docId);

  const log = logger.child({ chatId, parentInvoiceNumber, receiptNumber, paymentAmount });

  // Use transaction to ensure atomic update
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    if (!doc.exists) {
      log.error('Parent invoice not found');
      throw new Error(`Parent invoice ${parentInvoiceNumber} not found`);
    }

    const invoice = doc.data() as GeneratedInvoice;
    const currentPaid = invoice.paidAmount || 0;
    const currentRemaining = invoice.remainingBalance ?? invoice.amount;

    const newPaidAmount = currentPaid + paymentAmount;
    const newRemainingBalance = currentRemaining - paymentAmount;

    // Determine new payment status
    let newPaymentStatus: PaymentStatus;
    if (newRemainingBalance <= 0) {
      newPaymentStatus = 'paid';
    } else if (newPaidAmount > 0) {
      newPaymentStatus = 'partial';
    } else {
      newPaymentStatus = 'unpaid';
    }

    // Update invoice
    transaction.update(docRef, {
      paidAmount: newPaidAmount,
      remainingBalance: Math.max(0, newRemainingBalance), // Ensure non-negative
      paymentStatus: newPaymentStatus,
      relatedReceiptIds: FieldValue.arrayUnion(receiptNumber),
      updatedAt: FieldValue.serverTimestamp(),
    });

    log.debug(
      {
        oldPaid: currentPaid,
        newPaid: newPaidAmount,
        oldRemaining: currentRemaining,
        newRemaining: newRemainingBalance,
        newStatus: newPaymentStatus,
      },
      'Invoice payment tracking updated'
    );
  });
}

/**
 * Update multiple parent invoices atomically for multi-invoice receipts.
 * Distributes totalPaymentAmount across invoices in order: each invoice is
 * paid as much as possible from the remaining payment pool, so partial payments
 * on a single invoice and partial coverage of a multi-invoice set both work.
 * @param chatId - Customer's Telegram chat ID
 * @param parentInvoices - Array of parent invoices to update
 * @param receiptNumber - Receipt number to add to relatedReceiptIds
 * @param totalPaymentAmount - Actual amount paid (may be less than the sum of remaining balances)
 */
export async function updateMultipleInvoicesPayment(
  chatId: number,
  parentInvoices: GeneratedInvoice[],
  receiptNumber: string,
  totalPaymentAmount: number
): Promise<void> {
  const db = getFirestore();
  const log = logger.child({
    chatId,
    receiptNumber,
    parentInvoiceCount: parentInvoices.length,
    parentInvoiceNumbers: parentInvoices.map((inv) => inv.invoiceNumber),
  });

  // Use transaction to ensure atomic update of ALL invoices
  await db.runTransaction(async (transaction) => {
    // Re-read all invoices within transaction to detect race conditions
    const docRefs = parentInvoices.map((inv) => {
      const docId = `chat_${chatId}_${inv.invoiceNumber}`;
      return db.collection(GENERATED_INVOICES_COLLECTION).doc(docId);
    });

    const docs = await Promise.all(docRefs.map((ref) => transaction.get(ref)));

    // Validate all invoices exist and are not fully paid (race condition check)
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const invoice = parentInvoices[i];

      if (!doc.exists) {
        log.error(
          { invoiceNumber: invoice.invoiceNumber },
          'Parent invoice not found in transaction'
        );
        throw new Error(`Parent invoice ${invoice.invoiceNumber} not found`);
      }

      const currentInvoice = doc.data() as GeneratedInvoice;
      const currentRemaining = currentInvoice.remainingBalance ?? currentInvoice.amount;

      if (currentRemaining <= 0) {
        log.error(
          { invoiceNumber: invoice.invoiceNumber, remainingBalance: currentRemaining },
          'Invoice already paid (race condition detected)'
        );
        throw new Error(`Invoice ${invoice.invoiceNumber} is already paid. Please try again.`);
      }
    }

    // Distribute totalPaymentAmount across invoices in order
    let remainingPayment = totalPaymentAmount;
    for (let i = 0; i < docs.length; i++) {
      const docRef = docRefs[i];
      const doc = docs[i];
      const invoice = doc.data() as GeneratedInvoice;

      const currentPaid = invoice.paidAmount || 0;
      const currentRemaining = invoice.remainingBalance ?? invoice.amount;

      // Pay as much of this invoice as the remaining payment pool allows
      const paymentForThisInvoice = Math.min(remainingPayment, currentRemaining);
      remainingPayment -= paymentForThisInvoice;

      const newPaidAmount = currentPaid + paymentForThisInvoice;
      const newRemainingBalance = currentRemaining - paymentForThisInvoice;

      let newPaymentStatus: PaymentStatus;
      if (newRemainingBalance <= 0) {
        newPaymentStatus = 'paid';
      } else if (newPaidAmount > 0) {
        newPaymentStatus = 'partial';
      } else {
        newPaymentStatus = 'unpaid';
      }

      transaction.update(docRef, {
        paidAmount: newPaidAmount,
        remainingBalance: Math.max(0, newRemainingBalance),
        paymentStatus: newPaymentStatus,
        relatedReceiptIds: FieldValue.arrayUnion(receiptNumber),
        updatedAt: FieldValue.serverTimestamp(),
      });

      log.debug(
        {
          invoiceNumber: invoice.invoiceNumber,
          oldPaid: currentPaid,
          newPaid: newPaidAmount,
          oldRemaining: currentRemaining,
          paymentForThisInvoice,
          newRemaining: newRemainingBalance,
          newStatus: newPaymentStatus,
        },
        'Invoice payment tracking updated in multi-invoice transaction'
      );
    }
  });

  log.info('All parent invoices updated atomically');
}

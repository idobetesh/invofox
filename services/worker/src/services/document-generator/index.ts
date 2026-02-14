/**
 * Invoice Generator service
 * Main orchestrator for invoice generation flow
 */

import { FieldValue, Timestamp } from '@google-cloud/firestore';
import type {
  InvoiceData,
  BusinessConfig,
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
import { generateInvoicePDFWithConfig } from './pdf.generator';
import { getNextDocumentNumber } from './counter.service';
import { getBusinessConfig, getLogoBase64 } from '../business-config/config.service';
import { appendGeneratedInvoiceRow } from '../sheets.service';
import { getRelatedInvoice } from './invoice-sheet-helpers';
import { getDocumentTypeLabel } from './messages.service';
import logger from '../../logger';
import { getConfig } from '../../config';
import { getFirestore } from '../firestore.service';
import { getStorage } from '../storage.service';

/**
 * Load business configuration from Firestore (by chat ID) or local file
 * Falls back to example config in development
 * @param chatId - Optional chat ID for customer-specific config
 */
export async function loadBusinessConfig(chatId?: number): Promise<BusinessConfig> {
  const config = await getBusinessConfig(chatId);
  logger.info({ chatId }, 'Loaded business config from Firestore');
  return config;
}

/**
 * Format date from YYYY-MM-DD to DD/MM/YYYY
 */
function formatDateDisplay(date: string): string {
  const parts = date.split('-');
  if (parts.length !== 3) {
    return date;
  }
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Generate invoice from confirmed session data
 * Returns the generated invoice details
 */
export async function generateInvoice(
  session: InvoiceSession,
  userId: number,
  username: string,
  chatId: number
): Promise<{
  invoiceNumber: string;
  pdfUrl: string;
  pdfBuffer: Buffer;
}> {
  const log = logger.child({ chatId, userId, username });
  log.info('Starting invoice generation');

  // Step 1: Validate required session fields first
  if (
    !session.documentType ||
    !session.customerName ||
    !session.description ||
    session.amount === undefined ||
    !session.date
  ) {
    throw new Error('Invoice session is incomplete - missing required fields');
  }

  // For invoice-receipts and receipts, paymentMethod is required (payment already made)
  // For invoices, paymentMethod is optional (not yet paid)
  if (
    (session.documentType === 'invoice_receipt' || session.documentType === 'receipt') &&
    !session.paymentMethod
  ) {
    throw new Error('Payment method is required for invoice-receipts and receipts');
  }

  // Validate documentType is valid
  if (!['invoice', 'receipt', 'invoice_receipt'].includes(session.documentType)) {
    throw new Error(`Invalid document type: ${session.documentType}`);
  }

  // Step 2: For receipts, validate and fetch parent invoice data
  let parentInvoice: GeneratedInvoice | null = null;
  let parentInvoices: GeneratedInvoice[] = [];
  const isMultiInvoice =
    session.selectedInvoiceNumbers && session.selectedInvoiceNumbers.length >= 2;

  if (session.documentType === 'receipt') {
    // NEW: Unified path for both single and multi-invoice receipts (using selectedInvoiceNumbers)
    if (session.selectedInvoiceNumbers && session.selectedInvoiceNumbers.length >= 1) {
      // Fetch all parent invoices (works for both single and multi)
      const invoiceNumbers = session.selectedInvoiceNumbers;

      if (invoiceNumbers.length < 1 || invoiceNumbers.length > 10) {
        throw new Error(
          `Invalid number of invoices selected: ${invoiceNumbers.length}. Must be between 1 and 10.`
        );
      }

      // Fetch all parent invoices in parallel
      parentInvoices = await Promise.all(
        invoiceNumbers.map((num) => getGeneratedInvoice(chatId, num))
      ).then((invoices) => invoices.filter((inv): inv is GeneratedInvoice => inv !== null));

      if (parentInvoices.length !== invoiceNumbers.length) {
        throw new Error('One or more parent invoices not found');
      }

      // Validate customer consistency (only for multi-invoice)
      if (invoiceNumbers.length >= 2) {
        const firstCustomer = parentInvoices[0].customerName;
        const allSameCustomer = parentInvoices.every((inv) => inv.customerName === firstCustomer);
        if (!allSameCustomer) {
          throw new Error('All invoices must belong to the same customer');
        }
      }

      // Validate all have remaining balance > 0
      const invalidInvoices = parentInvoices.filter((inv) => (inv.remainingBalance || 0) <= 0);
      if (invalidInvoices.length > 0) {
        throw new Error(
          `Invoices already paid: ${invalidInvoices.map((i) => i.invoiceNumber).join(', ')}`
        );
      }

      // Validate total amount matches sum of remaining balances
      const expectedTotal = parentInvoices.reduce(
        (sum, inv) => sum + (inv.remainingBalance || inv.amount),
        0
      );
      if (Math.abs(session.amount - expectedTotal) > 0.01) {
        // Allow small floating point differences
        throw new Error(
          `Payment amount mismatch. Expected: ${expectedTotal}, Got: ${session.amount}`
        );
      }

      // Set parentInvoice to first invoice for backward compatibility
      parentInvoice = parentInvoices[0];

      log.debug(
        {
          invoiceCount: parentInvoices.length,
          invoiceNumbers: invoiceNumbers,
          totalAmount: expectedTotal,
        },
        invoiceNumbers.length === 1
          ? 'Fetched parent invoice for single-invoice receipt'
          : 'Fetched parent invoices for multi-invoice receipt'
      );
    } else if (session.relatedInvoiceNumber) {
      // LEGACY: Old receipts created before multi-select (for backward compatibility)
      parentInvoice = await getGeneratedInvoice(chatId, session.relatedInvoiceNumber);
      if (!parentInvoice) {
        throw new Error(`Parent invoice ${session.relatedInvoiceNumber} not found`);
      }
      parentInvoices = [parentInvoice];
      log.debug(
        { parentInvoice: session.relatedInvoiceNumber },
        'Fetched parent invoice for legacy receipt'
      );
    } else {
      throw new Error('Receipt must have related invoice number(s)');
    }
  }

  // Step 3: Load config first (needed for logoUrl)
  const config = await loadBusinessConfig(chatId);

  // Step 4: Fetch logo and document number
  const [logoBase64, invoiceNumber] = await Promise.all([
    getLogoBase64(chatId, config.business.logoUrl), // Saves 1 Firestore read!
    getNextDocumentNumber(chatId, session.documentType),
  ]);

  log.debug(
    {
      businessName: config.business.name,
      hasLogo: !!logoBase64,
      documentNumber: invoiceNumber,
      documentType: session.documentType,
    },
    'Loaded config, logo, and document number (optimized)'
  );

  // Build invoice data
  const invoiceData: InvoiceData = {
    invoiceNumber,
    documentType: session.documentType,
    customerName: session.customerName,
    customerTaxId: session.customerTaxId,
    description: session.description,
    amount: session.amount,
    currency: session.currency || 'ILS', // Default to ILS if not specified
    paymentMethod: session.paymentMethod,
    date: session.date,
  };

  // Generate PDF (pass session for receipts to include parent invoice data)
  const pdfBuffer = await generateInvoicePDFWithConfig(
    invoiceData,
    config,
    logoBase64,
    session,
    parentInvoice,
    parentInvoices.length > 0 ? parentInvoices : undefined
  );
  log.info({ pdfSize: pdfBuffer.length }, 'PDF generated');

  // Upload to Cloud Storage (per-customer path)
  const pdfUrl = await uploadPDF(chatId, invoiceNumber, pdfBuffer);
  log.info({ pdfUrl }, 'PDF uploaded to storage');

  // Save to Firestore audit log
  await saveInvoiceRecord(invoiceNumber, invoiceData, userId, username, chatId, pdfUrl, session);
  log.info('Invoice record saved to Firestore');

  // If this is a receipt, update the parent invoice's payment tracking
  if (session.documentType === 'receipt') {
    if (isMultiInvoice && parentInvoices.length > 0) {
      // Multi-invoice receipt: update all parent invoices atomically
      await updateMultipleInvoicesPayment(chatId, parentInvoices, invoiceNumber);
      log.info(
        {
          parentInvoiceCount: parentInvoices.length,
          parentInvoiceNumbers: parentInvoices.map((inv) => inv.invoiceNumber),
          receiptAmount: session.amount,
        },
        'Updated multiple parent invoices payment tracking'
      );
    } else if (session.relatedInvoiceNumber) {
      // Single-invoice receipt (legacy flow)
      await updateParentInvoicePayment(
        chatId,
        session.relatedInvoiceNumber,
        invoiceNumber,
        session.amount
      );
      log.info(
        { parentInvoice: session.relatedInvoiceNumber, receiptAmount: session.amount },
        'Updated parent invoice payment tracking'
      );
    }
  }

  // Log to Google Sheets (pass sheetId from already-loaded config to avoid duplicate Firestore read)
  await appendGeneratedInvoiceRow(
    chatId,
    {
      invoice_number: invoiceNumber,
      document_type: getDocumentTypeLabel(invoiceData.documentType),
      date: formatDateDisplay(invoiceData.date),
      customer_name: invoiceData.customerName,
      customer_tax_id: invoiceData.customerTaxId || '',
      description: invoiceData.description,
      amount: invoiceData.amount,
      payment_method: invoiceData.paymentMethod || '',
      generated_by: username,
      generated_at: new Date().toISOString(),
      pdf_link: pdfUrl,
      // New columns (L-M) - appended at end for backward compatibility
      currency: invoiceData.currency || 'ILS',
      related_invoice: getRelatedInvoice(invoiceData.documentType, session),
    },
    config.business.sheetId // Pass sheetId from already-loaded config (avoids duplicate Firestore read)
  );
  log.info('Invoice logged to customer Google Sheet');

  return {
    invoiceNumber,
    pdfUrl,
    pdfBuffer,
  };
}

/**
 * Upload PDF to Cloud Storage with per-customer path isolation
 * Path format: {chatId}/{year}/{invoiceNumber}.pdf
 */
async function uploadPDF(
  chatId: number,
  invoiceNumber: string,
  pdfBuffer: Buffer
): Promise<string> {
  const config = getConfig();
  const bucketName = config.generatedInvoicesBucket;
  const gcs = getStorage();
  const bucket = gcs.bucket(bucketName);

  const year = new Date().getFullYear();
  const filePath = `${chatId}/${year}/${invoiceNumber}.pdf`;
  const file = bucket.file(filePath);

  await file.save(pdfBuffer, {
    contentType: 'application/pdf',
    metadata: {
      chatId: chatId.toString(),
      invoiceNumber,
      generatedAt: new Date().toISOString(),
    },
  });

  // Note: Bucket has uniform bucket-level access with public read enabled via Terraform

  return `https://storage.googleapis.com/${bucketName}/${filePath}`;
}

/**
 * Save invoice record to Firestore for audit trail with per-customer document ID
 * Document ID format: chat_{chatId}_{invoiceNumber}
 */
async function saveInvoiceRecord(
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

  // Detect multi-invoice receipt
  const isMultiInvoiceReceipt =
    data.documentType === 'receipt' &&
    session?.selectedInvoiceNumbers &&
    session.selectedInvoiceNumbers.length > 1;

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
    // Multi-invoice receipt fields
    ...(isMultiInvoiceReceipt && {
      isMultiInvoiceReceipt: true,
      relatedInvoiceNumbers: session.selectedInvoiceNumbers,
      relatedInvoiceIds: session.selectedInvoiceNumbers?.map((num) => `chat_${chatId}_${num}`),
      // Set single fields for backward compatibility (use first invoice)
      relatedInvoiceId: `chat_${chatId}_${session.selectedInvoiceNumbers![0]}`,
      relatedInvoiceNumber: session.selectedInvoiceNumbers![0],
    }),
    // Single-invoice receipt fields (legacy)
    ...(!isMultiInvoiceReceipt &&
      data.documentType === 'receipt' &&
      session?.relatedInvoiceNumber && {
        relatedInvoiceId: `chat_${chatId}_${session.relatedInvoiceNumber}`,
        relatedInvoiceNumber: session.relatedInvoiceNumber,
      }),
  };

  await docRef.set(record);
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
 * Update parent invoice payment tracking after receipt creation
 * @param chatId - Customer's Telegram chat ID
 * @param parentInvoiceNumber - Parent invoice number to update
 * @param receiptNumber - Receipt number to add to relatedReceiptIds
 * @param paymentAmount - Amount paid in this receipt
 */
async function updateParentInvoicePayment(
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
    const currentRemaining = invoice.remainingBalance || invoice.amount;

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
 * Update multiple parent invoices atomically for multi-invoice receipts
 * Pays each invoice's full remaining balance
 * @param chatId - Customer's Telegram chat ID
 * @param parentInvoices - Array of parent invoices to update
 * @param receiptNumber - Receipt number to add to relatedReceiptIds
 */
async function updateMultipleInvoicesPayment(
  chatId: number,
  parentInvoices: GeneratedInvoice[],
  receiptNumber: string
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
      const currentRemaining = currentInvoice.remainingBalance || currentInvoice.amount;

      if (currentRemaining <= 0) {
        log.error(
          { invoiceNumber: invoice.invoiceNumber, remainingBalance: currentRemaining },
          'Invoice already paid (race condition detected)'
        );
        throw new Error(`Invoice ${invoice.invoiceNumber} is already paid. Please try again.`);
      }
    }

    // Update all invoices to fully paid
    for (let i = 0; i < docs.length; i++) {
      const docRef = docRefs[i];
      const doc = docs[i];
      const invoice = doc.data() as GeneratedInvoice;

      const currentPaid = invoice.paidAmount || 0;
      const currentRemaining = invoice.remainingBalance || invoice.amount;

      const paymentAmount = currentRemaining; // Pay full remaining balance
      const newPaidAmount = currentPaid + paymentAmount;

      transaction.update(docRef, {
        paidAmount: newPaidAmount,
        remainingBalance: 0,
        paymentStatus: 'paid' as const,
        relatedReceiptIds: FieldValue.arrayUnion(receiptNumber),
        updatedAt: FieldValue.serverTimestamp(),
      });

      log.debug(
        {
          invoiceNumber: invoice.invoiceNumber,
          oldPaid: currentPaid,
          newPaid: newPaidAmount,
          oldRemaining: currentRemaining,
          paymentAmount,
        },
        'Invoice payment tracking updated in multi-invoice transaction'
      );
    }
  });

  log.info('All parent invoices updated atomically');
}

// Re-export sub-services
export * from './counter.service';
export * from './session.service';
export { generateInvoicePDFWithConfig } from './pdf.generator';
export { buildInvoiceHTML, escapeHtml } from './template';

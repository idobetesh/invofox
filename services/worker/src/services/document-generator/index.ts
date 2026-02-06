/**
 * Invoice Generator service
 * Main orchestrator for invoice generation flow
 */

import { Storage } from '@google-cloud/storage';
import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import type {
  InvoiceData,
  BusinessConfig,
  GeneratedInvoice,
  InvoiceSession,
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
import logger from '../../logger';
import { getConfig } from '../../config';

let storage: Storage | null = null;
let firestore: Firestore | null = null;

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

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

  // Step 2: Load config first (needed for logoUrl)
  const config = await loadBusinessConfig(chatId);

  // Step 3: Fetch logo and document number
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
    paymentMethod: session.paymentMethod,
    date: session.date,
  };

  // Generate PDF
  const pdfBuffer = await generateInvoicePDFWithConfig(invoiceData, config, logoBase64);
  log.info({ pdfSize: pdfBuffer.length }, 'PDF generated');

  // Upload to Cloud Storage (per-customer path)
  const pdfUrl = await uploadPDF(chatId, invoiceNumber, pdfBuffer);
  log.info({ pdfUrl }, 'PDF uploaded to storage');

  // Save to Firestore audit log
  await saveInvoiceRecord(invoiceNumber, invoiceData, userId, username, chatId, pdfUrl);
  log.info('Invoice record saved to Firestore');

  // Log to Google Sheets (pass sheetId from already-loaded config to avoid duplicate Firestore read)
  await appendGeneratedInvoiceRow(
    chatId,
    {
      invoice_number: invoiceNumber,
      document_type: invoiceData.documentType === 'invoice' ? 'חשבונית' : 'חשבונית-קבלה',
      date: formatDateDisplay(invoiceData.date),
      customer_name: invoiceData.customerName,
      customer_tax_id: invoiceData.customerTaxId || '',
      description: invoiceData.description,
      amount: invoiceData.amount,
      payment_method: invoiceData.paymentMethod || '',
      generated_by: username,
      generated_at: new Date().toISOString(),
      pdf_link: pdfUrl,
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
  storageUrl: string
): Promise<void> {
  const db = getFirestore();
  const docId = `chat_${chatId}_${invoiceNumber}`;
  const collectionName = getCollectionForDocumentType(data.documentType);
  const docRef = db.collection(collectionName).doc(docId);

  const record: GeneratedInvoice = {
    chatId,
    invoiceNumber,
    documentType: data.documentType,
    customerName: data.customerName,
    ...(data.customerTaxId !== undefined && { customerTaxId: data.customerTaxId }),
    description: data.description,
    amount: data.amount,
    currency: 'ILS',
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

// Re-export sub-services
export * from './counter.service';
export * from './session.service';
export { generateInvoicePDFWithConfig } from './pdf.generator';
export { buildInvoiceHTML, escapeHtml } from './template';

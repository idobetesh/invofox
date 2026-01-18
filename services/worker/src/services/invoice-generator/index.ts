/**
 * Invoice Generator service
 * Main orchestrator for invoice generation flow
 */

import { Storage } from '@google-cloud/storage';
import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import * as fs from 'fs';
import * as path from 'path';
import type {
  InvoiceData,
  BusinessConfig,
  GeneratedInvoice,
  InvoiceSession,
} from '../../../../../shared/types';
import { generateInvoicePDFWithConfig } from './pdf.generator';
import { getNextInvoiceNumber } from './counter.service';
import { getBusinessConfig, getLogoBase64 } from './config.service';
import { appendGeneratedInvoiceRow } from '../sheets.service';
import logger from '../../logger';
import { getConfig } from '../../config';

const GENERATED_INVOICES_COLLECTION = 'generated_invoices';

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
  try {
    // Try Firestore first (production)
    const config = await getBusinessConfig(chatId);
    logger.info({ chatId }, 'Loaded business config from Firestore');
    return config;
  } catch {
    // Fall back to local file (development)
    logger.debug('Firestore unavailable, trying local config files');
  }

  const configPath = path.resolve(__dirname, '../../../../invoice-config.json');
  const exampleConfigPath = path.resolve(__dirname, '../../../../invoice-config.example.json');

  try {
    // Try to load actual config first
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent) as BusinessConfig;
      logger.info('Loaded invoice config from invoice-config.json');
      return config;
    } else if (fs.existsSync(exampleConfigPath)) {
      // Fall back to example config (for development/testing)
      const configContent = fs.readFileSync(exampleConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as BusinessConfig;
      logger.warn('Using example invoice config - create invoice-config.json for production');
      return config;
    } else {
      throw new Error('No invoice config file found');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to load business config');
    throw new Error(
      `Failed to load invoice config: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
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

  // Load business config (by chat ID for multi-customer support)
  const config = await loadBusinessConfig(chatId);
  log.debug({ businessName: config.business.name }, 'Loaded business config');

  // Load logo (by chat ID for multi-customer support)
  const logoBase64 = await getLogoBase64(chatId);
  log.debug({ hasLogo: !!logoBase64 }, 'Loaded logo');

  // Get next invoice number (atomic, per-customer)
  const invoiceNumber = await getNextInvoiceNumber(chatId);
  log.info({ invoiceNumber }, 'Got invoice number for customer');

  // Validate required session fields
  if (
    !session.documentType ||
    !session.customerName ||
    !session.description ||
    session.amount === undefined ||
    !session.paymentMethod ||
    !session.date
  ) {
    throw new Error('Invoice session is incomplete - missing required fields');
  }

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

  // Log to Google Sheets (fields already validated above)
  await appendGeneratedInvoiceRow({
    invoice_number: invoiceNumber,
    document_type: invoiceData.documentType === 'invoice' ? 'חשבונית' : 'חשבונית-קבלה',
    date: formatDateDisplay(invoiceData.date),
    customer_name: invoiceData.customerName,
    customer_tax_id: invoiceData.customerTaxId || '',
    description: invoiceData.description,
    amount: invoiceData.amount,
    payment_method: invoiceData.paymentMethod,
    generated_by: username,
    generated_at: new Date().toISOString(),
    pdf_link: pdfUrl,
  });
  log.info('Invoice logged to Sheets');

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
  const docRef = db.collection(GENERATED_INVOICES_COLLECTION).doc(docId);

  const record: GeneratedInvoice = {
    invoiceNumber,
    documentType: data.documentType,
    customerName: data.customerName,
    ...(data.customerTaxId !== undefined && { customerTaxId: data.customerTaxId }),
    description: data.description,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
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
 * Get generated invoice by customer and number (for lookup)
 * @param chatId - Customer's Telegram chat ID
 * @param invoiceNumber - Invoice number to look up
 */
export async function getGeneratedInvoice(
  chatId: number,
  invoiceNumber: string
): Promise<GeneratedInvoice | null> {
  const db = getFirestore();
  const docId = `chat_${chatId}_${invoiceNumber}`;
  const docRef = db.collection(GENERATED_INVOICES_COLLECTION).doc(docId);

  const doc = await docRef.get();
  return doc.exists ? (doc.data() as GeneratedInvoice) : null;
}

// Re-export sub-services
export * from './counter.service';
export * from './session.service';
export { generateInvoicePDF } from './pdf.generator';
export { buildInvoiceHTML, escapeHtml } from './template';

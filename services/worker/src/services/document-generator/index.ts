/**
 * Invoice Generator service
 * Main orchestrator for invoice generation flow
 */

import type {
  InvoiceData,
  BusinessConfig,
  GeneratedInvoice,
  InvoiceSession,
} from '../../../../../shared/types';
import { generateInvoicePDFWithConfig } from './pdf.generator';
import { getNextDocumentNumber } from './counter.service';
import { getBusinessConfig, getLogoBase64 } from '../business-config/config.service';
import { appendGeneratedInvoiceRow } from '../sheets.service';
import { getRelatedInvoice } from './invoice-sheet-helpers';
import { getDocumentTypeLabel } from './messages.service';
import {
  validateSessionFields,
  validateParentInvoices,
  validatePaymentAmount,
} from './invoice-validator.service';
import {
  saveInvoiceRecord,
  updateParentInvoicePayment,
  updateMultipleInvoicesPayment,
} from './invoice-store.service';
import logger from '../../logger';
import { getConfig } from '../../config';
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

  // Step 1: Validate required session fields and document type
  validateSessionFields(session);

  // Step 2: For receipts, validate and fetch parent invoice data
  let parentInvoices: GeneratedInvoice[] = [];
  if (session.documentType === 'receipt') {
    parentInvoices = await validateParentInvoices(chatId, session);
    validatePaymentAmount(session.amount!, parentInvoices);
    log.debug(
      {
        invoiceCount: parentInvoices.length,
        totalAmount: parentInvoices.reduce(
          (sum, inv) => sum + (inv.remainingBalance ?? inv.amount),
          0
        ),
      },
      'Parent invoices validated'
    );
  }

  // Step 3: Load config first (needed for logoUrl)
  const config = await loadBusinessConfig(chatId);

  // Step 4: Fetch logo and document number in parallel
  const [logoBase64, invoiceNumber] = await Promise.all([
    getLogoBase64(chatId, config.business.logoUrl),
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

  // Step 5: Build invoice data (fields guaranteed non-null by validateSessionFields)
  const invoiceData: InvoiceData = {
    invoiceNumber,
    documentType: session.documentType!,
    customerName: session.customerName!,
    customerTaxId: session.customerTaxId,
    description: session.description!,
    amount: session.amount!,
    currency: session.currency || 'ILS',
    paymentMethod: session.paymentMethod,
    date: session.date!,
  };

  // Step 6: Generate PDF
  const parentInvoice = parentInvoices[0] ?? null;
  const pdfBuffer = await generateInvoicePDFWithConfig(
    invoiceData,
    config,
    logoBase64,
    session,
    parentInvoice,
    parentInvoices.length > 0 ? parentInvoices : undefined
  );
  log.info({ pdfSize: pdfBuffer.length }, 'PDF generated');

  // Step 7: Upload to Cloud Storage
  const pdfUrl = await uploadPDF(chatId, invoiceNumber, pdfBuffer);
  log.info({ pdfUrl }, 'PDF uploaded to storage');

  // Step 8: Save to Firestore audit log
  await saveInvoiceRecord(invoiceNumber, invoiceData, userId, username, chatId, pdfUrl, session);
  log.info('Invoice record saved to Firestore');

  // Step 9: If receipt, update parent invoice payment tracking
  if (session.documentType === 'receipt') {
    if (parentInvoices.length > 0) {
      await updateMultipleInvoicesPayment(chatId, parentInvoices, invoiceNumber, session.amount!);
      log.info(
        {
          parentInvoiceCount: parentInvoices.length,
          parentInvoiceNumbers: parentInvoices.map((inv) => inv.invoiceNumber),
          receiptAmount: session.amount,
        },
        parentInvoices.length === 1
          ? 'Updated parent invoice payment tracking'
          : 'Updated multiple parent invoices payment tracking'
      );
    } else if (session.relatedInvoiceNumber) {
      // LEGACY: Old receipts with relatedInvoiceNumber (backward compatibility only)
      await updateParentInvoicePayment(
        chatId,
        session.relatedInvoiceNumber,
        invoiceNumber,
        session.amount!
      );
      log.info(
        { parentInvoice: session.relatedInvoiceNumber, receiptAmount: session.amount },
        'Updated parent invoice payment tracking'
      );
    }
  }

  // Step 10: Log to Google Sheets
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
      currency: invoiceData.currency || 'ILS',
      related_invoice: getRelatedInvoice(invoiceData.documentType, session),
    },
    config.business.sheetId
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

// Re-export sub-services
export * from './counter.service';
export * from './session.service';
export { generateInvoicePDFWithConfig } from './pdf.generator';
export { buildInvoiceHTML, escapeHtml } from './template';
export { getGeneratedInvoice } from './invoice-store.service';

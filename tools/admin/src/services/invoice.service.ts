/**
 * Invoice Generation Service
 * Handles invoice generation with atomic transactions
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { CounterService } from './counter.service';
import { InvoicePDFService } from './invoice-pdf.service';
import { getBusinessConfig, uploadPDFToStorage, formatDateDisplay } from './document-helpers';
import { GENERATED_INVOICES_COLLECTION } from '../../../../shared/collections';
import { getFirestore, getStorage } from './store.service';

interface GenerateInvoiceParams {
  chatId: number;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD format
  paymentMethod?: string;
}

interface GenerateInvoiceResult {
  success: true;
  invoiceNumber: string;
  invoiceId: string;
  pdfUrl: string;
}

export class InvoiceService {
  private firestore: Firestore;
  private storage: Storage;
  private counterService: CounterService;
  private pdfService: InvoicePDFService;

  constructor() {
    this.firestore = getFirestore();
    this.storage = getStorage();
    this.counterService = new CounterService(this.firestore);
    this.pdfService = new InvoicePDFService();
  }

  /**
   * Generate a new invoice
   */
  async generateInvoice(params: GenerateInvoiceParams): Promise<GenerateInvoiceResult> {
    // Validate input
    if (!params.chatId) {
      throw new Error('chatId is required');
    }
    if (!params.customerName) {
      throw new Error('customerName is required');
    }
    if (!params.amount || params.amount <= 0) {
      throw new Error('amount must be greater than 0');
    }
    if (!params.date) {
      throw new Error('date is required');
    }

    // Get next invoice number
    const invoiceNumber = await this.counterService.getNextDocumentNumber(params.chatId, 'invoice');
    const invoiceId = `chat_${params.chatId}_${invoiceNumber}`;

    // Create invoice document
    const invoiceData = {
      chatId: params.chatId,
      invoiceNumber,
      documentType: 'invoice',
      customerName: params.customerName,
      ...(params.customerTaxId && { customerTaxId: params.customerTaxId }),
      description: params.description,
      amount: params.amount,
      currency: params.currency || 'ILS',
      date: formatDateDisplay(params.date),
      paymentMethod: params.paymentMethod || '',
      paymentStatus: 'unpaid' as const,
      paidAmount: 0,
      remainingBalance: params.amount,
      relatedReceiptIds: [],
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: {
        telegramUserId: 0, // Admin generated
        username: 'admin-panel',
        chatId: params.chatId,
      },
      storagePath: `${params.chatId}/${new Date().getFullYear()}/${invoiceNumber}.pdf`,
      storageUrl: '', // Will be updated after PDF generation
    };

    // Save to Firestore
    await this.firestore.collection(GENERATED_INVOICES_COLLECTION).doc(invoiceId).set(invoiceData);

    // Get business config for PDF generation
    const businessConfig = await getBusinessConfig(this.firestore, params.chatId);

    // Generate PDF
    console.log('Generating PDF for invoice:', invoiceNumber);
    const pdfBuffer = await this.pdfService.generateInvoicePDF({
      invoiceNumber,
      customerName: params.customerName,
      customerTaxId: params.customerTaxId,
      description: params.description,
      amount: params.amount,
      currency: params.currency || 'ILS',
      date: formatDateDisplay(params.date),
      businessName: businessConfig.name,
      businessTaxId: businessConfig.taxId,
      businessTaxStatus: businessConfig.taxStatus,
      businessEmail: businessConfig.email,
      businessAddress: businessConfig.address,
      businessPhone: businessConfig.phone,
      logoUrl: businessConfig.logoUrl,
    });

    // Upload PDF to Cloud Storage
    const pdfUrl = await uploadPDFToStorage(this.storage, pdfBuffer, invoiceData.storagePath, {
      chatId: params.chatId,
      documentNumber: invoiceNumber,
      documentType: 'invoice',
    });

    // Update invoice with PDF URL
    await this.firestore
      .collection(GENERATED_INVOICES_COLLECTION)
      .doc(invoiceId)
      .update({ storageUrl: pdfUrl });

    console.log('Invoice PDF generated successfully:', pdfUrl);

    return {
      success: true,
      invoiceNumber,
      invoiceId,
      pdfUrl,
    };
  }
}

/**
 * Invoice-Receipt Generation Service
 * Handles invoice-receipt generation (invoice + immediate payment confirmation)
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { CounterService } from './counter.service';
import { InvoiceReceiptPDFService } from './invoice-receipt-pdf.service';
import { getBusinessConfig, uploadPDFToStorage, formatDateDisplay } from './document-helpers';
import { GENERATED_INVOICE_RECEIPTS_COLLECTION } from '../../../../shared/collections';
import { getFirestore, getStorage } from './store.service';

interface GenerateInvoiceReceiptParams {
  chatId: number;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD format
  paymentMethod: string;
}

interface GenerateInvoiceReceiptResult {
  success: true;
  invoiceReceiptNumber: string;
  invoiceReceiptId: string;
  pdfUrl: string;
}

export class InvoiceReceiptService {
  private firestore: Firestore;
  private storage: Storage;
  private counterService: CounterService;
  private pdfService: InvoiceReceiptPDFService;

  constructor() {
    this.firestore = getFirestore();
    this.storage = getStorage();
    this.counterService = new CounterService(this.firestore);
    this.pdfService = new InvoiceReceiptPDFService();
  }

  /**
   * Generate a new invoice-receipt (invoice with immediate payment)
   */
  async generateInvoiceReceipt(
    params: GenerateInvoiceReceiptParams
  ): Promise<GenerateInvoiceReceiptResult> {
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
    if (!params.paymentMethod) {
      throw new Error('paymentMethod is required for invoice-receipt');
    }

    // Get next invoice-receipt number
    const invoiceReceiptNumber = await this.counterService.getNextDocumentNumber(
      params.chatId,
      'invoice_receipt'
    );
    const invoiceReceiptId = `chat_${params.chatId}_${invoiceReceiptNumber}`;

    // Create invoice-receipt document (paid immediately)
    const invoiceReceiptData = {
      chatId: params.chatId,
      invoiceNumber: invoiceReceiptNumber,
      documentType: 'invoice_receipt',
      customerName: params.customerName,
      ...(params.customerTaxId && { customerTaxId: params.customerTaxId }),
      description: params.description,
      amount: params.amount,
      currency: params.currency || 'ILS',
      date: formatDateDisplay(params.date),
      paymentMethod: params.paymentMethod,
      paymentStatus: 'paid' as const, // Invoice-receipt is always fully paid
      paidAmount: params.amount,
      remainingBalance: 0,
      relatedReceiptIds: [], // Invoice-receipt doesn't have separate receipts
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: {
        telegramUserId: 0, // Admin generated
        username: 'admin-panel',
        chatId: params.chatId,
      },
      storagePath: `${params.chatId}/${new Date().getFullYear()}/${invoiceReceiptNumber}.pdf`,
      storageUrl: '', // Will be updated after PDF generation
    };

    // Save to Firestore
    await this.firestore
      .collection(GENERATED_INVOICE_RECEIPTS_COLLECTION)
      .doc(invoiceReceiptId)
      .set(invoiceReceiptData);

    // Get business config for PDF generation
    const businessConfig = await getBusinessConfig(this.firestore, params.chatId);

    // Generate PDF
    console.log('Generating PDF for invoice-receipt:', invoiceReceiptNumber);
    const pdfBuffer = await this.pdfService.generateInvoiceReceiptPDF({
      invoiceReceiptNumber,
      customerName: params.customerName,
      customerTaxId: params.customerTaxId,
      description: params.description,
      amount: params.amount,
      currency: params.currency || 'ILS',
      date: formatDateDisplay(params.date),
      paymentMethod: params.paymentMethod,
      businessName: businessConfig.name,
      businessTaxId: businessConfig.taxId,
      businessTaxStatus: businessConfig.taxStatus,
      businessEmail: businessConfig.email,
      businessAddress: businessConfig.address,
      businessPhone: businessConfig.phone,
      logoUrl: businessConfig.logoUrl,
    });

    // Upload PDF to Cloud Storage
    const pdfUrl = await uploadPDFToStorage(
      this.storage,
      pdfBuffer,
      invoiceReceiptData.storagePath,
      {
        chatId: params.chatId,
        documentNumber: invoiceReceiptNumber,
        documentType: 'invoice_receipt',
      }
    );

    // Update invoice-receipt with PDF URL
    await this.firestore
      .collection(GENERATED_INVOICE_RECEIPTS_COLLECTION)
      .doc(invoiceReceiptId)
      .update({ storageUrl: pdfUrl });

    console.log('Invoice-receipt PDF generated successfully:', pdfUrl);

    return {
      success: true,
      invoiceReceiptNumber,
      invoiceReceiptId,
      pdfUrl,
    };
  }
}

/**
 * Receipt Generation Service
 * Handles receipt generation and invoice linking with atomic transactions
 */

import { Firestore, FieldValue, Transaction } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { CounterService } from './counter.service';
import { ReceiptPDFService } from './receipt-pdf.service';
import { getBusinessConfig, uploadPDFToStorage, formatDateDisplay } from './document-helpers';
import {
  GENERATED_INVOICES_COLLECTION,
  GENERATED_RECEIPTS_COLLECTION,
} from '../../../../shared/collections';
import type { PaymentStatus } from '../../../../shared/invoice.types';
import { getFirestoreClient, getStorageClient } from './gcp-clients.service';

interface InvoiceDocument {
  id: string;
  invoiceNumber: string;
  chatId: number;
  documentType: string;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  paymentMethod?: string;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  remainingBalance: number;
  relatedReceiptIds: string[];
  generatedAt: FirebaseFirestore.Timestamp | Date;
  generatedBy: { telegramUserId: number; username: string; chatId: number };
  storagePath: string;
  storageUrl: string;
}

interface GenerateReceiptParams {
  invoiceNumber: string;
  paymentAmount: number;
  paymentMethod: string;
  date: string; // YYYY-MM-DD format
  chatId?: number; // Optional: for validation
}

interface GenerateMultiInvoiceReceiptParams {
  invoiceNumbers: string[];
  paymentMethod: string;
  date: string; // YYYY-MM-DD format
  chatId?: number; // Optional: for validation
}

interface GenerateReceiptResult {
  success: true;
  receiptNumber: string;
  receiptId: string;
  pdfUrl: string;
  invoiceUpdated: {
    newPaidAmount: number;
    newRemainingBalance: number;
    newPaymentStatus: PaymentStatus;
  };
}

interface GenerateMultiInvoiceReceiptResult {
  success: true;
  receiptNumber: string;
  receiptId: string;
  pdfUrl: string;
  totalAmount: number;
  invoicesUpdated: {
    invoiceNumber: string;
    newPaidAmount: number;
    newRemainingBalance: number;
    newPaymentStatus: PaymentStatus;
  }[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  isPartialPayment: boolean;
  newPaidAmount: number;
  newRemainingBalance: number;
  newPaymentStatus: PaymentStatus;
}

export class ReceiptService {
  private firestore: Firestore;
  private storage: Storage;
  private counterService: CounterService;
  private pdfService: ReceiptPDFService;

  constructor() {
    this.firestore = getFirestoreClient();
    this.storage = getStorageClient();
    this.counterService = new CounterService(this.firestore);
    this.pdfService = new ReceiptPDFService();
  }

  /**
   * Generate receipt for an existing invoice
   * Performs atomic transaction to ensure data consistency
   */
  async generateReceiptForInvoice(params: GenerateReceiptParams): Promise<GenerateReceiptResult> {
    // ============================================================================
    // PHASE 1: VALIDATION (Read-only, can fail safely)
    // ============================================================================

    // Step 1: Find invoice by number
    const invoiceSnapshot = await this.firestore
      .collection(GENERATED_INVOICES_COLLECTION)
      .where('invoiceNumber', '==', params.invoiceNumber)
      .where('documentType', '==', 'invoice')
      .limit(1)
      .get();

    if (invoiceSnapshot.empty) {
      throw new Error(`Invoice ${params.invoiceNumber} not found`);
    }

    const invoiceDoc = invoiceSnapshot.docs[0];
    const invoice = invoiceDoc.data();
    const invoiceId = invoiceDoc.id;

    // Step 2: Validate chatId if provided
    if (params.chatId !== undefined && invoice.chatId !== params.chatId) {
      throw new Error(`Invoice ${params.invoiceNumber} does not belong to chatId ${params.chatId}`);
    }

    // Step 3: Validate invoice is actually an invoice
    if (invoice.documentType !== 'invoice') {
      throw new Error(
        `Document ${params.invoiceNumber} is not an invoice (type: ${invoice.documentType})`
      );
    }

    // Step 4: Validate payment amount
    const validation = this.validatePaymentAmount(
      params.paymentAmount,
      invoice.amount,
      invoice.paidAmount || 0
    );

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // ============================================================================
    // PHASE 2: GENERATION (Side effects, but safe to retry)
    // ============================================================================

    // Step 5: Get next receipt number for this customer
    const receiptNumber = await this.getNextReceiptNumber(invoice.chatId);

    // Step 6: Generate receipt document ID
    const receiptId = `chat_${invoice.chatId}_${receiptNumber}`;

    // NOTE: We're NOT generating the PDF yet because we want to ensure the
    // transaction succeeds first. We'll generate PDF after transaction commits.

    // ============================================================================
    // PHASE 3: ATOMIC TRANSACTION (All or nothing)
    // ============================================================================

    const result = await this.firestore.runTransaction(async (transaction: Transaction) => {
      // Re-read invoice in transaction to ensure we have latest data
      const invoiceRef = this.firestore.collection(GENERATED_INVOICES_COLLECTION).doc(invoiceId);
      const latestInvoiceDoc = await transaction.get(invoiceRef);

      if (!latestInvoiceDoc.exists) {
        throw new Error('Invoice was deleted during transaction');
      }

      const latestInvoice = latestInvoiceDoc.data();
      if (!latestInvoice) {
        throw new Error('Invoice data is invalid');
      }

      // Recalculate validation with latest data
      const latestValidation = this.validatePaymentAmount(
        params.paymentAmount,
        latestInvoice.amount,
        latestInvoice.paidAmount || 0
      );

      if (!latestValidation.valid) {
        throw new Error(`Payment validation failed in transaction: ${latestValidation.error}`);
      }

      // Create receipt document
      const receiptRef = this.firestore.collection(GENERATED_RECEIPTS_COLLECTION).doc(receiptId);

      const receiptData = {
        chatId: invoice.chatId,
        invoiceNumber: receiptNumber,
        documentType: 'receipt',
        customerName: invoice.customerName,
        customerTaxId: invoice.customerTaxId,
        description: `תשלום עבור חשבונית מספר ${params.invoiceNumber}`,
        amount: params.paymentAmount,
        currency: 'ILS',
        date: formatDateDisplay(params.date),
        paymentMethod: params.paymentMethod,
        relatedInvoiceId: invoiceId,
        relatedInvoiceNumber: params.invoiceNumber,
        isPartialPayment: latestValidation.isPartialPayment,
        remainingBalance: latestValidation.newRemainingBalance,
        generatedAt: FieldValue.serverTimestamp(),
        generatedBy: {
          telegramUserId: 0, // Admin generated
          username: 'admin-panel',
          chatId: invoice.chatId,
        },
        storagePath: `${invoice.chatId}/${new Date().getFullYear()}/${receiptNumber}.pdf`,
        storageUrl: '', // Will be updated after PDF generation
      };

      transaction.set(receiptRef, receiptData);

      // Update invoice document
      const currentReceiptIds = latestInvoice.relatedReceiptIds || [];
      transaction.update(invoiceRef, {
        paidAmount: latestValidation.newPaidAmount,
        remainingBalance: latestValidation.newRemainingBalance,
        paymentStatus: latestValidation.newPaymentStatus,
        relatedReceiptIds: [...currentReceiptIds, receiptId],
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        receiptNumber,
        receiptId,
        chatId: invoice.chatId,
        validation: latestValidation,
        receiptData,
      };
    });

    // ============================================================================
    // PHASE 4: POST-TRANSACTION (PDF generation and storage)
    // ============================================================================

    // Get business config for PDF generation
    const businessConfig = await getBusinessConfig(this.firestore, invoice.chatId);

    // Generate PDF
    console.log('Generating PDF for receipt:', result.receiptNumber);
    const pdfBuffer = await this.pdfService.generateReceiptPDF({
      receiptNumber: result.receiptNumber,
      invoiceNumber: params.invoiceNumber,
      invoiceDate: invoice.date,
      customerName: invoice.customerName,
      customerTaxId: invoice.customerTaxId,
      amount: params.paymentAmount,
      currency: invoice.currency || 'ILS', // Use invoice currency, default to ILS
      paymentMethod: params.paymentMethod,
      receiptDate: formatDateDisplay(params.date),
      isPartialPayment: result.validation.isPartialPayment,
      remainingBalance: result.validation.newRemainingBalance,
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
      result.receiptData.storagePath,
      {
        chatId: result.chatId,
        documentNumber: result.receiptNumber,
        documentType: 'receipt',
        relatedDocumentNumber: params.invoiceNumber,
      }
    );

    // Update receipt with PDF URL
    await this.firestore
      .collection(GENERATED_RECEIPTS_COLLECTION)
      .doc(result.receiptId)
      .update({ storageUrl: pdfUrl });

    console.log('Receipt PDF generated successfully:', pdfUrl);

    return {
      success: true,
      receiptNumber: result.receiptNumber,
      receiptId: result.receiptId,
      pdfUrl,
      invoiceUpdated: {
        newPaidAmount: result.validation.newPaidAmount,
        newRemainingBalance: result.validation.newRemainingBalance,
        newPaymentStatus: result.validation.newPaymentStatus,
      },
    };
  }

  /**
   * Generate a single receipt for multiple invoices
   * Pays each invoice's full remaining balance atomically
   */
  async generateMultiInvoiceReceipt(
    params: GenerateMultiInvoiceReceiptParams
  ): Promise<GenerateMultiInvoiceReceiptResult> {
    // ============================================================================
    // PHASE 1: VALIDATION (Read-only, can fail safely)
    // ============================================================================

    // Step 1: Validate input
    if (!params.invoiceNumbers || params.invoiceNumbers.length < 2) {
      throw new Error('Must select at least 2 invoices');
    }

    if (params.invoiceNumbers.length > 10) {
      throw new Error('Cannot select more than 10 invoices');
    }

    // Step 2: Fetch all invoices
    const invoices: InvoiceDocument[] = [];
    for (const invoiceNumber of params.invoiceNumbers) {
      const invoiceSnapshot = await this.firestore
        .collection(GENERATED_INVOICES_COLLECTION)
        .where('invoiceNumber', '==', invoiceNumber)
        .where('documentType', '==', 'invoice')
        .limit(1)
        .get();

      if (invoiceSnapshot.empty) {
        throw new Error(`Invoice ${invoiceNumber} not found`);
      }

      const invoiceDoc = invoiceSnapshot.docs[0];
      const invoice = invoiceDoc.data();
      const invoiceId = invoiceDoc.id;

      // Validate chatId if provided
      if (params.chatId !== undefined && invoice.chatId !== params.chatId) {
        throw new Error(`Invoice ${invoiceNumber} does not belong to chatId ${params.chatId}`);
      }

      invoices.push({
        id: invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        chatId: invoice.chatId,
        documentType: invoice.documentType,
        customerName: invoice.customerName,
        customerTaxId: invoice.customerTaxId,
        description: invoice.description,
        amount: invoice.amount,
        currency: invoice.currency || 'ILS',
        date: invoice.date,
        paymentMethod: invoice.paymentMethod,
        paymentStatus: invoice.paymentStatus || 'unpaid',
        paidAmount: invoice.paidAmount || 0,
        remainingBalance: invoice.remainingBalance || invoice.amount,
        relatedReceiptIds: invoice.relatedReceiptIds || [],
        generatedAt: invoice.generatedAt,
        generatedBy: invoice.generatedBy,
        storagePath: invoice.storagePath,
        storageUrl: invoice.storageUrl,
      });
    }

    // Step 3: Validate customer consistency
    const firstCustomer = invoices[0].customerName;
    const allSameCustomer = invoices.every((inv) => inv.customerName === firstCustomer);
    if (!allSameCustomer) {
      throw new Error('All invoices must belong to the same customer');
    }

    // Step 4: Validate all have remaining balance > 0
    const invalidInvoices = invoices.filter((inv) => inv.remainingBalance <= 0);
    if (invalidInvoices.length > 0) {
      throw new Error(
        `Invoices already paid: ${invalidInvoices.map((i) => i.invoiceNumber).join(', ')}`
      );
    }

    // ============================================================================
    // PHASE 2: GENERATION (Side effects, but safe to retry)
    // ============================================================================

    // Step 6: Get next receipt number for this customer
    const chatId = invoices[0].chatId;
    const receiptNumber = await this.getNextReceiptNumber(chatId);

    // Step 7: Generate receipt document ID
    const receiptId = `chat_${chatId}_${receiptNumber}`;

    // ============================================================================
    // PHASE 3: ATOMIC TRANSACTION (All or nothing)
    // ============================================================================

    const result = await this.firestore.runTransaction(async (transaction: Transaction) => {
      // Re-read all invoices in transaction to ensure we have latest data
      const invoiceRefs = invoices.map((inv) =>
        this.firestore.collection(GENERATED_INVOICES_COLLECTION).doc(inv.id)
      );

      const latestInvoiceDocs = await Promise.all(invoiceRefs.map((ref) => transaction.get(ref)));

      // Validate all invoices still exist and are not fully paid (race condition check)
      const latestInvoices: InvoiceDocument[] = [];
      for (let i = 0; i < latestInvoiceDocs.length; i++) {
        const doc = latestInvoiceDocs[i];
        if (!doc.exists) {
          throw new Error(`Invoice ${invoices[i].invoiceNumber} was deleted during transaction`);
        }

        const data = doc.data();
        if (!data) {
          throw new Error(`Invoice ${invoices[i].invoiceNumber} data is invalid`);
        }

        const currentRemaining = data.remainingBalance || data.amount;
        if (currentRemaining <= 0) {
          throw new Error(
            `Invoice ${invoices[i].invoiceNumber} is already paid (race condition detected)`
          );
        }

        latestInvoices.push({
          id: doc.id,
          invoiceNumber: data.invoiceNumber,
          chatId: data.chatId,
          documentType: data.documentType,
          customerName: data.customerName,
          customerTaxId: data.customerTaxId,
          description: data.description,
          amount: data.amount,
          currency: data.currency || 'ILS',
          date: data.date,
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentStatus || 'unpaid',
          paidAmount: data.paidAmount || 0,
          remainingBalance: currentRemaining,
          relatedReceiptIds: data.relatedReceiptIds || [],
          generatedAt: data.generatedAt,
          generatedBy: data.generatedBy,
          storagePath: data.storagePath,
          storageUrl: data.storageUrl,
        });
      }

      // Recalculate total with latest data
      const latestTotalAmount = latestInvoices.reduce((sum, inv) => sum + inv.remainingBalance, 0);

      // Create receipt document
      const receiptRef = this.firestore.collection(GENERATED_RECEIPTS_COLLECTION).doc(receiptId);

      const receiptData = {
        chatId,
        invoiceNumber: receiptNumber,
        documentType: 'receipt',
        customerName: firstCustomer,
        customerTaxId: latestInvoices[0].customerTaxId,
        description: `קבלה עבור חשבוניות: ${params.invoiceNumbers.join(', ')}`,
        amount: latestTotalAmount,
        currency: latestInvoices[0].currency,
        date: formatDateDisplay(params.date),
        paymentMethod: params.paymentMethod,
        // Multi-invoice receipt fields
        isMultiInvoiceReceipt: true,
        relatedInvoiceNumbers: params.invoiceNumbers,
        relatedInvoiceIds: latestInvoices.map((inv) => inv.id),
        // Single fields for backward compatibility (use first invoice)
        relatedInvoiceId: latestInvoices[0].id,
        relatedInvoiceNumber: params.invoiceNumbers[0],
        isPartialPayment: false, // Multi-invoice receipts always pay in full
        remainingBalance: 0,
        generatedAt: FieldValue.serverTimestamp(),
        generatedBy: {
          telegramUserId: 0, // Admin generated
          username: 'admin-panel',
          chatId,
        },
        storagePath: `${chatId}/${new Date().getFullYear()}/${receiptNumber}.pdf`,
        storageUrl: '', // Will be updated after PDF generation
      };

      transaction.set(receiptRef, receiptData);

      // Update all invoice documents to fully paid
      const invoiceUpdates: Array<{
        invoiceNumber: string;
        newPaidAmount: number;
        newRemainingBalance: number;
        newPaymentStatus: PaymentStatus;
      }> = [];

      for (let i = 0; i < latestInvoices.length; i++) {
        const invoice = latestInvoices[i];
        const invoiceRef = invoiceRefs[i];

        const paymentAmount = invoice.remainingBalance;
        const newPaidAmount = invoice.paidAmount + paymentAmount;

        const currentReceiptIds = invoice.relatedReceiptIds || [];
        transaction.update(invoiceRef, {
          paidAmount: newPaidAmount,
          remainingBalance: 0,
          paymentStatus: 'paid' as const,
          relatedReceiptIds: [...currentReceiptIds, receiptId],
          updatedAt: FieldValue.serverTimestamp(),
        });

        invoiceUpdates.push({
          invoiceNumber: invoice.invoiceNumber,
          newPaidAmount,
          newRemainingBalance: 0,
          newPaymentStatus: 'paid',
        });
      }

      return {
        receiptNumber,
        receiptId,
        chatId,
        totalAmount: latestTotalAmount,
        receiptData,
        invoiceUpdates,
        latestInvoices,
      };
    });

    // ============================================================================
    // PHASE 4: POST-TRANSACTION (PDF generation and storage)
    // ============================================================================

    // Get business config for PDF generation
    const businessConfig = await getBusinessConfig(this.firestore, result.chatId);

    // Generate PDF with multi-invoice support
    console.log('Generating multi-invoice PDF for receipt:', result.receiptNumber);
    const pdfBuffer = await this.pdfService.generateReceiptPDF({
      receiptNumber: result.receiptNumber,
      invoiceNumber: result.latestInvoices[0].invoiceNumber, // For backward compatibility
      invoiceDate: result.latestInvoices[0].date, // For backward compatibility
      customerName: firstCustomer,
      customerTaxId: result.latestInvoices[0].customerTaxId,
      amount: result.totalAmount,
      currency: result.latestInvoices[0].currency,
      paymentMethod: params.paymentMethod,
      receiptDate: formatDateDisplay(params.date),
      isPartialPayment: false,
      remainingBalance: 0,
      businessName: businessConfig.name,
      businessTaxId: businessConfig.taxId,
      businessTaxStatus: businessConfig.taxStatus,
      businessEmail: businessConfig.email,
      businessAddress: businessConfig.address,
      businessPhone: businessConfig.phone,
      logoUrl: businessConfig.logoUrl,
      // Multi-invoice specific fields
      isMultiInvoiceReceipt: true,
      relatedInvoiceNumbers: params.invoiceNumbers,
      relatedInvoiceDates: result.latestInvoices.map((inv) => inv.date),
    });

    // Upload PDF to Cloud Storage
    const pdfUrl = await uploadPDFToStorage(
      this.storage,
      pdfBuffer,
      result.receiptData.storagePath,
      {
        chatId: result.chatId,
        documentNumber: result.receiptNumber,
        documentType: 'receipt',
        relatedDocumentNumber: params.invoiceNumbers.join(','),
      }
    );

    // Update receipt with PDF URL
    await this.firestore
      .collection(GENERATED_RECEIPTS_COLLECTION)
      .doc(result.receiptId)
      .update({ storageUrl: pdfUrl });

    console.log('Multi-invoice receipt PDF generated successfully:', pdfUrl);

    return {
      success: true,
      receiptNumber: result.receiptNumber,
      receiptId: result.receiptId,
      pdfUrl,
      totalAmount: result.totalAmount,
      invoicesUpdated: result.invoiceUpdates,
    };
  }

  /**
   * Validate payment amount against invoice balance
   */
  private validatePaymentAmount(
    paymentAmount: number,
    totalAmount: number,
    paidAmount: number
  ): ValidationResult {
    if (paymentAmount <= 0) {
      return {
        valid: false,
        error: 'Payment amount must be greater than 0',
        isPartialPayment: false,
        newPaidAmount: 0,
        newRemainingBalance: 0,
        newPaymentStatus: 'unpaid',
      };
    }

    const remainingBalance = totalAmount - paidAmount;

    if (remainingBalance <= 0) {
      return {
        valid: false,
        error: `Invoice is already fully paid (paid: ₪${paidAmount}, total: ₪${totalAmount})`,
        isPartialPayment: false,
        newPaidAmount: paidAmount,
        newRemainingBalance: 0,
        newPaymentStatus: 'paid',
      };
    }

    if (paymentAmount > remainingBalance) {
      return {
        valid: false,
        error: `Payment amount (₪${paymentAmount}) exceeds remaining balance (₪${remainingBalance})`,
        isPartialPayment: false,
        newPaidAmount: paidAmount,
        newRemainingBalance: remainingBalance,
        newPaymentStatus: paidAmount > 0 ? 'partial' : 'unpaid',
      };
    }

    const newPaidAmount = paidAmount + paymentAmount;
    const newRemainingBalance = totalAmount - newPaidAmount;
    const isPartialPayment = newRemainingBalance > 0;
    const newPaymentStatus = isPartialPayment ? 'partial' : 'paid';

    return {
      valid: true,
      isPartialPayment,
      newPaidAmount,
      newRemainingBalance,
      newPaymentStatus,
    };
  }

  /**
   * Get next receipt number for a customer
   * Delegates to CounterService which handles both legacy and new formats
   */
  private async getNextReceiptNumber(chatId: number): Promise<string> {
    return this.counterService.getNextDocumentNumber(chatId, 'receipt');
  }

  /**
   * Get invoice by number (for preview/validation)
   */
  async getInvoiceByNumber(
    invoiceNumber: string,
    chatId?: number
  ): Promise<InvoiceDocument | null> {
    let query = this.firestore
      .collection(GENERATED_INVOICES_COLLECTION)
      .where('invoiceNumber', '==', invoiceNumber)
      .where('documentType', '==', 'invoice')
      .limit(1);

    if (chatId !== undefined) {
      query = query.where('chatId', '==', chatId);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    return {
      id: doc.id,
      invoiceNumber: data.invoiceNumber,
      chatId: data.chatId,
      documentType: data.documentType,
      customerName: data.customerName,
      customerTaxId: data.customerTaxId,
      description: data.description,
      amount: data.amount,
      currency: data.currency || 'ILS',
      date: data.date,
      paymentMethod: data.paymentMethod,
      paymentStatus: data.paymentStatus || 'unpaid',
      paidAmount: data.paidAmount || 0,
      remainingBalance: data.remainingBalance || data.amount,
      relatedReceiptIds: data.relatedReceiptIds || [],
      generatedAt: data.generatedAt,
      generatedBy: data.generatedBy,
      storagePath: data.storagePath,
      storageUrl: data.storageUrl,
    };
  }
}

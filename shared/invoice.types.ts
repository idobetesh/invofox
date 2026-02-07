/**
 * Invoice Generation Types
 * Type definitions for generating and managing invoices
 */

/**
 * Invoice document types
 * - invoice: חשבונית (invoice only, payment pending)
 * - invoice_receipt: חשבונית-קבלה (invoice + receipt, payment received)
 * - receipt: קבלה (receipt for existing invoice)
 */
export type InvoiceDocumentType = 'invoice' | 'invoice_receipt' | 'receipt';

/**
 * Invoice generation session status
 */
export type InvoiceSessionStatus =
  | 'select_type' // Waiting for user to select document type
  | 'awaiting_invoice_selection' // Waiting for user to select existing invoice (receipt flow)
  | 'awaiting_details' // Waiting for customer name, amount, description
  | 'awaiting_payment' // Waiting for payment method selection
  | 'confirming'; // Showing confirmation, waiting for approve/cancel

/**
 * Payment methods (Hebrew)
 */
export type PaymentMethod = 'מזומן' | 'ביט' | 'PayBox' | 'העברה' | 'אשראי' | 'צ׳ק';

/**
 * Payment status for invoice tracking
 */
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

/**
 * Invoice generation session stored in Firestore
 * Document ID: `${chatId}_${userId}`
 */
export interface InvoiceSession {
  status: InvoiceSessionStatus;
  documentType?: InvoiceDocumentType;
  relatedInvoiceNumber?: string; // For receipt type: link to existing invoice
  customerName?: string;
  customerTaxId?: string;
  description?: string;
  amount?: number;
  currency?: string; // Currency code (e.g., "ILS", "USD"), defaults to "ILS"
  paymentMethod?: PaymentMethod;
  date?: string; // YYYY-MM-DD format
  createdAt: Date | { toMillis: () => number };
  updatedAt: Date | { toMillis: () => number };
}

/**
 * Generated invoice audit log stored in Firestore
 * Document ID: invoice number (e.g., "20261")
 * Also used for receipts (documentType='receipt')
 */
export interface GeneratedInvoice {
  chatId: number; // Chat ID for querying invoices by user
  invoiceNumber: string;
  documentType: InvoiceDocumentType | 'receipt';
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency: string; // Currency code (e.g., "ILS", "USD")
  paymentMethod?: PaymentMethod; // Optional for invoices (not yet paid)
  date: string; // DD/MM/YYYY format
  generatedAt: Date | { toMillis: () => number };
  generatedBy: {
    telegramUserId: number;
    username: string;
    chatId: number;
  };
  storagePath: string;
  storageUrl: string;

  // Invoice-specific fields (for tracking payments)
  paymentStatus?: PaymentStatus;
  paidAmount?: number;
  remainingBalance?: number;
  relatedReceiptIds?: string[]; // Receipt doc IDs linked to this invoice

  // Receipt-specific fields (for linking back to invoice)
  relatedInvoiceId?: string; // Invoice doc ID this receipt is for
  relatedInvoiceNumber?: string; // Invoice number (e.g., "20262")
  isPartialPayment?: boolean; // Is this a partial payment
}

/**
 * Document type counter
 */
export interface DocumentCounter {
  counter: number;
  lastUpdated: Date | { toMillis: () => number };
}

/**
 * Invoice counters stored in Firestore
 * Document ID: chat_{chatId}_{year} (e.g., "chat_749278151_2026")
 * Supports 3 document types with independent counters
 */
export interface InvoiceCounter {
  invoice: DocumentCounter;
  receipt: DocumentCounter;
  invoice_receipt: DocumentCounter;
}

/**
 * Legacy invoice counter format (for migration)
 * @deprecated Use InvoiceCounter instead
 */
export interface LegacyInvoiceCounter {
  counter: number;
  lastUpdated: Date | { toMillis: () => number };
}

/**
 * Data required to generate an invoice PDF
 */
export interface InvoiceData {
  invoiceNumber: string;
  documentType: InvoiceDocumentType;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency?: string; // Currency code (e.g., "ILS", "USD"), defaults to "ILS"
  paymentMethod?: PaymentMethod; // Optional for invoices (not yet paid)
  date: string; // DD/MM/YYYY format
}

/**
 * Generated Invoices sheet row
 * Columns A-K are existing, L-M are new (appended at end for backward compatibility)
 */
export interface GeneratedInvoiceSheetRow {
  invoice_number: string;
  document_type: string;
  date: string;
  customer_name: string;
  customer_tax_id: string;
  description: string;
  amount: number;
  payment_method: string;
  generated_by: string;
  generated_at: string;
  pdf_link: string;
  // New columns (L-M) - appended at end to avoid breaking existing data
  currency: string; // Column L: "ILS" | "USD" | "EUR"
  related_invoice: string; // Column M: For receipts - parent invoice number
}

/**
 * Invoice callback action types
 */
export type InvoiceCallbackAction =
  | { action: 'select_type'; documentType: InvoiceDocumentType }
  | { action: 'select_invoice'; invoiceNumber: string }
  | { action: 'select_payment'; paymentMethod: PaymentMethod }
  | { action: 'show_more'; offset: number }
  | { action: 'confirm' }
  | { action: 'cancel' };

/**
 * Invoice Generation Types
 * Type definitions for generating and managing invoices
 */

/**
 * Invoice document types
 * - invoice: חשבונית (invoice only, payment pending)
 * - invoice_receipt: חשבונית-קבלה (invoice + receipt, payment received)
 */
export type InvoiceDocumentType = 'invoice' | 'invoice_receipt';

/**
 * Invoice generation session status
 */
export type InvoiceSessionStatus =
  | 'select_type' // Waiting for user to select document type
  | 'awaiting_details' // Waiting for customer name, amount, description
  | 'awaiting_payment' // Waiting for payment method selection
  | 'confirming'; // Showing confirmation, waiting for approve/cancel

/**
 * Payment methods (Hebrew)
 */
export type PaymentMethod = 'מזומן' | 'ביט' | 'PayBox' | 'העברה' | 'אשראי' | 'צ׳ק';

/**
 * Invoice generation session stored in Firestore
 * Document ID: `${chatId}_${userId}`
 */
export interface InvoiceSession {
  status: InvoiceSessionStatus;
  documentType?: InvoiceDocumentType;
  customerName?: string;
  customerTaxId?: string;
  description?: string;
  amount?: number;
  paymentMethod?: PaymentMethod;
  date?: string; // YYYY-MM-DD format
  createdAt: Date | { toMillis: () => number };
  updatedAt: Date | { toMillis: () => number };
}

/**
 * Generated invoice audit log stored in Firestore
 * Document ID: invoice number (e.g., "20261")
 */
export interface GeneratedInvoice {
  invoiceNumber: string;
  documentType: InvoiceDocumentType;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  date: string; // DD/MM/YYYY format
  generatedAt: Date | { toMillis: () => number };
  generatedBy: {
    telegramUserId: number;
    username: string;
    chatId: number;
  };
  storagePath: string;
  storageUrl: string;
}

/**
 * Invoice counter stored in Firestore
 * Document ID: year (e.g., "2026")
 */
export interface InvoiceCounter {
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
  paymentMethod: PaymentMethod;
  date: string; // DD/MM/YYYY format
}

/**
 * Generated Invoices sheet row
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
}

/**
 * Invoice callback action types
 */
export type InvoiceCallbackAction =
  | { action: 'select_type'; documentType: InvoiceDocumentType }
  | { action: 'select_payment'; paymentMethod: PaymentMethod }
  | { action: 'confirm' }
  | { action: 'cancel' };

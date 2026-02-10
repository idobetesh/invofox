/**
 * Report Types
 * Type definitions for report generation feature
 */

import type { InvoiceDocumentType } from './invoice.types';

export type ReportType = 'revenue' | 'expenses';
export type ReportFormat = 'pdf' | 'excel' | 'csv';
export type DatePreset = 'this_month' | 'last_month' | 'ytd';

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  preset?: DatePreset;
}

export interface ReportSession {
  sessionId: string;
  chatId: number;
  userId: number;
  status: 'active' | 'completed' | 'expired';
  currentStep: 'type' | 'date' | 'format' | 'generating';

  // User selections
  reportType?: ReportType;
  datePreset?: DatePreset;
  format?: ReportFormat;

  // Message tracking (for clean UI - delete intermediate messages)
  generatingMessageId?: number;

  // Metadata
  createdAt: Date | FirestoreTimestamp;
  updatedAt: Date | FirestoreTimestamp;
  expiresAt: Date | FirestoreTimestamp; // 30 minutes TTL
}

/**
 * Firestore Timestamp type (avoids importing @google-cloud/firestore in shared types)
 * This is compatible with Firestore's Timestamp type
 */
export interface FirestoreTimestamp {
  toDate(): Date;
  toMillis(): number;
}

export interface CurrencyMetrics {
  currency: string;

  // Invoiced metrics (all documents)
  totalInvoiced: number;
  invoicedCount: number;
  avgInvoiced: number;

  // Cash received metrics (receipts + invoice-receipts + paid/partial invoices)
  totalReceived: number;
  receivedCount: number;
  avgReceived: number;

  // Outstanding metrics (unpaid + partial invoices)
  totalOutstanding: number;
  outstandingCount: number;

  // Shared metrics
  maxInvoice: number;
  minInvoice: number;
}

export interface ReportMetrics {
  // === Invoiced Metrics (all documents) ===
  totalInvoiced: number;
  invoicedCount: number;
  avgInvoiced: number;

  // === Cash Received Metrics (receipts + invoice-receipts + paid/partial invoices) ===
  totalReceived: number;
  receivedCount: number;
  avgReceived: number;

  // === Outstanding Metrics (unpaid + partial invoices) ===
  totalOutstanding: number;
  outstandingCount: number;

  // === Shared Metrics ===
  maxInvoice: number;
  minInvoice: number;

  // === Multi-currency support ===
  currencies: CurrencyMetrics[];

  // === Payment method breakdown ===
  paymentMethods: Record<string, { count: number; total: number }>;

  // === Optional features ===
  // Top customers (optional)
  topCustomers?: Array<{ name: string; total: number; count: number }>;

  // Growth comparison
  previousPeriodRevenue?: number;
  growthPercentage?: number;
}

export interface InvoiceForReport {
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
  customerName: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  category?: string;
  driveLink: string;

  // Document type and payment tracking
  documentType: InvoiceDocumentType;
  paymentStatus: 'paid' | 'unpaid' | 'partial';

  // Partial payment tracking (for invoices with partial payments)
  paidAmount?: number; // Amount paid so far
  remainingBalance?: number; // Amount still owed

  // Receipt linking (to avoid double-counting)
  relatedInvoiceNumber?: string; // For receipts: parent invoice number
  isLinkedReceipt?: boolean; // True if this is a receipt linked to an invoice (skip in calculations)
}

export interface ReportData {
  businessName: string;
  logoUrl?: string;
  reportType: ReportType;
  dateRange: DateRange;
  generatedAt: string;
  metrics: ReportMetrics;
  invoices: InvoiceForReport[];
}

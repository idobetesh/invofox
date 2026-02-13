/**
 * Report Types
 * Type definitions for report generation feature
 */

import type { InvoiceDocumentType } from './invoice.types';

export type ReportType = 'revenue' | 'expenses' | 'balance';
export type ReportFormat = 'pdf' | 'excel' | 'csv';
export type DatePreset = 'this_month' | 'last_month' | 'ytd';

/**
 * Hebrew display names for report types
 */
export const REPORT_TYPE_NAMES: Record<ReportType, string> = {
  revenue: 'הכנסות',
  expenses: 'הוצאות',
  balance: 'מאזן',
} as const;

/**
 * Hebrew chart titles for report types
 */
export const REPORT_CHART_TITLES: Record<ReportType, string> = {
  revenue: 'מגמת הכנסות',
  expenses: 'מגמת הוצאות',
  balance: 'מגמת רווח',
} as const;

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

  // === Balance Report Specific Metrics ===
  revenueMetrics?: {
    totalInvoiced: number;
    totalReceived: number;
    totalOutstanding: number;
    invoicedCount: number;
    receivedCount: number;
    outstandingCount: number;
    avgInvoiced: number;
    currencies: CurrencyMetrics[];
  };

  expenseMetrics?: {
    totalExpenses: number;
    expenseCount: number;
    avgExpense: number;
    currencies: Array<{
      currency: string;
      totalExpenses: number;
      expenseCount: number;
      avgExpense: number;
    }>;
  };

  // Net calculations
  netInvoiced?: number; // revenue.totalInvoiced - expenses.totalExpenses
  netCashFlow?: number; // revenue.totalReceived - expenses.totalExpenses
  profit?: number; // revenue.totalReceived - expenses.totalExpenses
  profitMargin?: number; // (profit / revenue.totalReceived) * 100
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

  // Balance report tracking (only present in balance reports)
  reportSource?: 'revenue' | 'expenses'; // Whether this document is from revenue or expenses
}

/**
 * Extended invoice type for balance reports
 * Includes required reportSource to distinguish revenue from expenses
 */
export interface BalanceInvoiceForReport extends InvoiceForReport {
  reportSource: 'revenue' | 'expenses';
}

/**
 * Base report data structure with generic invoice type
 */
interface BaseReportData<TInvoice> {
  businessName: string;
  logoUrl?: string;
  dateRange: DateRange;
  generatedAt: string;
  metrics: ReportMetrics;
  invoices: TInvoice[];
}

/**
 * Report data with discriminated union based on report type
 * - Revenue/Expenses reports use InvoiceForReport[]
 * - Balance reports use BalanceInvoiceForReport[] (with required reportSource)
 */
export type ReportData =
  | (BaseReportData<InvoiceForReport> & {
      reportType: 'revenue' | 'expenses';
    })
  | (BaseReportData<BalanceInvoiceForReport> & {
      reportType: 'balance';
    });

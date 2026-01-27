/**
 * Report Types
 * Type definitions for report generation feature
 */

export type ReportType = 'revenue' | 'expenses';
export type ReportFormat = 'pdf' | 'excel' | 'csv';
export type DatePreset = 'this_month' | 'last_month' | 'ytd' | 'this_year';

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
  totalRevenue: number;
  invoiceCount: number;
  avgInvoice: number;
  maxInvoice: number;
  minInvoice: number;
}

export interface ReportMetrics {
  // Legacy fields for backward compatibility (will use primary currency)
  totalRevenue: number;
  invoiceCount: number;
  avgInvoice: number;
  maxInvoice: number;
  minInvoice: number;

  // Multi-currency support
  currencies: CurrencyMetrics[];

  // Payment method breakdown
  paymentMethods: Record<string, { count: number; total: number }>;

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

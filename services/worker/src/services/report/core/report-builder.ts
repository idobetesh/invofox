/**
 * Report Builder
 * Orchestrates report generation from data fetching to final report data
 */

import type {
  ReportData,
  DateRange,
  BalanceInvoiceForReport,
} from '../../../../../../shared/report.types';
import { getInvoicesForReport } from './data-fetcher';
import { calculateMetrics, calculateBalanceMetrics } from './metrics-calculator';

/**
 * Generate complete report data
 */
export async function generateReportData(
  chatId: number,
  dateRange: DateRange,
  businessName: string,
  reportType: 'revenue' | 'expenses' | 'balance' = 'revenue',
  logoUrl?: string
): Promise<ReportData> {
  if (reportType === 'balance') {
    // Query both revenue and expenses in parallel
    const [revenueInvoices, expenseInvoices] = await Promise.all([
      getInvoicesForReport(chatId, dateRange, 'revenue'),
      getInvoicesForReport(chatId, dateRange, 'expenses'),
    ]);

    // Tag invoices with their source (convert to BalanceInvoiceForReport)
    const taggedRevenueInvoices: BalanceInvoiceForReport[] = revenueInvoices.map((inv) => ({
      ...inv,
      reportSource: 'revenue' as const,
    }));
    const taggedExpenseInvoices: BalanceInvoiceForReport[] = expenseInvoices.map((inv) => ({
      ...inv,
      reportSource: 'expenses' as const,
    }));

    // Combine and sort by date descending (newest first)
    const allInvoices: BalanceInvoiceForReport[] = [
      ...taggedRevenueInvoices,
      ...taggedExpenseInvoices,
    ];
    allInvoices.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });

    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    return {
      businessName,
      logoUrl,
      reportType: 'balance',
      dateRange,
      generatedAt: new Date().toISOString(),
      metrics,
      invoices: allInvoices,
    };
  } else {
    // Original logic for revenue and expenses
    const invoices = await getInvoicesForReport(chatId, dateRange, reportType);

    // Sort invoices by date descending (newest first)
    invoices.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });

    const metrics = calculateMetrics(invoices);

    return {
      businessName,
      logoUrl,
      reportType,
      dateRange,
      generatedAt: new Date().toISOString(),
      metrics,
      invoices,
    };
  }
}

/**
 * Metrics Calculator for Reports
 * Calculates financial metrics from invoice data
 */

import type { ReportMetrics, InvoiceForReport } from '../../../../../../shared/report.types';

/**
 * Calculate metrics from invoices (multi-currency aware with payment tracking)
 * CRITICAL: Filters out linked receipts to avoid double-counting
 */
export function calculateMetrics(invoices: InvoiceForReport[]): ReportMetrics {
  if (invoices.length === 0) {
    return {
      totalInvoiced: 0,
      totalReceived: 0,
      totalOutstanding: 0,
      invoicedCount: 0,
      receivedCount: 0,
      outstandingCount: 0,
      avgInvoiced: 0,
      avgReceived: 0,
      maxInvoice: 0,
      minInvoice: 0,
      currencies: [],
      paymentMethods: {},
    };
  }

  // CRITICAL: Filter out linked receipts to avoid double-counting
  // Receipts linked to invoices are already counted in the parent invoice's paidAmount
  const documentsToCount = invoices.filter((inv) => !inv.isLinkedReceipt);

  // Group invoices by currency
  const byCurrency = new Map<string, InvoiceForReport[]>();
  documentsToCount.forEach((inv) => {
    const currency = inv.currency || 'ILS';
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, []);
    }
    const currencyInvoices = byCurrency.get(currency);
    if (currencyInvoices) {
      currencyInvoices.push(inv);
    }
  });

  // Calculate metrics per currency
  const currencies = Array.from(byCurrency.entries())
    .map(([currency, currencyInvoices]) => {
      let totalInvoiced = 0;
      let totalReceived = 0;
      let totalOutstanding = 0;
      let invoicedCount = 0;
      let receivedCount = 0;
      let outstandingCount = 0;
      const amounts: number[] = [];

      currencyInvoices.forEach((doc) => {
        amounts.push(doc.amount);

        if (doc.documentType === 'invoice') {
          // Invoice: check payment status
          totalInvoiced += doc.amount;
          invoicedCount++;

          if (doc.paymentStatus === 'paid') {
            totalReceived += doc.amount;
            receivedCount++;
          } else if (doc.paymentStatus === 'partial') {
            totalReceived += doc.paidAmount || 0;
            totalOutstanding += doc.remainingBalance ?? doc.amount;
            receivedCount++; // Count as received (partially)
            outstandingCount++; // Also count as outstanding (partially)
          } else {
            // 'unpaid'
            totalOutstanding += doc.amount;
            outstandingCount++;
          }
        } else if (doc.documentType === 'receipt') {
          // Standalone receipt (not linked to invoice)
          // Note: Linked receipts are already filtered out above
          totalInvoiced += doc.amount;
          totalReceived += doc.amount;
          invoicedCount++;
          receivedCount++;
        } else if (doc.documentType === 'invoice_receipt') {
          // Invoice-receipt: paid at time of invoicing
          totalInvoiced += doc.amount;
          totalReceived += doc.amount;
          invoicedCount++;
          receivedCount++;
        }
      });

      return {
        currency,
        totalInvoiced,
        totalReceived,
        totalOutstanding,
        invoicedCount,
        receivedCount,
        outstandingCount,
        avgInvoiced: invoicedCount > 0 ? totalInvoiced / invoicedCount : 0,
        avgReceived: receivedCount > 0 ? totalReceived / receivedCount : 0,
        maxInvoice: amounts.length > 0 ? Math.max(...amounts) : 0,
        minInvoice: amounts.length > 0 ? Math.min(...amounts) : 0,
      };
    })
    .sort((a, b) => b.totalInvoiced - a.totalInvoiced); // Sort by invoiced amount descending

  // Use primary currency (highest invoiced amount) for top-level fields
  const primaryCurrency = currencies[0];

  // Payment method breakdown (across all currencies, only for received payments)
  const paymentMethods: Record<string, { count: number; total: number }> = {};
  documentsToCount.forEach((inv) => {
    // Only count payment methods for documents that have been paid
    if (inv.paymentStatus === 'paid' || inv.paymentStatus === 'partial') {
      const method = inv.paymentMethod;
      if (!paymentMethods[method]) {
        paymentMethods[method] = { count: 0, total: 0 };
      }
      paymentMethods[method].count++;
      // For partial payments, count only what was actually received
      const amountReceived = inv.paymentStatus === 'partial' ? inv.paidAmount || 0 : inv.amount;
      paymentMethods[method].total += amountReceived;
    }
  });

  return {
    totalInvoiced: primaryCurrency.totalInvoiced,
    totalReceived: primaryCurrency.totalReceived,
    totalOutstanding: primaryCurrency.totalOutstanding,
    invoicedCount: primaryCurrency.invoicedCount,
    receivedCount: primaryCurrency.receivedCount,
    outstandingCount: primaryCurrency.outstandingCount,
    avgInvoiced: primaryCurrency.avgInvoiced,
    avgReceived: primaryCurrency.avgReceived,
    maxInvoice: primaryCurrency.maxInvoice,
    minInvoice: primaryCurrency.minInvoice,
    currencies,
    paymentMethods,
  };
}

/**
 * Calculate balance metrics from both revenue and expense invoices
 * Combines revenue and expense data to show net position, profit, and cash flow
 */
export function calculateBalanceMetrics(
  revenueInvoices: InvoiceForReport[],
  expenseInvoices: InvoiceForReport[]
): ReportMetrics {
  // Calculate separate metrics for each
  const revenueMetrics = calculateMetrics(revenueInvoices);
  const expenseMetrics = calculateMetrics(expenseInvoices);

  // For balance reports, we show total expenses as the "invoiced" amount for expenses
  const totalExpenses = expenseMetrics.totalInvoiced;
  const expenseCount = expenseMetrics.invoicedCount;

  // Calculate per-currency net positions
  const currencyMap = new Map<
    string,
    {
      revenueInvoiced: number;
      revenueReceived: number;
      revenueOutstanding: number;
      expenses: number;
      netInvoiced: number;
      netCashFlow: number;
    }
  >();

  // Add revenue currencies
  revenueMetrics.currencies.forEach((curr) => {
    currencyMap.set(curr.currency, {
      revenueInvoiced: curr.totalInvoiced,
      revenueReceived: curr.totalReceived,
      revenueOutstanding: curr.totalOutstanding,
      expenses: 0,
      netInvoiced: curr.totalInvoiced,
      netCashFlow: curr.totalReceived,
    });
  });

  // Subtract expenses per currency
  expenseMetrics.currencies.forEach((curr) => {
    const existing = currencyMap.get(curr.currency);
    if (existing) {
      existing.expenses = curr.totalInvoiced;
      existing.netInvoiced = existing.revenueInvoiced - curr.totalInvoiced;
      existing.netCashFlow = existing.revenueReceived - curr.totalInvoiced;
    } else {
      // Expenses in a currency with no revenue
      currencyMap.set(curr.currency, {
        revenueInvoiced: 0,
        revenueReceived: 0,
        revenueOutstanding: 0,
        expenses: curr.totalInvoiced,
        netInvoiced: -curr.totalInvoiced,
        netCashFlow: -curr.totalInvoiced,
      });
    }
  });

  // Convert to array and sort by absolute net invoiced (highest first)
  const currencies = Array.from(currencyMap.entries())
    .map(([currency, data]) => ({
      currency,
      totalInvoiced: data.netInvoiced,
      totalReceived: data.netCashFlow,
      totalOutstanding: data.revenueOutstanding,
      invoicedCount: 0, // Not meaningful for combined view
      receivedCount: 0,
      outstandingCount: 0,
      avgInvoiced: 0,
      avgReceived: 0,
      maxInvoice: 0,
      minInvoice: 0,
    }))
    .sort((a, b) => Math.abs(b.totalInvoiced) - Math.abs(a.totalInvoiced));

  // Use primary currency (highest absolute net position) for top-level fields
  const primaryCurrency = currencies[0];

  // Get primary currency data for profit margin calculation
  const primaryCurrencyData = primaryCurrency ? currencyMap.get(primaryCurrency.currency) : null;

  // Calculate profit and margin from primary currency only (not cross-currency)
  const netInvoiced = primaryCurrency?.totalInvoiced || 0;
  const netCashFlow = primaryCurrency?.totalReceived || 0;
  const profit = netCashFlow; // Net cash flow in primary currency
  const profitMargin =
    primaryCurrencyData && primaryCurrencyData.revenueReceived > 0
      ? (profit / primaryCurrencyData.revenueReceived) * 100
      : 0;

  return {
    // Top-level metrics show net positions (from primary currency)
    totalInvoiced: netInvoiced,
    totalReceived: netCashFlow,
    totalOutstanding: revenueMetrics.totalOutstanding,
    invoicedCount: revenueMetrics.invoicedCount + expenseCount,
    receivedCount: revenueMetrics.receivedCount + expenseCount, // Expenses are treated as paid
    outstandingCount: revenueMetrics.outstandingCount,
    avgInvoiced:
      revenueMetrics.invoicedCount + expenseCount > 0
        ? (revenueMetrics.totalInvoiced + totalExpenses) /
          (revenueMetrics.invoicedCount + expenseCount)
        : 0,
    avgReceived:
      revenueMetrics.receivedCount + expenseCount > 0
        ? (revenueMetrics.totalReceived + totalExpenses) /
          (revenueMetrics.receivedCount + expenseCount)
        : 0,
    maxInvoice: Math.max(revenueMetrics.maxInvoice, expenseMetrics.maxInvoice),
    minInvoice: (() => {
      const candidates: number[] = [];
      if (revenueMetrics.minInvoice > 0) {
        candidates.push(revenueMetrics.minInvoice);
      }
      if (expenseMetrics.minInvoice > 0) {
        candidates.push(expenseMetrics.minInvoice);
      }
      return candidates.length > 0 ? Math.min(...candidates) : 0;
    })(),
    currencies,
    paymentMethods: revenueMetrics.paymentMethods,

    // Balance-specific metrics
    revenueMetrics: {
      totalInvoiced: revenueMetrics.totalInvoiced,
      totalReceived: revenueMetrics.totalReceived,
      totalOutstanding: revenueMetrics.totalOutstanding,
      invoicedCount: revenueMetrics.invoicedCount,
      receivedCount: revenueMetrics.receivedCount,
      outstandingCount: revenueMetrics.outstandingCount,
      avgInvoiced: revenueMetrics.avgInvoiced,
      currencies: revenueMetrics.currencies,
    },
    expenseMetrics: {
      totalExpenses,
      expenseCount,
      avgExpense: expenseCount > 0 ? totalExpenses / expenseCount : 0,
      currencies: expenseMetrics.currencies.map((c) => ({
        currency: c.currency,
        totalExpenses: c.totalInvoiced,
        expenseCount: c.invoicedCount,
        avgExpense: c.avgInvoiced,
      })),
    },
    netInvoiced,
    netCashFlow,
    profit,
    profitMargin,
  };
}

/**
 * Report Service
 * Core business logic for report generation
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';
import type {
  ReportData,
  ReportMetrics,
  DateRange,
  InvoiceForReport,
} from '../../../../../shared/report.types';
import {
  GENERATED_INVOICES_COLLECTION,
  GENERATED_RECEIPTS_COLLECTION,
  GENERATED_INVOICE_RECEIPTS_COLLECTION,
} from '../../../../../shared/collections';
import { parseGeneratedInvoiceDate } from '../../models/generated-invoice.model';
import { getInvoiceJobsCollection, type InvoiceJob } from '../../models/invoice-job.model';
import logger from '../../logger';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Get date range for preset
 */
export function getDateRangeForPreset(preset: string): DateRange {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  switch (preset) {
    case 'this_month': {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0); // Last day of month
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'this_month',
      };
    }
    case 'last_month': {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'last_month',
      };
    }
    case 'ytd': {
      // Year-to-Date: Jan 1 to today
      const start = new Date(year, 0, 1);
      const end = new Date(year, month, now.getDate());
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'ytd',
      };
    }
    default:
      throw new Error(`Unknown preset: ${preset}`);
  }
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the earliest invoice date for a chat (checks both revenue and expenses)
 * Used to limit calendar date selection
 * @returns Date string (YYYY-MM-DD) or null if no invoices
 */
export async function getEarliestInvoiceDate(
  chatId: number,
  reportType: 'revenue' | 'expenses'
): Promise<string | null> {
  const db = getFirestore();
  const log = logger.child({ chatId, reportType, function: 'getEarliestInvoiceDate' });

  try {
    if (reportType === 'revenue') {
      // Check all 3 collections for revenue documents
      const [invoicesSnapshot, receiptsSnapshot, invoiceReceiptsSnapshot] = await Promise.all([
        db
          .collection(GENERATED_INVOICES_COLLECTION)
          .where('chatId', '==', chatId)
          .orderBy('generatedAt', 'asc')
          .limit(1)
          .get(),
        db
          .collection(GENERATED_RECEIPTS_COLLECTION)
          .where('chatId', '==', chatId)
          .orderBy('generatedAt', 'asc')
          .limit(1)
          .get(),
        db
          .collection(GENERATED_INVOICE_RECEIPTS_COLLECTION)
          .where('chatId', '==', chatId)
          .orderBy('generatedAt', 'asc')
          .limit(1)
          .get(),
      ]);

      const dates: Date[] = [];

      if (!invoicesSnapshot.empty) {
        dates.push(invoicesSnapshot.docs[0].data().generatedAt.toDate());
      }
      if (!receiptsSnapshot.empty) {
        dates.push(receiptsSnapshot.docs[0].data().generatedAt.toDate());
      }
      if (!invoiceReceiptsSnapshot.empty) {
        dates.push(invoiceReceiptsSnapshot.docs[0].data().generatedAt.toDate());
      }

      if (dates.length === 0) {
        log.info('No generated documents found for chat');
        return null;
      }

      // Find earliest date across all collections
      const earliestDate = new Date(Math.min(...dates.map((d) => d.getTime())));
      const formatted = formatDate(earliestDate);

      log.info({ earliestDate: formatted }, 'Found earliest generated document date');
      return formatted;
    } else {
      // Check invoice_jobs collection (uses 'telegramChatId' field)
      const collection = getInvoiceJobsCollection(db);
      const snapshot = await collection
        .where('telegramChatId', '==', chatId) // ✓ Type-safe field name
        .where('status', '==', 'processed')
        .orderBy('createdAt', 'asc')
        .limit(1)
        .get();

      if (snapshot.empty) {
        log.info('No expense invoices found for chat');
        return null;
      }

      const job: InvoiceJob = snapshot.docs[0].data(); // ✓ Typed!
      const date = new Date(job.receivedAt);
      const formatted = formatDate(date);

      log.info({ earliestDate: formatted }, 'Found earliest expense invoice date');
      return formatted;
    }
  } catch (error) {
    log.error({ error }, 'Failed to get earliest invoice date');
    throw error;
  }
}

/**
 * Query processed invoices for date range
 */
export async function getInvoicesForReport(
  chatId: number,
  dateRange: DateRange,
  reportType: 'revenue' | 'expenses'
): Promise<InvoiceForReport[]> {
  const db = getFirestore();
  const log = logger.child({ chatId, dateRange, reportType });

  log.info('Querying invoices for report');

  try {
    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);
    endDate.setHours(23, 59, 59, 999); // End of day

    if (reportType === 'revenue') {
      // Query all 3 collections for revenue documents after collection split
      const [invoicesSnapshot, receiptsSnapshot, invoiceReceiptsSnapshot] = await Promise.all([
        db
          .collection(GENERATED_INVOICES_COLLECTION)
          .where('chatId', '==', chatId)
          .where('generatedAt', '>=', Timestamp.fromDate(startDate))
          .where('generatedAt', '<=', Timestamp.fromDate(endDate))
          .get(),
        db
          .collection(GENERATED_RECEIPTS_COLLECTION)
          .where('chatId', '==', chatId)
          .where('generatedAt', '>=', Timestamp.fromDate(startDate))
          .where('generatedAt', '<=', Timestamp.fromDate(endDate))
          .get(),
        db
          .collection(GENERATED_INVOICE_RECEIPTS_COLLECTION)
          .where('chatId', '==', chatId)
          .where('generatedAt', '>=', Timestamp.fromDate(startDate))
          .where('generatedAt', '<=', Timestamp.fromDate(endDate))
          .get(),
      ]);

      const totalCount =
        invoicesSnapshot.docs.length +
        receiptsSnapshot.docs.length +
        invoiceReceiptsSnapshot.docs.length;

      log.info({ count: totalCount }, 'Found generated documents across all collections');

      // Process documents from all collections
      const allInvoices: InvoiceForReport[] = [];

      // Process invoices
      for (const doc of invoicesSnapshot.docs) {
        const invoice = doc.data();
        if (!invoice.customerName || invoice.amount === null || invoice.amount === undefined) {
          continue;
        }

        allInvoices.push({
          invoiceNumber: invoice.invoiceNumber || doc.id,
          date: parseGeneratedInvoiceDate(invoice.date),
          customerName: invoice.customerName,
          amount: invoice.amount,
          currency: invoice.currency || 'ILS',
          paymentMethod: invoice.paymentMethod || 'Unknown',
          category: invoice.description || undefined,
          driveLink: invoice.storageUrl || '',
        });
      }

      // Process receipts
      for (const doc of receiptsSnapshot.docs) {
        const receipt = doc.data();
        if (!receipt.customerName || receipt.amount === null || receipt.amount === undefined) {
          continue;
        }

        allInvoices.push({
          invoiceNumber: receipt.invoiceNumber || doc.id,
          date: parseGeneratedInvoiceDate(receipt.date),
          customerName: receipt.customerName,
          amount: receipt.amount,
          currency: receipt.currency || 'ILS',
          paymentMethod: receipt.paymentMethod || 'Unknown',
          category: receipt.description || undefined,
          driveLink: receipt.storageUrl || '',
        });
      }

      // Process invoice-receipts
      for (const doc of invoiceReceiptsSnapshot.docs) {
        const invoiceReceipt = doc.data();
        if (
          !invoiceReceipt.customerName ||
          invoiceReceipt.amount === null ||
          invoiceReceipt.amount === undefined
        ) {
          continue;
        }

        allInvoices.push({
          invoiceNumber: invoiceReceipt.invoiceNumber || doc.id,
          date: parseGeneratedInvoiceDate(invoiceReceipt.date),
          customerName: invoiceReceipt.customerName,
          amount: invoiceReceipt.amount,
          currency: invoiceReceipt.currency || 'ILS',
          paymentMethod: invoiceReceipt.paymentMethod || 'Unknown',
          category: invoiceReceipt.description || undefined,
          driveLink: invoiceReceipt.storageUrl || '',
        });
      }

      return allInvoices;
    } else {
      // Query invoice_jobs collection (received/processed invoices for expenses)
      // Uses type-safe model with 'telegramChatId' field (NOT chatId!)
      const collection = getInvoiceJobsCollection(db);
      const snapshot = await collection
        .where('telegramChatId', '==', chatId) // ✓ Autocomplete knows this field exists!
        .where('status', '==', 'processed')
        .where('createdAt', '>=', Timestamp.fromDate(startDate))
        .where('createdAt', '<=', Timestamp.fromDate(endDate))
        .get();

      log.info({ count: snapshot.docs.length }, 'Found expense invoices');

      const invoices = snapshot.docs
        .map((doc) => {
          const job: InvoiceJob = doc.data(); // ✓ Already typed and validated!

          // Only include if we have extraction data
          if (!job.vendorName || job.totalAmount === null || job.totalAmount === undefined) {
            return null;
          }

          const invoice: InvoiceForReport = {
            invoiceNumber: doc.id,
            date: job.invoiceDate || formatDate(new Date(job.receivedAt)),
            customerName: job.vendorName, // ✓ Clear from model: vendorName not customerName
            amount: job.totalAmount, // ✓ Clear from model: totalAmount not amount
            currency: job.currency || 'ILS',
            paymentMethod: 'Unknown', // Not stored in InvoiceJob currently
            category: job.category || undefined,
            driveLink: job.driveLink || '',
          };

          return invoice;
        })
        .filter((invoice): invoice is InvoiceForReport => invoice !== null);

      return invoices;
    }
  } catch (error) {
    log.error({ error }, 'Failed to query invoices');
    throw error;
  }
}

/**
 * Calculate metrics from invoices (multi-currency aware)
 */
export function calculateMetrics(invoices: InvoiceForReport[]): ReportMetrics {
  if (invoices.length === 0) {
    return {
      totalRevenue: 0,
      invoiceCount: 0,
      avgInvoice: 0,
      maxInvoice: 0,
      minInvoice: 0,
      currencies: [],
      paymentMethods: {},
    };
  }

  // Group invoices by currency
  const byCurrency = new Map<string, InvoiceForReport[]>();
  invoices.forEach((inv) => {
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
      const amounts = currencyInvoices.map((inv) => inv.amount);
      const totalRevenue = amounts.reduce((sum, amount) => sum + amount, 0);

      return {
        currency,
        totalRevenue,
        invoiceCount: currencyInvoices.length,
        avgInvoice: totalRevenue / currencyInvoices.length,
        maxInvoice: Math.max(...amounts),
        minInvoice: Math.min(...amounts),
      };
    })
    .sort((a, b) => b.totalRevenue - a.totalRevenue); // Sort by revenue descending

  // Use primary currency (highest revenue) for legacy fields
  const primaryCurrency = currencies[0];

  // Payment method breakdown (across all currencies)
  const paymentMethods: Record<string, { count: number; total: number }> = {};
  invoices.forEach((inv) => {
    const method = inv.paymentMethod;
    if (!paymentMethods[method]) {
      paymentMethods[method] = { count: 0, total: 0 };
    }
    paymentMethods[method].count++;
    paymentMethods[method].total += inv.amount;
  });

  return {
    // Legacy fields use primary currency
    totalRevenue: primaryCurrency.totalRevenue,
    invoiceCount: primaryCurrency.invoiceCount,
    avgInvoice: primaryCurrency.avgInvoice,
    maxInvoice: primaryCurrency.maxInvoice,
    minInvoice: primaryCurrency.minInvoice,
    // Multi-currency data
    currencies,
    paymentMethods,
  };
}

/**
 * Generate complete report data
 */
export async function generateReportData(
  chatId: number,
  dateRange: DateRange,
  businessName: string,
  reportType: 'revenue' | 'expenses' = 'revenue',
  logoUrl?: string
): Promise<ReportData> {
  const invoices = await getInvoicesForReport(chatId, dateRange, reportType);
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

/**
 * Data Fetcher for Reports
 * Handles fetching invoice data from Firestore
 */

import { Timestamp } from '@google-cloud/firestore';
import type { DateRange, InvoiceForReport } from '../../../../../../shared/report.types';
import {
  GENERATED_INVOICES_COLLECTION,
  GENERATED_RECEIPTS_COLLECTION,
  GENERATED_INVOICE_RECEIPTS_COLLECTION,
} from '../../../../../../shared/collections';
import { parseGeneratedInvoiceDate } from '../../../models/generated-invoice.model';
import { getInvoiceJobsCollection, type InvoiceJob } from '../../../models/invoice-job.model';
import logger from '../../../logger';
import { getFirestore } from '../../firestore.service';
import { formatDate } from './date-utils';

/**
 * Get the earliest invoice date for a chat (checks both revenue and expenses)
 * Used to limit calendar date selection
 * @returns Date string (YYYY-MM-DD) or null if no invoices
 */
export async function getEarliestInvoiceDate(
  chatId: number,
  reportType: 'revenue' | 'expenses' | 'balance'
): Promise<string | null> {
  const db = getFirestore();
  const log = logger.child({ chatId, reportType, function: 'getEarliestInvoiceDate' });

  try {
    if (reportType === 'balance') {
      // For balance reports, get earliest from both revenue and expenses
      const [revenueDate, expenseDate] = await Promise.all([
        getEarliestInvoiceDate(chatId, 'revenue'),
        getEarliestInvoiceDate(chatId, 'expenses'),
      ]);

      // Return earliest date from both
      if (!revenueDate && !expenseDate) {
        return null;
      } else if (!revenueDate) {
        return expenseDate;
      } else if (!expenseDate) {
        return revenueDate;
      } else {
        // Both exist, return earliest
        return revenueDate < expenseDate ? revenueDate : expenseDate;
      }
    } else if (reportType === 'revenue') {
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

    const startTimestamp = Timestamp.fromDate(startDate);
    const endTimestamp = Timestamp.fromDate(endDate);

    if (reportType === 'revenue') {
      // Helper to build query with common where clauses
      const buildRevenueQuery = (collectionName: string) =>
        db
          .collection(collectionName)
          .where('chatId', '==', chatId)
          .where('generatedAt', '>=', startTimestamp)
          .where('generatedAt', '<=', endTimestamp)
          .get();

      // Query all 3 collections for revenue documents after collection split
      const [invoicesSnapshot, receiptsSnapshot, invoiceReceiptsSnapshot] = await Promise.all([
        buildRevenueQuery(GENERATED_INVOICES_COLLECTION),
        buildRevenueQuery(GENERATED_RECEIPTS_COLLECTION),
        buildRevenueQuery(GENERATED_INVOICE_RECEIPTS_COLLECTION),
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

          // Payment tracking
          documentType: 'invoice',
          paymentStatus: invoice.paymentStatus || 'unpaid',
          paidAmount: invoice.paidAmount,
          remainingBalance: invoice.remainingBalance,
          relatedInvoiceNumber: undefined, // Invoices don't have parent
          isLinkedReceipt: false,
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

          // Payment tracking
          documentType: 'receipt',
          paymentStatus: 'paid',
          paidAmount: receipt.amount,
          remainingBalance: 0,
          relatedInvoiceNumber: receipt.relatedInvoiceNumber,
          isLinkedReceipt: !!receipt.relatedInvoiceNumber, // TRUE if linked to invoice
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

          // Payment tracking
          documentType: 'invoice_receipt',
          paymentStatus: 'paid',
          paidAmount: invoiceReceipt.amount,
          remainingBalance: 0,
          relatedInvoiceNumber: undefined,
          isLinkedReceipt: false,
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
        .where('createdAt', '>=', startTimestamp)
        .where('createdAt', '<=', endTimestamp)
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

            // Payment tracking (expenses are treated as paid)
            documentType: 'invoice_receipt', // Expenses are considered paid
            paymentStatus: 'paid',
            paidAmount: job.totalAmount,
            remainingBalance: 0,
            relatedInvoiceNumber: undefined,
            isLinkedReceipt: false,
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

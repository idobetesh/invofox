/**
 * CSV Report Generator
 * Generates CSV reports with Hebrew support (BOM encoded)
 */

import type { ReportData, BalanceInvoiceForReport } from '../../../../../../shared/report.types';
import logger from '../../../logger';

/**
 * Generate CSV report buffer
 */
export async function generateCSVReport(data: ReportData): Promise<Buffer> {
  const log = logger.child({ reportType: data.reportType });
  log.info('Generating CSV report');

  // eslint-disable-next-line no-restricted-syntax
  const { stringify } = await import('csv-stringify/sync');

  // Create CSV data - filter out linked receipts
  const invoicesToShow = data.invoices.filter((inv) => !inv.isLinkedReceipt);

  // Header based on report type
  let header: string[];
  if (data.reportType === 'balance') {
    header = ['סוג', 'תאריך', 'לקוח/ספק', 'סכום', 'מטבע', 'אמצעי תשלום', 'קטגוריה', 'קישור'];
  } else if (data.reportType === 'revenue') {
    header = [
      'תאריך',
      'לקוח',
      'סכום',
      'מטבע',
      'סטטוס',
      'סכום ששולם',
      'יתרה',
      'אמצעי תשלום',
      'קטגוריה',
      'קישור',
    ];
  } else {
    header = ['תאריך', 'ספק', 'סכום', 'מטבע', 'אמצעי תשלום', 'קטגוריה', 'קישור'];
  }

  const records = [
    header,
    // Data rows
    ...invoicesToShow.map((inv) => {
      if (data.reportType === 'balance') {
        // Balance report with type column
        const balanceInv = inv as BalanceInvoiceForReport;
        const isExpense = balanceInv.reportSource === 'expenses';
        const typeText = isExpense ? 'הוצאה' : 'הכנסה';
        const amount = isExpense ? -inv.amount : inv.amount;

        return [
          typeText,
          inv.date,
          inv.customerName,
          amount.toString(),
          inv.currency,
          inv.paymentMethod,
          inv.category || 'כללי',
          inv.driveLink,
        ];
      } else if (data.reportType === 'revenue') {
        // Determine status text
        let statusText = 'ממתין';
        if (inv.paymentStatus === 'paid') {
          statusText = 'שולם';
        } else if (inv.paymentStatus === 'partial') {
          statusText = 'שולם חלקי';
        }

        return [
          inv.date,
          inv.customerName,
          inv.amount.toString(),
          inv.currency,
          statusText,
          (inv.paidAmount || 0).toString(),
          (inv.remainingBalance || 0).toString(),
          inv.paymentMethod,
          inv.category || 'כללי',
          inv.driveLink,
        ];
      } else {
        // Expenses - no status columns
        return [
          inv.date,
          inv.customerName,
          inv.amount.toString(),
          inv.currency,
          inv.paymentMethod,
          inv.category || 'כללי',
          inv.driveLink,
        ];
      }
    }),
  ];

  const csvString = stringify(records, {
    encoding: 'utf8',
    bom: true, // Add BOM for Excel Hebrew support
  });

  const buffer = Buffer.from(csvString, 'utf8');
  log.info({ sizeKb: Math.round(buffer.length / 1024) }, 'CSV generated');
  return buffer;
}

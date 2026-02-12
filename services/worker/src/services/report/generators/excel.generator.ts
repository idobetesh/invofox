/**
 * Excel Report Generator
 * Generates Excel (.xlsx) reports with summary and data sheets
 */

import type { ReportData, BalanceInvoiceForReport } from '../../../../../../shared/report.types';
import { REPORT_TYPE_NAMES } from '../../../../../../shared/report.types';
import { getCurrencySymbol } from './utils';
import logger from '../../../logger';

/**
 * Generate Excel report buffer
 */
export async function generateExcelReport(data: ReportData): Promise<Buffer> {
  const log = logger.child({ reportType: data.reportType });
  log.info('Generating Excel report');

  // eslint-disable-next-line no-restricted-syntax
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();

  // Summary Sheet
  const summarySheet = workbook.addWorksheet('סיכום');
  summarySheet.views = [{ rightToLeft: true }];

  // Title
  summarySheet.mergeCells('A1:D1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = `דוח ${REPORT_TYPE_NAMES[data.reportType]} - ${data.businessName}`;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF2563EB' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Date range
  summarySheet.mergeCells('A2:D2');
  const dateCell = summarySheet.getCell('A2');
  dateCell.value = `תקופה: ${data.dateRange.start} עד ${data.dateRange.end}`;
  dateCell.alignment = { horizontal: 'center' };
  dateCell.font = { size: 12 };

  // Currency breakdown
  summarySheet.addRow([]);
  if (data.metrics.currencies.length > 1) {
    summarySheet.addRow(['סה"כ לפי מטבע']);
    summarySheet.getRow(4).font = { bold: true, color: { argb: 'FF2563EB' }, size: 14 };
    data.metrics.currencies.forEach((curr) => {
      const symbol = getCurrencySymbol(curr.currency);
      if (data.reportType === 'revenue') {
        summarySheet.addRow([
          `${curr.currency} - הונפקו`,
          `${symbol}${curr.totalInvoiced.toLocaleString()}`,
        ]);
        summarySheet.addRow([
          `${curr.currency} - התקבלו`,
          `${symbol}${curr.totalReceived.toLocaleString()}`,
        ]);
        summarySheet.addRow([
          `${curr.currency} - ממתינות`,
          `${symbol}${curr.totalOutstanding.toLocaleString()}`,
        ]);
      } else {
        summarySheet.addRow([
          `${curr.currency} - סה"כ`,
          `${symbol}${curr.totalInvoiced.toLocaleString()}`,
        ]);
      }
    });
    summarySheet.addRow([]);
  }

  // Metrics (primary currency)
  const currentRow = summarySheet.rowCount + 1;
  summarySheet.addRow(['מדד', 'ערך']);
  summarySheet.getRow(currentRow).font = { bold: true };
  summarySheet.getRow(currentRow).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };
  summarySheet.getRow(currentRow).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const primaryCurrency = data.metrics.currencies[0];
  const symbol = getCurrencySymbol(primaryCurrency.currency);

  // Metrics based on report type
  if (data.reportType === 'balance') {
    // Three-section summary for balance reports

    // Section 1: Revenue metrics
    summarySheet.addRow(['הכנסות']);
    const revTitleRow = summarySheet.rowCount;
    summarySheet.getRow(revTitleRow).font = { bold: true, color: { argb: 'FF059669' }, size: 14 };
    summarySheet.addRow([
      `הונפקו (${primaryCurrency.currency})`,
      `${symbol}${(data.metrics.revenueMetrics?.totalInvoiced || 0).toLocaleString()}`,
    ]);
    summarySheet.addRow([
      `התקבלו (${primaryCurrency.currency})`,
      `${symbol}${(data.metrics.revenueMetrics?.totalReceived || 0).toLocaleString()}`,
    ]);
    summarySheet.addRow([
      `ממתינות (${primaryCurrency.currency})`,
      `${symbol}${(data.metrics.revenueMetrics?.totalOutstanding || 0).toLocaleString()}`,
    ]);
    summarySheet.addRow([`מספר מסמכים`, data.metrics.revenueMetrics?.invoicedCount || 0]);
    summarySheet.addRow([]); // Blank row

    // Section 2: Expense metrics
    summarySheet.addRow(['הוצאות']);
    const expTitleRow = summarySheet.rowCount;
    summarySheet.getRow(expTitleRow).font = { bold: true, color: { argb: 'FFDC2626' }, size: 14 };
    summarySheet.addRow([
      `סה"כ הוצאות (${primaryCurrency.currency})`,
      `${symbol}${(data.metrics.expenseMetrics?.totalExpenses || 0).toLocaleString()}`,
    ]);
    summarySheet.addRow([`מספר הוצאות`, data.metrics.expenseMetrics?.expenseCount || 0]);
    summarySheet.addRow([]); // Blank row

    // Section 3: Net balance
    summarySheet.addRow(['מאזן נקי']);
    const balTitleRow = summarySheet.rowCount;
    summarySheet.getRow(balTitleRow).font = { bold: true, color: { argb: 'FF8B5CF6' }, size: 14 };
    summarySheet.addRow([
      `רווח נקי (${primaryCurrency.currency})`,
      `${symbol}${(data.metrics.profit || 0).toLocaleString()}`,
    ]);
    summarySheet.addRow(['שולי רווח', `${(data.metrics.profitMargin || 0).toFixed(1)}%`]);
    summarySheet.addRow([
      `תזרים מזומנים (${primaryCurrency.currency})`,
      `${symbol}${(data.metrics.netCashFlow || 0).toLocaleString()}`,
    ]);
    summarySheet.addRow([
      `נטו הונפק (${primaryCurrency.currency})`,
      `${symbol}${(data.metrics.netInvoiced || 0).toLocaleString()}`,
    ]);
    summarySheet.addRow([]); // Blank row
  } else if (data.reportType === 'revenue') {
    // Payment tracking metrics for revenue
    summarySheet.addRow([
      `סה"כ חשבוניות שהונפקו (${primaryCurrency.currency})`,
      `${symbol}${data.metrics.totalInvoiced.toLocaleString()}`,
    ]);
    summarySheet.addRow([
      `תקבולים בפועל (${primaryCurrency.currency})`,
      `${symbol}${data.metrics.totalReceived.toLocaleString()}`,
    ]);
    summarySheet.addRow([
      `חשבוניות ממתינות (${primaryCurrency.currency})`,
      `${symbol}${data.metrics.totalOutstanding.toLocaleString()}`,
    ]);
    summarySheet.addRow([
      'אחוז גביה',
      data.metrics.totalInvoiced > 0
        ? `${((data.metrics.totalReceived / data.metrics.totalInvoiced) * 100).toFixed(1)}%`
        : '0%',
    ]);
    summarySheet.addRow([]); // Blank row

    // Count metrics
    summarySheet.addRow([`מספר מסמכים שהונפקו`, data.metrics.invoicedCount]);
    summarySheet.addRow([`מספר תשלומים שהתקבלו`, data.metrics.receivedCount]);
    summarySheet.addRow([`מספר חשבוניות ממתינות`, data.metrics.outstandingCount]);
    summarySheet.addRow([]); // Blank row
  } else {
    // Simple metrics for expenses
    summarySheet.addRow([
      `סה"כ הוצאות (${primaryCurrency.currency})`,
      `${symbol}${data.metrics.totalInvoiced.toLocaleString()}`,
    ]);
    summarySheet.addRow([`מספר הוצאות`, data.metrics.invoicedCount]);
    summarySheet.addRow([]); // Blank row
  }

  // Average metrics
  summarySheet.addRow([
    `ממוצע לחשבונית (${primaryCurrency.currency})`,
    `${symbol}${data.metrics.avgInvoiced.toFixed(2)}`,
  ]);
  summarySheet.addRow([
    `חשבונית מקסימלית (${primaryCurrency.currency})`,
    `${symbol}${data.metrics.maxInvoice.toLocaleString()}`,
  ]);
  summarySheet.addRow([
    `חשבונית מינימלית (${primaryCurrency.currency})`,
    `${symbol}${data.metrics.minInvoice.toLocaleString()}`,
  ]);

  // Column widths
  summarySheet.getColumn(1).width = 30;
  summarySheet.getColumn(2).width = 20;

  // Invoices Sheet
  const sheetNames = {
    revenue: 'חשבוניות',
    expenses: 'הוצאות',
    balance: 'מסמכים',
  };
  const invoicesSheet = workbook.addWorksheet(sheetNames[data.reportType]);
  invoicesSheet.views = [{ rightToLeft: true }];

  // Header - conditional based on report type
  if (data.reportType === 'balance') {
    invoicesSheet.addRow([
      'סוג',
      'תאריך',
      'לקוח/ספק',
      'סכום',
      'מטבע',
      'אמצעי תשלום',
      'קטגוריה',
      'קישור',
    ]);
  } else if (data.reportType === 'revenue') {
    invoicesSheet.addRow([
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
    ]);
  } else {
    invoicesSheet.addRow(['תאריך', 'ספק', 'סכום', 'מטבע', 'אמצעי תשלום', 'קטגוריה', 'קישור']);
  }
  invoicesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  invoicesSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };

  // Data rows - filter out linked receipts
  const invoicesToShow = data.invoices.filter((inv) => !inv.isLinkedReceipt);
  invoicesToShow.forEach((inv) => {
    if (data.reportType === 'balance') {
      // Balance report with type column
      const balanceInv = inv as BalanceInvoiceForReport;
      const isExpense = balanceInv.reportSource === 'expenses';
      const typeText = isExpense ? 'הוצאה' : 'הכנסה';
      const amount = isExpense ? -inv.amount : inv.amount;

      const row = invoicesSheet.addRow([
        typeText,
        inv.date,
        inv.customerName,
        amount,
        inv.currency,
        inv.paymentMethod,
        inv.category || 'כללי',
        inv.driveLink,
      ]);

      // Color-code expense rows
      if (isExpense) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEE2E2' }, // Light red background
          };
        });
        // Make amount red
        row.getCell(4).font = { color: { argb: 'FFDC2626' } };
      }
      // Type cell color
      row.getCell(1).font = {
        bold: true,
        color: { argb: isExpense ? 'FFDC2626' : 'FF059669' },
      };
    } else if (data.reportType === 'revenue') {
      // Determine status text
      let statusText = 'ממתין';
      if (inv.paymentStatus === 'paid') {
        statusText = 'שולם';
      } else if (inv.paymentStatus === 'partial') {
        statusText = 'שולם חלקי';
      }

      invoicesSheet.addRow([
        inv.date,
        inv.customerName,
        inv.amount,
        inv.currency,
        statusText,
        inv.paidAmount || 0,
        inv.remainingBalance || 0,
        inv.paymentMethod,
        inv.category || 'כללי',
        inv.driveLink,
      ]);
    } else {
      // Expenses - no status columns
      invoicesSheet.addRow([
        inv.date,
        inv.customerName,
        inv.amount,
        inv.currency,
        inv.paymentMethod,
        inv.category || 'כללי',
        inv.driveLink,
      ]);
    }
  });

  // Column widths - conditional based on report type
  if (data.reportType === 'balance') {
    invoicesSheet.getColumn(1).width = 10; // Type
    invoicesSheet.getColumn(2).width = 12; // Date
    invoicesSheet.getColumn(3).width = 30; // Customer/Supplier
    invoicesSheet.getColumn(4).width = 12; // Amount
    invoicesSheet.getColumn(5).width = 8; // Currency
    invoicesSheet.getColumn(6).width = 15; // Payment method
    invoicesSheet.getColumn(7).width = 20; // Category
    invoicesSheet.getColumn(8).width = 40; // Link

    // Format amount column as currency
    for (let i = 2; i <= invoicesToShow.length + 1; i++) {
      invoicesSheet.getCell(`D${i}`).numFmt = '₪#,##0.00'; // Amount
    }
  } else if (data.reportType === 'revenue') {
    invoicesSheet.getColumn(1).width = 12; // Date
    invoicesSheet.getColumn(2).width = 30; // Customer
    invoicesSheet.getColumn(3).width = 12; // Amount
    invoicesSheet.getColumn(4).width = 8; // Currency
    invoicesSheet.getColumn(5).width = 12; // Status
    invoicesSheet.getColumn(6).width = 12; // Paid Amount
    invoicesSheet.getColumn(7).width = 12; // Remaining Balance
    invoicesSheet.getColumn(8).width = 15; // Payment method
    invoicesSheet.getColumn(9).width = 20; // Category
    invoicesSheet.getColumn(10).width = 40; // Link

    // Format amount columns as currency
    for (let i = 2; i <= invoicesToShow.length + 1; i++) {
      invoicesSheet.getCell(`C${i}`).numFmt = '₪#,##0.00'; // Amount
      invoicesSheet.getCell(`F${i}`).numFmt = '₪#,##0.00'; // Paid Amount
      invoicesSheet.getCell(`G${i}`).numFmt = '₪#,##0.00'; // Remaining Balance
    }
  } else {
    invoicesSheet.getColumn(1).width = 12; // Date
    invoicesSheet.getColumn(2).width = 30; // Supplier
    invoicesSheet.getColumn(3).width = 12; // Amount
    invoicesSheet.getColumn(4).width = 8; // Currency
    invoicesSheet.getColumn(5).width = 15; // Payment method
    invoicesSheet.getColumn(6).width = 20; // Category
    invoicesSheet.getColumn(7).width = 40; // Link

    // Format amount column as currency
    for (let i = 2; i <= invoicesToShow.length + 1; i++) {
      invoicesSheet.getCell(`C${i}`).numFmt = '₪#,##0.00'; // Amount
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  log.info({ sizeKb: Math.round(buffer.byteLength / 1024) }, 'Excel generated');
  return Buffer.from(buffer);
}

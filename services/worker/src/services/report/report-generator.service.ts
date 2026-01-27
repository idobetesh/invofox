/**
 * Report Generator Service
 * Generates PDF, Excel, and CSV reports from report data
 */

import type { ReportData } from '../../../../../shared/report.types';
import { generateReportHTML } from './report-template';
import logger from '../../logger';

/**
 * Get currency symbol for display (used in Excel/CSV generation)
 */
function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    ILS: '₪',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  };
  return symbols[currency] || currency + ' ';
}

/**
 * Generate PDF report buffer
 * Phase 1: Simple text-based PDF
 * Phase 2: Add charts and better formatting
 */
export async function generatePDFReport(data: ReportData): Promise<Buffer> {
  const log = logger.child({ reportType: data.reportType });
  log.info('Generating PDF report');

  // Generate HTML from template
  const html = generateReportHTML(data);

  // Use Playwright to convert HTML to PDF (same as invoice generation)
  // eslint-disable-next-line no-restricted-syntax
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });

    // Wait for Chart.js to render the chart
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      `document.getElementById('revenueChart') !== null`,
      { timeout: 5000 }
    );

    // Give chart a moment to fully render
    await page.waitForTimeout(500);

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '15mm',
        right: '15mm',
      },
    });

    log.info({ sizeKb: Math.round(pdfBuffer.length / 1024) }, 'PDF generated');
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

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
  titleCell.value = `דוח ${data.reportType === 'revenue' ? 'הכנסות' : 'הוצאות'} - ${data.businessName}`;
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
    summarySheet.addRow([`סה"כ ${data.reportType === 'revenue' ? 'הכנסות' : 'הוצאות'} (לפי מטבע)`]);
    summarySheet.getRow(4).font = { bold: true, color: { argb: 'FF2563EB' }, size: 14 };
    data.metrics.currencies.forEach((curr) => {
      const symbol = getCurrencySymbol(curr.currency);
      summarySheet.addRow([curr.currency, `${symbol}${curr.totalRevenue.toLocaleString()}`]);
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

  if (data.metrics.currencies.length === 1) {
    summarySheet.addRow([
      `סה"כ ${data.reportType === 'revenue' ? 'הכנסות' : 'הוצאות'}`,
      `${symbol}${data.metrics.totalRevenue.toLocaleString()}`,
    ]);
  }
  summarySheet.addRow([`מספר חשבוניות (${primaryCurrency.currency})`, data.metrics.invoiceCount]);
  summarySheet.addRow([
    `ממוצע לחשבונית (${primaryCurrency.currency})`,
    `${symbol}${data.metrics.avgInvoice.toFixed(2)}`,
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
  const invoicesSheet = workbook.addWorksheet('חשבוניות');
  invoicesSheet.views = [{ rightToLeft: true }];

  // Header
  invoicesSheet.addRow(['תאריך', 'לקוח', 'סכום', 'מטבע', 'אמצעי תשלום', 'קטגוריה', 'קישור']);
  invoicesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  invoicesSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };

  // Data rows
  data.invoices.forEach((inv) => {
    invoicesSheet.addRow([
      inv.date,
      inv.customerName,
      inv.amount,
      inv.currency,
      inv.paymentMethod,
      inv.category || 'כללי',
      inv.driveLink,
    ]);
  });

  // Column widths
  invoicesSheet.getColumn(1).width = 12; // Date
  invoicesSheet.getColumn(2).width = 30; // Customer
  invoicesSheet.getColumn(3).width = 12; // Amount
  invoicesSheet.getColumn(4).width = 8; // Currency
  invoicesSheet.getColumn(5).width = 15; // Payment method
  invoicesSheet.getColumn(6).width = 20; // Category
  invoicesSheet.getColumn(7).width = 40; // Link

  // Format amount column as currency
  for (let i = 2; i <= data.invoices.length + 1; i++) {
    invoicesSheet.getCell(`C${i}`).numFmt = '₪#,##0.00';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  log.info({ sizeKb: Math.round(buffer.byteLength / 1024) }, 'Excel generated');
  return Buffer.from(buffer);
}

/**
 * Generate CSV report buffer
 */
export async function generateCSVReport(data: ReportData): Promise<Buffer> {
  const log = logger.child({ reportType: data.reportType });
  log.info('Generating CSV report');

  // eslint-disable-next-line no-restricted-syntax
  const { stringify } = await import('csv-stringify/sync');

  // Create CSV data
  const records = [
    // Header with BOM for Excel Hebrew support
    ['תאריך', 'לקוח', 'סכום', 'מטבע', 'אמצעי תשלום', 'קטגוריה', 'קישור'],
    // Data rows
    ...data.invoices.map((inv) => [
      inv.date,
      inv.customerName,
      inv.amount.toString(),
      inv.currency,
      inv.paymentMethod,
      inv.category || 'כללי',
      inv.driveLink,
    ]),
  ];

  const csvString = stringify(records, {
    encoding: 'utf8',
    bom: true, // Add BOM for Excel Hebrew support
  });

  const buffer = Buffer.from(csvString, 'utf8');
  log.info({ sizeKb: Math.round(buffer.length / 1024) }, 'CSV generated');
  return buffer;
}

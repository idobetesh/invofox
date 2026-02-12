/**
 * PDF Report Generator
 * Generates PDF reports from report data using Playwright
 */

import type { ReportData } from '../../../../../../shared/report.types';
import { generateReportHTML } from '../report-template';
import logger from '../../../logger';

/**
 * Generate PDF report buffer
 * Uses Playwright to convert HTML template to PDF
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

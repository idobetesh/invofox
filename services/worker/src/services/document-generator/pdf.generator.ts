/**
 * PDF Generator service
 * Uses Playwright to render HTML to PDF
 * Playwright handles browser binaries and crashpad better than Puppeteer in Docker
 */

import { chromium } from 'playwright';
import type { InvoiceData, BusinessConfig } from '../../../../../shared/types';
import { buildInvoiceHTML } from './template';
import logger from '../../logger';

// Chromium launch arguments for Docker/headless environment
// Playwright handles crashpad and browser setup internally, so we need fewer flags
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-crash-reporter',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
  '--disable-print-preview',
  '--disable-site-isolation-trials',
  '--disable-speech-api',
  '--disable-web-security',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-pings',
  '--no-first-run',
  '--use-gl=swiftshader',
  '--window-size=1920,1080',
  '--font-render-hinting=none',
];

/**
 * Generate PDF from invoice data with business config
 *
 * @param data - Invoice data
 * @param businessConfig - Business configuration
 * @param logoBase64 - Base64-encoded logo image (optional)
 * @returns PDF as Buffer
 */
export async function generateInvoicePDFWithConfig(
  data: InvoiceData,
  businessConfig: BusinessConfig,
  logoBase64?: string | null
): Promise<Buffer> {
  const log = logger.child({ invoiceNumber: data.invoiceNumber });
  log.info('Starting PDF generation with custom config');

  let browser = null;

  try {
    // Launch browser using Playwright
    browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS,
    });

    log.debug('Browser launched');

    // Create new page
    const page = await browser.newPage();

    // Build HTML content with logo
    const html = buildInvoiceHTML(data, businessConfig, logoBase64);

    // Set content with wait for fonts to load
    await page.setContent(html, {
      waitUntil: 'networkidle',
    });

    log.debug('HTML content loaded');

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm',
      },
    });

    log.info({ pdfSize: pdfBuffer.length }, 'PDF generated successfully');

    // Playwright returns Buffer directly
    return pdfBuffer;
  } catch (error) {
    log.error({ error }, 'Failed to generate PDF');
    throw new Error(
      `PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    if (browser) {
      await browser.close();
      log.debug('Browser closed');
    }
  }
}

/**
 * Check if Playwright/Chromium is available
 * Useful for health checks
 */
export async function isBrowserAvailable(): Promise<boolean> {
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS,
    });
    return true;
  } catch {
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

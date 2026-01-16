/**
 * PDF Generator service
 * Uses Puppeteer to render HTML to PDF
 */

import puppeteer from 'puppeteer-core';
import type { InvoiceData, BusinessConfig } from '../../../../../shared/types';
import { buildInvoiceHTML } from './template';
import { getBusinessConfig, getLogoBase64 } from './config.service';
import logger from '../../logger';

// Puppeteer executable path (set via environment variable in Docker)
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

// Chromium launch arguments for Docker/headless environment
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-crash-reporter', // Disable crash reporter (requires --database in Docker)
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--font-render-hinting=none',
];

/**
 * Generate PDF from invoice data
 * Loads business config and logo from Firestore
 * Returns PDF as Buffer
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  const log = logger.child({ invoiceNumber: data.invoiceNumber });
  log.info('Starting PDF generation');

  // Load business config and logo from Firestore
  const [businessConfig, logoBase64] = await Promise.all([getBusinessConfig(), getLogoBase64()]);

  log.debug({ hasLogo: !!logoBase64 }, 'Loaded business config from Firestore');

  let browser = null;

  try {
    // Launch browser
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
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
      waitUntil: 'networkidle0',
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

    // Convert Uint8Array to Buffer
    return Buffer.from(pdfBuffer);
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
 * Generate PDF from invoice data with custom config
 * Used for testing/previewing without Firestore
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
    // Launch browser
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
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
      waitUntil: 'networkidle0',
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

    // Convert Uint8Array to Buffer
    return Buffer.from(pdfBuffer);
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
 * Check if Puppeteer/Chrome is available
 * Useful for health checks
 */
export async function isPuppeteerAvailable(): Promise<boolean> {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
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

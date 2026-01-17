/**
 * PDF Generator service
 * Uses Puppeteer to render HTML to PDF
 */

import puppeteer from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import type { InvoiceData, BusinessConfig } from '../../../../../shared/types';
import { buildInvoiceHTML } from './template';
import { getBusinessConfig, getLogoBase64 } from './config.service';
import logger from '../../logger';

// Puppeteer executable path (set via environment variable in Docker)
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

// Crashpad database directory - ensure it exists and is writable
const CRASHPAD_DIR = process.env.CRASHPAD_DATABASE_DIR || '/app/.crashpad';
const CRASHPAD_DB_DIR = path.join(CRASHPAD_DIR, 'database');

// Ensure crashpad directory exists (called before browser launch)
function ensureCrashpadDirectory(): void {
  try {
    if (!fs.existsSync(CRASHPAD_DIR)) {
      fs.mkdirSync(CRASHPAD_DIR, { recursive: true });
    }
    if (!fs.existsSync(CRASHPAD_DB_DIR)) {
      fs.mkdirSync(CRASHPAD_DB_DIR, { recursive: true });
    }
  } catch (error) {
    // Log but don't fail - Chrome will handle it
    logger.warn({ error, crashpadDir: CRASHPAD_DIR }, 'Failed to create crashpad directory');
  }
}

// Chromium launch arguments for Docker/headless environment
// Note: Using multiple approaches to disable crashpad handler to avoid "chrome_crashpad_handler: --database is required" error
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-crash-reporter',
  '--disable-breakpad', // Alternative crash reporter flag
  '--disable-crashpad', // Disable crashpad handler
  `--crash-dumps-dir=${CRASHPAD_DIR}`, // Provide crashpad database directory (writable by non-root user)
  '--disable-background-networking', // Disable background networking (can trigger crashpad)
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
  '--disable-print-preview',
  '--disable-site-isolation-trials',
  '--disable-speech-api',
  '--disable-web-security',
  '--disk-cache-size=33554432',
  '--enable-features=SharedArrayBuffer',
  '--hide-scrollbars',
  '--ignore-gpu-blocklist',
  '--in-process-gpu',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-pings',
  '--no-first-run',
  '--no-zygote',
  '--use-gl=swiftshader',
  '--window-size=1920,1080',
  // Note: Removed --single-process as it can cause crashpad handler issues
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

  // Ensure crashpad directory exists before launching browser
  ensureCrashpadDirectory();

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

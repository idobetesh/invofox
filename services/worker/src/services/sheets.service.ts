/**
 * Google Sheets service for appending invoice data
 */

import { google, sheets_v4 } from 'googleapis';
import type {
  SheetRow,
  InvoiceExtraction,
  GeneratedInvoiceSheetRow,
} from '../../../../shared/types';
import { getBusinessConfig } from './business-config/config.service';
import { getConfig } from '../config';
import logger from '../logger';
import { DEFAULT_CATEGORY } from './llms/utils';

let sheetsClient: sheets_v4.Sheets | null = null;

const TRANSIENT_SHEETS_ERROR_CODES = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export function isTransientSheetsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as { code?: string; response?: { status?: number } };
  if (err.code && TRANSIENT_SHEETS_ERROR_CODES.has(err.code)) {
    return true;
  }

  const status = err.response?.status;
  return status === 429 || (status !== undefined && status >= 500);
}

export function isMissingTabError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as {
    code?: number;
    message?: string;
    response?: { status?: number; data?: { error?: { message?: string } } };
  };
  const status = err.code ?? err.response?.status;
  if (status !== 400) {
    return false;
  }

  const message = err.message ?? err.response?.data?.error?.message ?? '';
  return message.includes('Unable to parse range') || message.toLowerCase().includes('not found');
}

export function isSheetAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as {
    message?: string;
    response?: { data?: { error?: { message?: string } } };
  };
  const message = (err.message ?? err.response?.data?.error?.message ?? '').toLowerCase();
  return message.includes('already exists') || message.includes('duplicate');
}

async function withSheetsRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientSheetsError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      logger.warn(
        { attempt, maxAttempts, delayMs, label, error },
        'Transient Sheets API error, retrying'
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function getSheets(): sheets_v4.Sheets {
  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

/**
 * Get the Google Sheet ID for a customer
 * Looks up per-customer sheet first, falls back to global sheet if configured
 */
async function getSheetIdForCustomer(chatId: number): Promise<string | null> {
  // Get customer-specific sheet ID from business config
  const businessConfig = await getBusinessConfig(chatId);
  const { sheetId } = businessConfig.business;
  if (sheetId) {
    logger.debug({ chatId, sheetId }, 'Using per-customer sheet');
    return sheetId;
  }

  // No sheet configured - do NOT use global fallback to avoid cross-contamination
  logger.warn({ chatId }, 'No Google Sheet configured for customer - skipping sheet operations');
  return null;
}

/**
 * Column headers for customer sheets (11 columns - without internal metrics)
 */
export const CUSTOMER_SHEET_HEADERS = [
  'Received At',
  'Invoice Date',
  'Amount',
  'Currency',
  'Invoice Number',
  'Vendor Name',
  'Category',
  'Uploader',
  'Chat Name',
  'Link',
  'Status',
];

/**
 * Column headers for admin sheet (14 columns - includes internal metrics)
 */
export const ADMIN_SHEET_HEADERS = [
  ...CUSTOMER_SHEET_HEADERS,
  'LLM Provider',
  'Total Tokens',
  'Cost (USD)',
];

/**
 * Check if sheet is the admin sheet (to include internal metrics)
 */
function isAdminSheet(sheetId: string): boolean {
  const config = getConfig();
  return config.adminSheetId === sheetId;
}

/**
 * Get appropriate headers for a sheet
 */
function getHeadersForSheet(sheetId: string): string[] {
  return isAdminSheet(sheetId) ? ADMIN_SHEET_HEADERS : CUSTOMER_SHEET_HEADERS;
}

/**
 * Format date as DD/MM/YYYY
 * Prefixed with ' to prevent Google Sheets auto-conversion to serial number
 */
function formatDate(isoString: string | null): string {
  if (!isoString) {
    return '?';
  }

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return '?';
    }

    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `'${day}/${month}/${year}`;
  } catch {
    return '?';
  }
}

/**
 * Format datetime as DD/MM/YYYY HH:MM:SS
 * Prefixed with ' to prevent Google Sheets auto-conversion to serial number
 */
function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }

    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `'${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
  } catch {
    return isoString;
  }
}

/**
 * Ensure Invoices tab exists with headers
 */
async function createInvoicesTab(
  sheetId: string,
  headers: string[],
  columnLetter: string,
  isAdmin: boolean
): Promise<void> {
  const sheets = getSheets();

  logger.info({ sheetId }, 'Creating Invoices tab');

  await withSheetsRetry(
    () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: 'Invoices',
                },
              },
            },
          ],
        },
      }),
    'ensureInvoicesTab:create'
  );

  await withSheetsRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Invoices!A1:${columnLetter}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers],
        },
      }),
    'ensureInvoicesTab:headers'
  );

  logger.info(
    { sheetId, isAdmin, columnCount: headers.length },
    'Invoices tab created with headers'
  );
}

async function readInvoicesTabHeaders(
  sheetId: string,
  columnLetter: string
): Promise<sheets_v4.Schema$ValueRange | undefined> {
  const sheets = getSheets();
  const result = await withSheetsRetry(
    () =>
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `Invoices!A1:${columnLetter}1`,
      }),
    'ensureInvoicesTab:get'
  );
  return result.data;
}

async function applyInvoicesTabHeaders(
  sheetId: string,
  headers: string[],
  columnLetter: string,
  isAdmin: boolean,
  response: sheets_v4.Schema$ValueRange | undefined
): Promise<void> {
  const sheets = getSheets();

  if (response?.values && response.values.length > 0 && response.values[0].length > 0) {
    const existingHeaders = response.values[0];
    const headersMatch =
      existingHeaders.length === headers.length &&
      existingHeaders.every((h, i) => h === headers[i]);

    if (headersMatch) {
      return;
    }

    logger.warn(
      {
        sheetId,
        isAdmin,
        existingCount: existingHeaders.length,
        expectedCount: headers.length,
      },
      'Updating sheet headers to match expected format'
    );

    await withSheetsRetry(
      () =>
        sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `Invoices!A1:${columnLetter}1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [headers],
          },
        }),
      'ensureInvoicesTab:updateHeaders'
    );

    logger.info({ sheetId, isAdmin, columnCount: headers.length }, 'Invoices tab headers updated');
    return;
  }

  await withSheetsRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Invoices!A1:${columnLetter}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers],
        },
      }),
    'ensureInvoicesTab:addHeaders'
  );

  logger.info({ sheetId, isAdmin, columnCount: headers.length }, 'Invoices tab headers added');
}

async function ensureInvoicesTab(sheetId: string): Promise<void> {
  const headers = getHeadersForSheet(sheetId);
  const isAdmin = isAdminSheet(sheetId);
  const columnLetter = String.fromCharCode(64 + headers.length); // A=65, K=75 (11 cols), N=78 (14 cols)

  let response: sheets_v4.Schema$ValueRange | undefined;
  try {
    response = await readInvoicesTabHeaders(sheetId, columnLetter);
  } catch (error) {
    if (isMissingTabError(error)) {
      await createInvoicesTab(sheetId, headers, columnLetter, isAdmin);
      return;
    }

    // Fallback: legacy behavior treated any values.get failure as "tab missing".
    // Stream errors can occur even when the tab exists — try create, then re-read.
    logger.warn(
      { sheetId, error },
      'values.get failed after retries, attempting Invoices tab creation fallback'
    );

    try {
      await createInvoicesTab(sheetId, headers, columnLetter, isAdmin);
      return;
    } catch (createError) {
      if (!isSheetAlreadyExistsError(createError)) {
        throw createError;
      }
      logger.info({ sheetId }, 'Invoices tab already exists, re-reading headers');
      response = await readInvoicesTabHeaders(sheetId, columnLetter);
    }
  }

  await applyInvoicesTabHeaders(sheetId, headers, columnLetter, isAdmin, response);
}

/**
 * Append a row to the invoice sheet
 */
export async function appendRow(chatId: number, row: SheetRow): Promise<number | undefined> {
  // Get sheet ID for this customer
  const sheetId = await getSheetIdForCustomer(chatId);

  if (!sheetId) {
    // No sheet configured - THIS IS A CONFIGURATION ERROR
    // Every business MUST have a sheetId configured
    const error = `No Google Sheet configured for customer ${chatId}. Every business must have sheetId in business_config/chat_${chatId}`;
    logger.error({ chatId }, error);
    throw new Error(error);
  }

  const sheets = getSheets();

  // Ensure tab and headers exist
  await ensureInvoicesTab(sheetId);

  // Check if this is admin sheet to determine which columns to include
  const isAdmin = isAdminSheet(sheetId);

  // Build row data - conditionally include internal metrics for admin sheet
  const rowData = [
    row.received_at,
    row.invoice_date,
    row.amount,
    row.currency,
    row.invoice_number,
    row.vendor_name,
    row.category,
    row.uploader,
    row.chat_name,
    row.drive_link,
    row.status,
  ];

  // Add internal metrics only for admin sheet
  if (isAdmin) {
    rowData.push(row.llm_provider, String(row.total_tokens), String(row.cost_usd));
  }

  const values = [rowData];
  const columnLetter = String.fromCharCode(64 + rowData.length);

  logger.debug(
    { chatId, sheetId, isAdmin, columnCount: rowData.length },
    'Appending row to Google Sheet'
  );

  const response = await withSheetsRetry(
    () =>
      sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `Invoices!A:${columnLetter}`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values,
        },
      }),
    'appendRow'
  );

  logger.info('Row appended to Google Sheets');

  // Try to extract row number from updated range
  const updatedRange = response.data.updates?.updatedRange;
  if (updatedRange) {
    const match = updatedRange.match(/(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return undefined;
}

/**
 * Build a SheetRow from processing data
 */
export function buildSheetRow(params: {
  receivedAt: string;
  uploaderUsername: string;
  chatTitle: string;
  driveLink: string;
  extraction: InvoiceExtraction;
  status: 'processed' | 'needs_review';
  llmProvider: 'gemini' | 'openai';
  totalTokens: number;
  costUSD: number;
}): SheetRow {
  return {
    received_at: formatDateTime(params.receivedAt),
    invoice_date: formatDate(params.extraction.invoice_date),
    amount:
      params.extraction.total_amount !== null ? params.extraction.total_amount.toString() : '?',
    currency: params.extraction.currency || '?',
    invoice_number: params.extraction.invoice_number || '?',
    vendor_name: params.extraction.vendor_name || '?',
    category: params.extraction.category || DEFAULT_CATEGORY,
    uploader: params.uploaderUsername || 'unknown',
    chat_name: params.chatTitle || 'private',
    drive_link: params.driveLink,
    status: params.status,
    llm_provider: params.llmProvider,
    total_tokens: params.totalTokens,
    cost_usd: params.costUSD,
  };
}

/**
 * Update specific cells in an existing Invoices row (for corrections)
 * Column mapping (1-indexed): Amount=3(C), InvoiceDate=2(B), VendorName=6(F)
 */
export async function updateRow(
  chatId: number,
  rowNumber: number,
  updates: { amount?: string; invoiceDate?: string; vendorName?: string }
): Promise<void> {
  const sheetId = await getSheetIdForCustomer(chatId);

  if (!sheetId) {
    logger.error({ chatId }, 'No Google Sheet configured for customer - cannot update row');
    throw new Error(`No Google Sheet configured for customer ${chatId}`);
  }

  const sheets = getSheets();

  const data: sheets_v4.Schema$ValueRange[] = [];

  if (updates.amount !== undefined) {
    data.push({ range: `Invoices!C${rowNumber}`, values: [[updates.amount]] });
  }

  if (updates.invoiceDate !== undefined) {
    data.push({ range: `Invoices!B${rowNumber}`, values: [[updates.invoiceDate]] });
  }

  if (updates.vendorName !== undefined) {
    data.push({ range: `Invoices!F${rowNumber}`, values: [[updates.vendorName]] });
  }

  if (data.length === 0) {
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });

  logger.info(
    { chatId, rowNumber, fields: Object.keys(updates) },
    'Sheet row updated (correction)'
  );
}

// ============================================================================
// Generated Invoices Tab
// ============================================================================

const GENERATED_INVOICES_TAB = 'Generated Invoices';

/**
 * Column headers for the Generated Invoices sheet (13 columns)
 */
export const GENERATED_INVOICES_HEADERS = [
  'Invoice #',
  'Type',
  'Date',
  'Customer',
  'Tax ID',
  'Description',
  'Amount',
  'Payment',
  'Generated By',
  'Generated At',
  'PDF Link',
  // New columns (L-M) - appended at end for backward compatibility
  'Currency',
  'Related Invoice',
];

/**
 * Ensure Generated Invoices tab exists with headers
 */
async function ensureGeneratedInvoicesTab(sheetId: string): Promise<void> {
  const sheets = getSheets();

  try {
    // Check if tab exists by trying to read from it
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${GENERATED_INVOICES_TAB}'!A1:M1`, // 13 columns (A-M)
    });

    if (
      response.data.values &&
      response.data.values.length > 0 &&
      response.data.values[0].length > 0
    ) {
      // Tab and headers exist - check if we need to add new columns
      const existingHeaders = response.data.values[0];
      if (existingHeaders.length < GENERATED_INVOICES_HEADERS.length) {
        // Headers exist but missing new columns - update them
        logger.info('Updating Generated Invoices headers to include new columns');
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `'${GENERATED_INVOICES_TAB}'!A1:M1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [GENERATED_INVOICES_HEADERS],
          },
        });
        logger.info('Generated Invoices tab headers updated with new columns');
      }
      return;
    }

    // Tab exists but no headers - add them
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${GENERATED_INVOICES_TAB}'!A1:M1`, // 13 columns (A-M)
      valueInputOption: 'RAW',
      requestBody: {
        values: [GENERATED_INVOICES_HEADERS],
      },
    });

    logger.info('Generated Invoices tab headers added');
  } catch (error) {
    // Tab doesn't exist - create it
    logger.info('Creating Generated Invoices tab');

    // Get spreadsheet to add a new sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: GENERATED_INVOICES_TAB,
              },
            },
          },
        ],
      },
    });

    // Add headers to new tab
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${GENERATED_INVOICES_TAB}'!A1:M1`, // 13 columns (A-M)
      valueInputOption: 'RAW',
      requestBody: {
        values: [GENERATED_INVOICES_HEADERS],
      },
    });

    logger.info('Generated Invoices tab created with headers');
  }
}

/**
 * Append a row to the Generated Invoices sheet tab
 * @param chatId - Customer's Telegram chat ID
 * @param row - Invoice row data to append
 * @param sheetId - Optional sheet ID (if already known, avoids Firestore read)
 */
export async function appendGeneratedInvoiceRow(
  chatId: number,
  row: GeneratedInvoiceSheetRow,
  sheetId?: string
): Promise<number | undefined> {
  // Get sheet ID for this customer (only if not provided)
  const resolvedSheetId = sheetId || (await getSheetIdForCustomer(chatId));

  if (!resolvedSheetId) {
    logger.warn(
      { chatId },
      'Skipping Generated Invoices append - no sheet configured for customer'
    );
    return undefined;
  }

  const sheets = getSheets();

  // Ensure tab and headers exist
  await ensureGeneratedInvoicesTab(resolvedSheetId);

  const values = [
    [
      row.invoice_number,
      row.document_type,
      `'${row.date}`, // Prefix with ' to prevent date conversion
      row.customer_name,
      row.customer_tax_id || '',
      row.description,
      row.amount,
      row.payment_method,
      row.generated_by,
      formatDateTime(row.generated_at),
      row.pdf_link,
      // New columns (L-M) - appended at end for backward compatibility
      row.currency,
      row.related_invoice,
    ],
  ];

  logger.debug(
    { chatId, sheetId: resolvedSheetId },
    'Appending row to customer Generated Invoices tab'
  );

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: resolvedSheetId,
    range: `'${GENERATED_INVOICES_TAB}'!A:M`, // Columns A through M (13 columns)
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values,
    },
  });

  logger.info('Row appended to Generated Invoices tab');

  // Try to extract row number from updated range
  const updatedRange = response.data.updates?.updatedRange;
  if (updatedRange) {
    const match = updatedRange.match(/(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return undefined;
}

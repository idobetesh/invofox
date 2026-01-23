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
async function ensureInvoicesTab(sheetId: string): Promise<void> {
  const sheets = getSheets();
  const headers = getHeadersForSheet(sheetId);
  const isAdmin = isAdminSheet(sheetId);
  const columnLetter = String.fromCharCode(64 + headers.length); // A=65, K=75 (11 cols), N=78 (14 cols)

  try {
    // Check if tab exists by trying to read from it
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `Invoices!A1:${columnLetter}1`,
    });

    if (
      response.data.values &&
      response.data.values.length > 0 &&
      response.data.values[0].length > 0
    ) {
      // Tab exists - check if headers match expected format
      const existingHeaders = response.data.values[0];
      const headersMatch =
        existingHeaders.length === headers.length &&
        existingHeaders.every((h, i) => h === headers[i]);

      if (headersMatch) {
        // Headers are correct
        return;
      }

      // Headers don't match - update them (migration support)
      logger.warn(
        {
          sheetId,
          isAdmin,
          existingCount: existingHeaders.length,
          expectedCount: headers.length,
        },
        'Updating sheet headers to match expected format'
      );

      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Invoices!A1:${columnLetter}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers],
        },
      });

      logger.info(
        { sheetId, isAdmin, columnCount: headers.length },
        'Invoices tab headers updated'
      );
      return;
    }

    // Tab exists but no headers - add them
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Invoices!A1:${columnLetter}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });

    logger.info({ sheetId, isAdmin, columnCount: headers.length }, 'Invoices tab headers added');
  } catch (error) {
    // Tab doesn't exist - create it
    logger.info('Creating Invoices tab');

    // Create the Invoices tab
    await sheets.spreadsheets.batchUpdate({
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
    });

    // Add headers to new tab
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Invoices!A1:${columnLetter}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });

    logger.info(
      { sheetId, isAdmin, columnCount: headers.length },
      'Invoices tab created with headers'
    );
  }
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

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `Invoices!A:${columnLetter}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values,
    },
  });

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

// ============================================================================
// Generated Invoices Tab
// ============================================================================

const GENERATED_INVOICES_TAB = 'Generated Invoices';

/**
 * Column headers for the Generated Invoices sheet (11 columns)
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
      range: `'${GENERATED_INVOICES_TAB}'!A1:K1`,
    });

    if (
      response.data.values &&
      response.data.values.length > 0 &&
      response.data.values[0].length > 0
    ) {
      // Tab and headers already exist
      return;
    }

    // Tab exists but no headers - add them
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${GENERATED_INVOICES_TAB}'!A1:K1`,
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
      range: `'${GENERATED_INVOICES_TAB}'!A1:K1`,
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
    ],
  ];

  logger.debug(
    { chatId, sheetId: resolvedSheetId },
    'Appending row to customer Generated Invoices tab'
  );

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: resolvedSheetId,
    range: `'${GENERATED_INVOICES_TAB}'!A:K`, // Columns A through K (11 columns)
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

/**
 * Google Sheets service for appending invoice data
 */

import { google, sheets_v4 } from 'googleapis';
import type { SheetRow, InvoiceExtraction } from '../../../../shared/types';
import { getConfig } from '../config';
import logger from '../logger';

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
 * Column headers for the invoice sheet (13 columns)
 */
export const SHEET_HEADERS = [
  'Received At',
  'Invoice Date',
  'Amount',
  'Currency',
  'Invoice Number',
  'Vendor Name',
  'Uploader',
  'Chat Name',
  'Link',
  'Status',
  'LLM Provider',
  'Total Tokens',
  'Cost (USD)',
];

/**
 * Format date as DD/MM/YYYY
 * Prefixed with ' to prevent Google Sheets auto-conversion to serial number
 */
function formatDate(isoString: string | null): string {
  if (!isoString) {return '?';}
  
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {return '?';}
    
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
    if (isNaN(date.getTime())) {return isoString;}
    
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
 * Ensure sheet has headers (auto-add if first row is empty)
 */
async function ensureHeaders(): Promise<void> {
  const config = getConfig();
  const sheets = getSheets();

  // Check if sheet has data in first row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: 'Sheet1!A1:M1',
  });

  if (response.data.values && response.data.values.length > 0 && response.data.values[0].length > 0) {
    // Headers already exist
    return;
  }

  // Add headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: 'Sheet1!A1:M1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [SHEET_HEADERS],
    },
  });

  logger.info('Sheet headers added automatically');
}

/**
 * Append a row to the invoice sheet
 */
export async function appendRow(row: SheetRow): Promise<number | undefined> {
  const config = getConfig();
  const sheets = getSheets();

  // Ensure headers exist
  await ensureHeaders();

  const values = [
    [
      row.received_at,
      row.invoice_date,
      row.amount,
      row.currency,
      row.invoice_number,
      row.vendor_name,
      row.uploader,
      row.chat_name,
      row.drive_link,
      row.status,
      row.llm_provider,
      row.total_tokens,
      row.cost_usd,
    ],
  ];

  logger.debug('Appending row to Google Sheets');

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: 'Sheet1!A:M', // Columns A through M (13 columns)
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
    amount: params.extraction.total_amount !== null ? params.extraction.total_amount.toString() : '?',
    currency: params.extraction.currency || '?',
    invoice_number: params.extraction.invoice_number || '?',
    vendor_name: params.extraction.vendor_name || '?',
    uploader: params.uploaderUsername || 'unknown',
    chat_name: params.chatTitle || 'private',
    drive_link: params.driveLink,
    status: params.status,
    llm_provider: params.llmProvider,
    total_tokens: params.totalTokens,
    cost_usd: params.costUSD,
  };
}

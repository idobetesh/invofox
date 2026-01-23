/**
 * Google Sheets Verification Service
 * Handles verification of Google Sheets access
 */

import { google } from 'googleapis';
import logger from '../../logger';

/**
 * Test if we can access the Google Sheet
 * @returns Array of tab names if successful
 * @throws Error if sheet cannot be accessed
 */
export async function verifySheetAccess(sheetId: string): Promise<string[]> {
  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
    });

    // Get tab names
    const tabNames =
      response.data.sheets?.map((sheet) => sheet.properties?.title || 'Untitled') || [];

    return tabNames;
  } catch (error) {
    logger.error({ error, sheetId }, 'Failed to verify sheet access');
    throw error;
  }
}

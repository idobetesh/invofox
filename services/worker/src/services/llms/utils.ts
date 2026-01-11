/**
 * Shared utilities for LLM providers
 */

import type { InvoiceExtraction } from '../../../../../shared/types';
import logger from '../../logger';

/**
 * Valid business expense categories
 */
export const VALID_CATEGORIES = [
  'Food',
  'Transport',
  'Office Supplies',
  'Utilities',
  'Professional Services',
  'Marketing',
  'Technology',
  'Travel',
  'Entertainment',
  'Miscellaneous',
] as const;

/**
 * Default category when extraction fails or returns invalid value
 */
export const DEFAULT_CATEGORY = 'Miscellaneous' as const;

/**
 * Get MIME type from file extension
 */
export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return mimeTypes[extension.toLowerCase()] || 'image/jpeg';
}

/**
 * Normalize and validate extraction result
 */
export function normalizeExtraction(raw: Partial<InvoiceExtraction>): InvoiceExtraction {
  return {
    vendor_name: typeof raw.vendor_name === 'string' ? raw.vendor_name : null,
    invoice_number: typeof raw.invoice_number === 'string' ? raw.invoice_number : null,
    invoice_date: normalizeDate(raw.invoice_date),
    total_amount: typeof raw.total_amount === 'number' ? raw.total_amount : null,
    currency: typeof raw.currency === 'string' ? raw.currency.toUpperCase() : null,
    vat_amount: typeof raw.vat_amount === 'number' ? raw.vat_amount : null,
    confidence: typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.5,
    category: normalizeCategory(raw.category),
  };
}

/**
 * Normalize and validate category
 * Always returns a valid category - defaults to DEFAULT_CATEGORY for null/invalid input
 */
function normalizeCategory(category: unknown): string {
  if (typeof category !== 'string' || !category) {
    return DEFAULT_CATEGORY;
  }

  const categoryTrimmed = category.trim();

  // Case-insensitive match to handle LLM variations
  const matchedCategory = VALID_CATEGORIES.find(
    (cat) => cat.toLowerCase() === categoryTrimmed.toLowerCase()
  );

  return matchedCategory || DEFAULT_CATEGORY;
}

/**
 * Normalize date to ISO format
 * Handles various formats common in Hebrew/Israeli invoices
 */
export function normalizeDate(date: unknown): string | null {
  if (typeof date !== 'string' || !date) {
    return null;
  }

  const cleanDate = date.trim();

  // Already in ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return cleanDate;
  }

  // DD/MM/YYYY format (slashes)
  const ddmmyyyySlash = cleanDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyySlash) {
    const [, day, month, year] = ddmmyyyySlash;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD.MM.YYYY format (dots - common in Israel)
  const ddmmyyyyDot = cleanDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyyDot) {
    const [, day, month, year] = ddmmyyyyDot;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // MM.YYYY or MM/YYYY format (just month/year - use day 01)
  const mmyyyy = cleanDate.match(/^(\d{1,2})[./](\d{4})$/);
  if (mmyyyy) {
    const [, month, year] = mmyyyy;
    return `${year}-${month.padStart(2, '0')}-01`;
  }

  // Date range like "09/11/2025-08/12/2025" - take the END date
  const dateRange = cleanDate.match(
    /(\d{1,2})[./](\d{1,2})[./](\d{4})[-–](\d{1,2})[./](\d{1,2})[./](\d{4})/
  );
  if (dateRange) {
    const [, , , , endDay, endMonth, endYear] = dateRange;
    return `${endYear}-${endMonth.padStart(2, '0')}-${endDay.padStart(2, '0')}`;
  }

  // Try to parse as Date
  try {
    const parsed = new Date(cleanDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  } catch {
    // Ignore parsing errors
  }

  logger.debug({ rawDate: date }, 'Could not parse date format');
  return null;
}

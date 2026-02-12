/**
 * Date Utilities for Reports
 * Handles date range presets and formatting
 */

import type { DateRange } from '../../../../../../shared/report.types';

/**
 * Get date range for preset
 */
export function getDateRangeForPreset(preset: string): DateRange {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  switch (preset) {
    case 'this_month': {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0); // Last day of month
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'this_month',
      };
    }
    case 'last_month': {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'last_month',
      };
    }
    case 'ytd': {
      // Year-to-Date: Jan 1 to today
      const start = new Date(year, 0, 1);
      const end = new Date(year, month, now.getDate());
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'ytd',
      };
    }
    default:
      throw new Error(`Unknown preset: ${preset}`);
  }
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

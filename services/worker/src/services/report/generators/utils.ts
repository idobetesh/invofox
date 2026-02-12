/**
 * Base Generator Utilities
 * Shared helper functions for all report generators
 */

/**
 * Get currency symbol for display (used in Excel/CSV generation)
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    ILS: '₪',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  };
  return symbols[currency] || currency + ' ';
}

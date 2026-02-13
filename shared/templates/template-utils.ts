/**
 * Shared Template Utilities
 * Common helper functions used across all document templates
 */

/**
 * Get currency symbol
 * Maps currency codes to their symbols
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    ILS: '₪',
    USD: '$',
    EUR: '€',
  };
  return symbols[currency] || currency;
}

/**
 * Escape HTML to prevent XSS
 * Sanitizes user input before injecting into HTML templates
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Format number with commas and decimal places
 * Examples: 1234 => "1,234.00", 1234.5 => "1,234.50"
 */
export function formatAmount(amount: number, decimals: number = 2): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

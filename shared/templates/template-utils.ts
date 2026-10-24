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

/** Only raster data or uploaded GCS logos may be embedded in generated documents. */
export function getSafeLogoUrl(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'storage.googleapis.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[a-z0-9._-]+\/logos\/.+\.(?:png|jpe?g|webp)$/i.test(url.pathname)
    ) {
      return url.href;
    }
  } catch {
    // Invalid or unsafe logo sources fall back to the existing placeholder.
  }
  return undefined;
}

// Document HTML requires styles/images, but never scripts, frames, forms, or connections.
export const DOCUMENT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https://storage.googleapis.com; base-uri 'none'; form-action 'none'";

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

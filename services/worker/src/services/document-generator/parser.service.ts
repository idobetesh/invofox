/**
 * Invoice Parser Service
 * Parses invoice details from text input
 */

export interface ParsedDetails {
  customerName: string;
  amount: number;
  description: string;
  customerTaxId?: string;
}

/**
 * Parse invoice details from message
 * Format: name, amount, description[, tax_id (optional)]
 */
export function parseInvoiceDetails(text: string): ParsedDetails | null {
  const parts = text.split(',').map((p) => p.trim());

  if (parts.length < 3) {
    return null;
  }

  const customerName = parts[0];
  const amountStr = parts[1];

  // Check if 4th field (tax ID) is provided
  let description: string;
  let customerTaxId: string | undefined;

  if (parts.length >= 4) {
    // Tax ID is the last field, description is everything in between
    description = parts.slice(2, parts.length - 1).join(', ');
    customerTaxId = parts[parts.length - 1];

    // If tax ID is empty or looks invalid, treat it as part of description
    if (!customerTaxId || customerTaxId.length === 0) {
      description = parts.slice(2).join(', ');
      customerTaxId = undefined;
    }
  } else {
    // No tax ID, description is everything after amount
    description = parts.slice(2).join(', ');
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return null;
  }

  return { customerName, amount, description, customerTaxId };
}

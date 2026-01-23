/**
 * Fast Path Invoice Parser
 * Parses invoice commands in format: /invoice [amount] [customer] [payment]
 */

import type { PaymentMethod } from '../../../../../shared/types';

const VALID_PAYMENT_METHODS: PaymentMethod[] = ['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק'];

export interface FastPathInvoice {
  customerName: string;
  amount: number;
  description: string;
  paymentMethod: PaymentMethod;
}

/**
 * Parse fast-path invoice command
 * Format: /invoice name, amount, description, payment_method
 * Example: /invoice John Doe, 500, Services, מזומן
 */
export function parseFastPathCommand(text: string): FastPathInvoice | null {
  // Remove /invoice prefix
  const args = text.replace(/^\/invoice\s*/i, '').trim();

  if (!args) {
    return null;
  }

  // Split by comma
  const parts = args.split(',').map((p) => p.trim());

  if (parts.length < 4) {
    return null;
  }

  const customerName = parts[0];
  const amountStr = parts[1];
  const description = parts[2];
  const paymentMethodStr = parts[3];

  // Parse amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return null;
  }

  // Validate payment method
  const paymentMethod = VALID_PAYMENT_METHODS.find(
    (m) => m.toLowerCase() === paymentMethodStr.toLowerCase()
  );
  if (!paymentMethod) {
    return null;
  }

  return { customerName, amount, description, paymentMethod };
}

/**
 * Check if text is a fast-path command
 */
export function isFastPathCommand(text: string): boolean {
  return parseFastPathCommand(text) !== null;
}

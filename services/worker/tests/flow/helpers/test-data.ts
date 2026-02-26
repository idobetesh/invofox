/**
 * Test data fixtures and seed helpers for flow tests.
 *
 * Usage:
 *   seedOpenInvoice(db, CHAT_ID, { invoiceNumber: 'I-2024-001', customerName: 'Acme', amount: 500 });
 */

import { InMemoryFirestore } from './in-memory-firestore';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Group chat ID used across all flow tests */
export const CHAT_ID = -100100100;

/** User ID used across all flow tests */
export const USER_ID = 200200200;

export const USERNAME = 'testuser';

// ─── Mock timestamp factory ──────────────────────────────────────────────────

/** Minimal Firestore-compatible timestamp for seeding */
export function mockTimestamp(ms = Date.now()): { toMillis: () => number; toDate: () => Date } {
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

// ─── Seed helpers ────────────────────────────────────────────────────────────

export interface OpenInvoiceOptions {
  invoiceNumber: string;
  customerName: string;
  amount: number;
  remainingBalance?: number;
  paidAmount?: number;
  paymentStatus?: 'unpaid' | 'partial';
  currency?: string;
  date?: string;
}

/**
 * Seed a generated invoice document that is "open" (unpaid or partial).
 * Used to populate the invoice selection keyboard in receipt flow tests.
 */
export function seedOpenInvoice(
  db: InMemoryFirestore,
  chatId: number,
  options: OpenInvoiceOptions
): void {
  const {
    invoiceNumber,
    customerName,
    amount,
    remainingBalance = amount,
    paidAmount = 0,
    paymentStatus = 'unpaid',
    currency = 'ILS',
    date = '01/01/2024',
  } = options;

  db.seed('generated_invoices', `chat_${chatId}_${invoiceNumber}`, {
    chatId,
    invoiceNumber,
    documentType: 'invoice',
    paymentStatus,
    customerName,
    amount,
    remainingBalance,
    paidAmount,
    date,
    generatedAt: mockTimestamp(),
    currency,
  });
}

/**
 * Seed multiple open invoices at once.
 */
export function seedOpenInvoices(
  db: InMemoryFirestore,
  chatId: number,
  invoices: OpenInvoiceOptions[]
): void {
  for (const inv of invoices) {
    seedOpenInvoice(db, chatId, inv);
  }
}

/**
 * Expected button text for an invoice in the selection keyboard.
 * Mirrors formatInvoiceForButton() in open-invoices.service.ts.
 */
export function invoiceButtonText(
  invoiceNumber: string,
  customerName: string,
  remainingBalance: number,
  currency = 'ILS'
): string {
  const symbol = currency === 'ILS' ? '₪' : currency;
  return `${invoiceNumber} | ${customerName} | ${symbol}${remainingBalance}`;
}

/**
 * Return the session document ID used in invoice_sessions collection.
 */
export function sessionDocId(chatId: number, userId: number): string {
  return `${chatId}_${userId}`;
}

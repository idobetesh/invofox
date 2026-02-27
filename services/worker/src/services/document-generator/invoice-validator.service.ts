/**
 * Invoice Validator Service
 * Validation logic for invoice generation sessions
 */

import type { GeneratedInvoice, InvoiceSession } from '../../../../../shared/types';
import { getGeneratedInvoice } from './invoice-store.service';
import logger from '../../logger';

/**
 * Validate required session fields and document-type-specific constraints
 * @throws Error if any required field is missing or invalid
 */
export function validateSessionFields(session: InvoiceSession): void {
  if (
    !session.documentType ||
    !session.customerName ||
    !session.description ||
    session.amount === undefined ||
    !session.date
  ) {
    throw new Error('Invoice session is incomplete - missing required fields');
  }

  // For invoice-receipts and receipts, paymentMethod is required (payment already made)
  // For invoices, paymentMethod is optional (not yet paid)
  if (
    (session.documentType === 'invoice_receipt' || session.documentType === 'receipt') &&
    !session.paymentMethod
  ) {
    throw new Error('Payment method is required for invoice-receipts and receipts');
  }

  // Validate documentType is valid
  if (!['invoice', 'receipt', 'invoice_receipt'].includes(session.documentType)) {
    throw new Error(`Invalid document type: ${session.documentType}`);
  }
}

/**
 * Validate and fetch parent invoices for a receipt
 * Returns the fetched parent invoices so the orchestrator doesn't need to re-fetch them
 * @param chatId - Customer's Telegram chat ID
 * @param session - Invoice session (must be a receipt session)
 * @returns Fetched parent invoices
 * @throws Error if invoices are not found, inconsistent, or already fully paid
 */
export async function validateParentInvoices(
  chatId: number,
  session: InvoiceSession
): Promise<GeneratedInvoice[]> {
  const log = logger.child({ chatId });

  if (session.selectedInvoiceNumbers && session.selectedInvoiceNumbers.length >= 1) {
    const invoiceNumbers = session.selectedInvoiceNumbers;

    if (invoiceNumbers.length < 1 || invoiceNumbers.length > 10) {
      throw new Error(
        `Invalid number of invoices selected: ${invoiceNumbers.length}. Must be between 1 and 10.`
      );
    }

    // Fetch all parent invoices in parallel
    const parentInvoices = await Promise.all(
      invoiceNumbers.map((num) => getGeneratedInvoice(chatId, num))
    ).then((invoices) => invoices.filter((inv): inv is GeneratedInvoice => inv !== null));

    if (parentInvoices.length !== invoiceNumbers.length) {
      throw new Error('One or more parent invoices not found');
    }

    // Validate customer consistency (only for multi-invoice)
    if (invoiceNumbers.length >= 2) {
      const firstCustomer = parentInvoices[0].customerName;
      const allSameCustomer = parentInvoices.every((inv) => inv.customerName === firstCustomer);
      if (!allSameCustomer) {
        throw new Error('All invoices must belong to the same customer');
      }
    }

    // Validate all have remaining balance > 0
    const invalidInvoices = parentInvoices.filter(
      (inv) => (inv.remainingBalance ?? inv.amount) <= 0
    );
    if (invalidInvoices.length > 0) {
      throw new Error(
        `Invoices already paid: ${invalidInvoices.map((i) => i.invoiceNumber).join(', ')}`
      );
    }

    log.debug(
      {
        invoiceCount: parentInvoices.length,
        invoiceNumbers,
      },
      invoiceNumbers.length === 1
        ? 'Fetched parent invoice for single-invoice receipt'
        : 'Fetched parent invoices for multi-invoice receipt'
    );

    return parentInvoices;
  } else if (session.relatedInvoiceNumber) {
    // LEGACY: Old receipts created before multi-select (for backward compatibility)
    const parentInvoice = await getGeneratedInvoice(chatId, session.relatedInvoiceNumber);
    if (!parentInvoice) {
      throw new Error(`Parent invoice ${session.relatedInvoiceNumber} not found`);
    }
    log.debug(
      { parentInvoice: session.relatedInvoiceNumber },
      'Fetched parent invoice for legacy receipt'
    );
    return [parentInvoice];
  } else {
    throw new Error('Receipt must have related invoice number(s)');
  }
}

/**
 * Validate that the payment amount does not exceed the total remaining balance
 * Partial payments (amount < total) are allowed; overpayments are not
 * @param amount - Payment amount from the session
 * @param parentInvoices - Fetched parent invoices with remaining balances
 * @throws Error if payment exceeds total remaining balance
 */
export function validatePaymentAmount(amount: number, parentInvoices: GeneratedInvoice[]): void {
  const expectedTotal = parentInvoices.reduce(
    (sum, inv) => sum + (inv.remainingBalance ?? inv.amount),
    0
  );
  if (amount - expectedTotal > 0.01) {
    // Allow small floating point differences
    throw new Error(
      `Payment amount exceeds total remaining balance. Max: ${expectedTotal}, Got: ${amount}`
    );
  }
}

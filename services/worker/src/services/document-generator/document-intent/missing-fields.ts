/**
 * Server-side missing field computation (never trust model alone)
 */

import type {
  DocumentIntent,
  DocumentIntentMissingField,
} from '../../../../../../shared/document-intent.types';

export function computeMissingFields(
  intent: Pick<
    DocumentIntent,
    'documentType' | 'customerName' | 'amount' | 'description' | 'paymentMethod' | 'currency'
  >
): DocumentIntentMissingField[] {
  const missing: DocumentIntentMissingField[] = [];

  if (!intent.documentType) {
    missing.push('documentType');
  } else if (intent.documentType === 'receipt') {
    missing.push('unsupported_type_v1');
  }

  if (!intent.customerName?.trim()) {
    missing.push('customerName');
  }

  if (intent.amount === null || intent.amount === undefined || intent.amount <= 0) {
    missing.push('amount');
  }

  if (!intent.description?.trim()) {
    missing.push('description');
  }

  if (intent.documentType === 'invoice_receipt' && !intent.paymentMethod) {
    missing.push('paymentMethod');
  }

  if (!intent.currency) {
    missing.push('currency');
  }

  return missing;
}

export function hasBlockingMissingFields(missing: DocumentIntentMissingField[]): boolean {
  return missing.some((f) => f !== 'unsupported_type_v1');
}

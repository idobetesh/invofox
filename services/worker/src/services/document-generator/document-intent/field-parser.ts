/**
 * Parse user text when editing a single NL document field
 */

import type { InvoiceDocumentType, PaymentMethod } from '../../../../../../shared/types';
import type { NlDocumentEditField } from '../../../../../../shared/document-intent.types';

const PAYMENT_ALIASES: Record<string, PaymentMethod> = {
  מזומן: 'מזומן',
  cash: 'מזומן',
  ביט: 'ביט',
  bit: 'ביט',
  paybox: 'PayBox',
  PayBox: 'PayBox',
  העברה: 'העברה',
  transfer: 'העברה',
  אשראי: 'אשראי',
  credit: 'אשראי',
  "צ'ק": 'צ׳ק',
  'צ׳ק': 'צ׳ק',
  check: 'צ׳ק',
};

const DOC_TYPE_ALIASES: Record<string, InvoiceDocumentType> = {
  invoice: 'invoice',
  חשבונית: 'invoice',
  invoice_receipt: 'invoice_receipt',
  'חשבונית-קבלה': 'invoice_receipt',
  'חשבונית קבלה': 'invoice_receipt',
};

export type FieldParseResult =
  | { ok: true; value: string | number | InvoiceDocumentType | PaymentMethod }
  | { ok: false; errorKey: string };

export function parseFieldEdit(field: NlDocumentEditField, text: string): FieldParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, errorKey: 'nl.emptyField' };
  }

  switch (field) {
    case 'customerName':
    case 'description':
      return { ok: true, value: trimmed };
    case 'amount': {
      const normalized = trimmed
        .replace(/,/g, '')
        .replace(/₪|שח|ש״ח/gi, '')
        .trim();
      const amount = parseFloat(normalized);
      if (Number.isNaN(amount) || amount <= 0) {
        return { ok: false, errorKey: 'invoice.invalidAmount' };
      }
      return { ok: true, value: amount };
    }
    case 'documentType': {
      const key = trimmed.toLowerCase();
      const docType = DOC_TYPE_ALIASES[trimmed] || DOC_TYPE_ALIASES[key];
      if (!docType || docType === 'receipt') {
        return { ok: false, errorKey: 'nl.unsupportedDocType' };
      }
      return { ok: true, value: docType };
    }
    case 'paymentMethod': {
      const payment = PAYMENT_ALIASES[trimmed] || PAYMENT_ALIASES[trimmed.toLowerCase()];
      if (!payment) {
        return { ok: false, errorKey: 'nl.invalidPayment' };
      }
      return { ok: true, value: payment };
    }
    default:
      return { ok: false, errorKey: 'nl.emptyField' };
  }
}

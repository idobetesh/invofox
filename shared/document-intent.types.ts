/**
 * Natural-language document creation intent (voice / text → structured fields)
 */

import type { InvoiceDocumentType, PaymentMethod } from './invoice.types';

export type DocumentIntentMissingField =
  | 'documentType'
  | 'customerName'
  | 'amount'
  | 'description'
  | 'paymentMethod'
  | 'relatedInvoiceNumber'
  | 'currency'
  | 'unsupported_type_v1';

export type NlDocumentEditField =
  | 'customerName'
  | 'description'
  | 'amount'
  | 'documentType'
  | 'paymentMethod';

export interface DocumentIntent {
  documentType: InvoiceDocumentType | null;
  customerName: string | null;
  amount: number | null;
  description: string | null;
  currency: 'ILS' | 'USD' | 'EUR';
  customerTaxId: string | null;
  paymentMethod: PaymentMethod | null;
  transcript: string;
  confidence: number;
  missingFields: DocumentIntentMissingField[];
}

export interface DocumentIntentUsage {
  provider: 'gemini' | 'openai';
  totalTokens: number;
  costUSD: number;
  fallbackFrom?: 'gemini';
  fallbackReason?: string;
}

export interface DocumentIntentResult {
  intent: DocumentIntent;
  usage: DocumentIntentUsage;
}

/**
 * Zod schema for document intent LLM output
 */

import { z } from 'zod';
import type { DocumentIntent } from '../../../../../../shared/document-intent.types';
import { computeMissingFields } from './missing-fields';

const paymentMethodSchema = z.enum(['מזומן', 'ביט', 'PayBox', 'העברה', 'אשראי', 'צ׳ק']);

export const documentIntentRawSchema = z.object({
  documentType: z.enum(['invoice', 'invoice_receipt', 'receipt']).nullable(),
  customerName: z.string().nullable(),
  amount: z.number().nullable(),
  description: z.string().nullable(),
  customerTaxId: z.string().nullable().optional().default(null),
  paymentMethod: paymentMethodSchema.nullable().optional().default(null),
  currency: z.enum(['ILS', 'USD', 'EUR']).default('ILS'),
  transcript: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type DocumentIntentRaw = z.infer<typeof documentIntentRawSchema>;

export function normalizeDocumentIntent(raw: DocumentIntentRaw): DocumentIntent {
  const intent: DocumentIntent = {
    documentType: raw.documentType,
    customerName: raw.customerName?.trim() || null,
    amount: raw.amount,
    description: raw.description?.trim() || null,
    customerTaxId: raw.customerTaxId?.trim() || null,
    paymentMethod: raw.paymentMethod,
    currency: raw.currency,
    transcript: raw.transcript?.trim() || '',
    confidence: raw.confidence,
    missingFields: [],
  };

  intent.missingFields = computeMissingFields(intent);
  return intent;
}

export function parseDocumentIntentJson(text: string): DocumentIntent {
  const jsonText = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const parsed = documentIntentRawSchema.parse(JSON.parse(jsonText));
  return normalizeDocumentIntent(parsed);
}

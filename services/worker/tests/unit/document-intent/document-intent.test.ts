/**
 * Document intent parsing unit tests (no live LLM calls)
 */

import {
  computeMissingFields,
  hasBlockingMissingFields,
  parseFieldEdit,
} from '../../../src/services/document-generator/document-intent';
import {
  normalizeDocumentIntent,
  parseDocumentIntentJson,
} from '../../../src/services/document-generator/document-intent/schema';

describe('document intent schema', () => {
  it('parses valid JSON and recomputes missingFields', () => {
    const intent = parseDocumentIntentJson(
      JSON.stringify({
        documentType: 'invoice_receipt',
        customerName: 'משה',
        amount: 300,
        description: 'ספר',
        customerTaxId: null,
        paymentMethod: null,
        currency: 'ILS',
        transcript: 'תוציא חשבונית קבלה למשה',
        confidence: 0.9,
      })
    );

    expect(intent.documentType).toBe('invoice_receipt');
    expect(intent.missingFields).toContain('paymentMethod');
    expect(intent.missingFields).not.toContain('customerName');
  });

  it('flags receipt as unsupported in v1', () => {
    const intent = normalizeDocumentIntent({
      documentType: 'receipt',
      customerName: 'דני',
      amount: 100,
      description: 'שירות',
      customerTaxId: null,
      paymentMethod: 'מזומן',
      currency: 'ILS',
      transcript: 'קבלה',
      confidence: 0.8,
    });

    expect(intent.missingFields).toContain('unsupported_type_v1');
  });
});

describe('computeMissingFields', () => {
  it('requires core fields for invoice', () => {
    const missing = computeMissingFields({
      documentType: 'invoice',
      customerName: null,
      amount: null,
      description: null,
      paymentMethod: null,
      currency: 'ILS',
    });

    expect(missing).toEqual(expect.arrayContaining(['customerName', 'amount', 'description']));
    expect(missing).not.toContain('paymentMethod');
  });
});

describe('hasBlockingMissingFields', () => {
  it('ignores unsupported_type_v1 as blocking for proceed when alone', () => {
    expect(hasBlockingMissingFields(['unsupported_type_v1'])).toBe(false);
    expect(hasBlockingMissingFields(['unsupported_type_v1', 'amount'])).toBe(true);
  });
});

describe('parseFieldEdit', () => {
  it('parses amount with shekel suffix', () => {
    const result = parseFieldEdit('amount', '300 שח');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(300);
    }
  });

  it('rejects receipt document type in NL edit', () => {
    const result = parseFieldEdit('documentType', 'קבלה');
    expect(result.ok).toBe(false);
  });
});

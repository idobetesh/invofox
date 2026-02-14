/**
 * Tests for Invoice Sheet Helpers
 * CRITICAL: These tests verify Google Sheets logging works correctly
 */

import { getRelatedInvoice } from '../../src/services/document-generator/invoice-sheet-helpers';
import type { InvoiceSession } from '../../../../shared/types';

describe('Invoice Sheet Helpers', () => {
  describe('getRelatedInvoice', () => {
    it('should return empty string for invoices', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'invoice',
      };

      const result = getRelatedInvoice('invoice', session as InvoiceSession);

      expect(result).toBe('');
    });

    it('should return empty string for invoice-receipts', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'invoice_receipt',
      };

      const result = getRelatedInvoice('invoice_receipt', session as InvoiceSession);

      expect(result).toBe('');
    });

    it('should return single invoice number for single-invoice receipt (NEW flow)', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'receipt',
        selectedInvoiceNumbers: ['I-2026-100'],
      };

      const result = getRelatedInvoice('receipt', session as InvoiceSession);

      expect(result).toBe('I-2026-100');
    });

    it('should return comma-separated list for multi-invoice receipt (2 invoices)', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'receipt',
        selectedInvoiceNumbers: ['I-2026-100', 'I-2026-101'],
      };

      const result = getRelatedInvoice('receipt', session as InvoiceSession);

      expect(result).toBe('I-2026-100, I-2026-101');
    });

    it('should return comma-separated list for multi-invoice receipt (10 invoices)', () => {
      const invoiceNumbers = Array.from({ length: 10 }, (_, i) => `I-2026-${100 + i}`);
      const session: Partial<InvoiceSession> = {
        documentType: 'receipt',
        selectedInvoiceNumbers: invoiceNumbers,
      };

      const result = getRelatedInvoice('receipt', session as InvoiceSession);

      expect(result).toBe(
        'I-2026-100, I-2026-101, I-2026-102, I-2026-103, I-2026-104, I-2026-105, I-2026-106, I-2026-107, I-2026-108, I-2026-109'
      );
    });

    it('should return legacy relatedInvoiceNumber if selectedInvoiceNumbers is not set', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'receipt',
        relatedInvoiceNumber: 'I-2026-OLD',
      };

      const result = getRelatedInvoice('receipt', session as InvoiceSession);

      expect(result).toBe('I-2026-OLD');
    });

    it('should prioritize selectedInvoiceNumbers over relatedInvoiceNumber', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'receipt',
        selectedInvoiceNumbers: ['I-2026-100'],
        relatedInvoiceNumber: 'I-2026-OLD', // Should be ignored
      };

      const result = getRelatedInvoice('receipt', session as InvoiceSession);

      expect(result).toBe('I-2026-100');
    });

    it('should return empty string if receipt has no related invoice fields', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'receipt',
        // No selectedInvoiceNumbers or relatedInvoiceNumber
      };

      const result = getRelatedInvoice('receipt', session as InvoiceSession);

      expect(result).toBe('');
    });

    it('should handle empty selectedInvoiceNumbers array', () => {
      const session: Partial<InvoiceSession> = {
        documentType: 'receipt',
        selectedInvoiceNumbers: [],
      };

      const result = getRelatedInvoice('receipt', session as InvoiceSession);

      expect(result).toBe('');
    });
  });
});

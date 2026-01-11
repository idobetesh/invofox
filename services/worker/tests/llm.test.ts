import { needsReview } from '../src/services/llm.service';
import type { InvoiceExtraction } from '../../../shared/types';

describe('LLM Utilities', () => {
  describe('needsReview', () => {
    it('should return false for high confidence extraction with all fields', () => {
      const extraction: InvoiceExtraction = {
        vendor_name: 'Test Company',
        invoice_number: 'INV-001',
        invoice_date: '2024-01-15',
        total_amount: 100.00,
        currency: 'ILS',
        vat_amount: 17.00,
        confidence: 0.9,
        category: null,
      };
      expect(needsReview(extraction)).toBe(false);
    });

    it('should return true for low confidence', () => {
      const extraction: InvoiceExtraction = {
        vendor_name: 'Test Company',
        invoice_number: 'INV-001',
        invoice_date: '2024-01-15',
        total_amount: 100.00,
        currency: 'ILS',
        vat_amount: 17.00,
        confidence: 0.5,
        category: null,
      };
      expect(needsReview(extraction)).toBe(true);
    });

    it('should return false if only vendor_name is missing (not critical)', () => {
      const extraction: InvoiceExtraction = {
        vendor_name: null,
        invoice_number: 'INV-001',
        invoice_date: '2024-01-15',
        total_amount: 100.00,
        currency: 'ILS',
        vat_amount: 17.00,
        confidence: 0.9,
        category: null,
      };
      // vendor_name is not critical - we still have amount and date
      expect(needsReview(extraction)).toBe(false);
    });

    it('should return true if total_amount is missing', () => {
      const extraction: InvoiceExtraction = {
        vendor_name: 'Test Company',
        invoice_number: 'INV-001',
        invoice_date: '2024-01-15',
        total_amount: null,
        currency: 'ILS',
        vat_amount: 17.00,
        confidence: 0.9,
        category: null,
      };
      expect(needsReview(extraction)).toBe(true);
    });

    it('should return false with exactly 0.6 confidence', () => {
      const extraction: InvoiceExtraction = {
        vendor_name: 'Test Company',
        invoice_number: null,
        invoice_date: null,
        total_amount: 100.00,
        currency: null,
        vat_amount: null,
        confidence: 0.6,
        category: null,
      };
      expect(needsReview(extraction)).toBe(false);
    });
  });
});

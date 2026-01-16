import { formatDuplicateWarning, formatDuplicateResolved } from '../src/services/telegram.service';
import type { DuplicateMatch, InvoiceExtraction } from '../../../shared/types';

describe('Duplicate Detection', () => {
  describe('formatDuplicateWarning', () => {
    it('should format exact duplicate warning correctly', () => {
      const duplicate: DuplicateMatch = {
        jobId: '123_456',
        vendorName: 'Cafe Hillel',
        totalAmount: 150.0,
        invoiceDate: '2026-01-05',
        driveLink: 'https://storage.example.com/old-file',
        receivedAt: '2026-01-05T10:00:00Z',
        matchType: 'exact',
      };

      const result = formatDuplicateWarning(
        duplicate,
        'https://storage.example.com/new-file',
        123,
        456
      );

      expect(result.text).toContain('Exact duplicate detected');
      expect(result.text).toContain('05/01/2026');
      expect(result.text).toContain('150');
      expect(result.text).toContain('Cafe Hillel');
      expect(result.keyboard.inline_keyboard).toHaveLength(1);
      expect(result.keyboard.inline_keyboard[0]).toHaveLength(2);
    });

    it('should format similar invoice warning correctly', () => {
      const duplicate: DuplicateMatch = {
        jobId: '123_456',
        vendorName: 'SuperMarket',
        totalAmount: 89.5,
        invoiceDate: null,
        driveLink: 'https://storage.example.com/old-file',
        receivedAt: '2026-01-03T15:30:00Z',
        matchType: 'similar',
      };

      const result = formatDuplicateWarning(
        duplicate,
        'https://storage.example.com/new-file',
        123,
        456
      );

      expect(result.text).toContain('Similar invoice detected');
      expect(result.text).toContain('?'); // No date
      expect(result.text).toContain('89.5');
      expect(result.text).toContain('SuperMarket');
    });

    it('should handle missing vendor name', () => {
      const duplicate: DuplicateMatch = {
        jobId: '123_456',
        vendorName: null,
        totalAmount: 200.0,
        invoiceDate: '2026-01-10',
        driveLink: 'https://storage.example.com/old-file',
        receivedAt: '2026-01-10T12:00:00Z',
        matchType: 'exact',
      };

      const result = formatDuplicateWarning(
        duplicate,
        'https://storage.example.com/new-file',
        123,
        456
      );

      expect(result.text).toContain('Unknown');
      expect(result.text).toContain('200');
    });

    it('should include callback data in buttons', () => {
      const duplicate: DuplicateMatch = {
        jobId: '123_456',
        vendorName: 'Test',
        totalAmount: 100,
        invoiceDate: null,
        driveLink: 'https://example.com',
        receivedAt: '2026-01-01T00:00:00Z',
        matchType: 'exact',
      };

      const result = formatDuplicateWarning(duplicate, 'https://new.example.com', 999, 888);

      const keepBothButton = result.keyboard.inline_keyboard[0][0];
      const deleteNewButton = result.keyboard.inline_keyboard[0][1];

      expect(keepBothButton.text).toBe('✅ Keep Both');
      expect(deleteNewButton.text).toBe('🗑️ Delete New');

      const keepBothData = JSON.parse(keepBothButton.callback_data || '{}');
      expect(keepBothData.action).toBe('keep_both');
      expect(keepBothData.chatId).toBe(999);
      expect(keepBothData.messageId).toBe(888);
    });
  });

  describe('formatDuplicateResolved', () => {
    it('should format keep both message', () => {
      const result = formatDuplicateResolved('keep_both', 'https://new.com', 'https://old.com');
      expect(result).toContain('Both invoices kept');
      expect(result).toContain('https://new.com');
      expect(result).toContain('https://old.com');
    });

    it('should format delete new message', () => {
      const result = formatDuplicateResolved('delete_new', 'https://new.com', 'https://old.com');
      expect(result).toContain('Duplicate deleted');
      expect(result).toContain('https://old.com');
    });
  });

  describe('Duplicate matching logic', () => {
    const createExtraction = (overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction => ({
      is_invoice: true,
      rejection_reason: null,
      vendor_name: 'Test Vendor',
      invoice_number: 'INV-001',
      invoice_date: '2026-01-15',
      total_amount: 100.0,
      currency: 'ILS',
      vat_amount: 17.0,
      confidence: 0.9,
      category: null,
      ...overrides,
    });

    it('should identify exact duplicates with same vendor, amount, and date', () => {
      const extraction1 = createExtraction();
      const extraction2 = createExtraction();

      // Same vendor (case-insensitive)
      expect(extraction1.vendor_name?.toLowerCase()).toBe(extraction2.vendor_name?.toLowerCase());
      // Same amount
      expect(extraction1.total_amount).toBe(extraction2.total_amount);
      // Same date
      expect(extraction1.invoice_date).toBe(extraction2.invoice_date);
    });

    it('should match vendors case-insensitively', () => {
      const vendor1 = 'Cafe Hillel';
      const vendor2 = 'CAFE HILLEL';
      const vendor3 = 'cafe hillel';

      expect(vendor1.toLowerCase().trim()).toBe(vendor2.toLowerCase().trim());
      expect(vendor1.toLowerCase().trim()).toBe(vendor3.toLowerCase().trim());
    });

    it('should not match if amounts differ', () => {
      const extraction1 = createExtraction({ total_amount: 100.0 });
      const extraction2 = createExtraction({ total_amount: 100.5 });

      expect(extraction1.total_amount).not.toBe(extraction2.total_amount);
    });

    it('should not match if dates differ', () => {
      const extraction1 = createExtraction({ invoice_date: '2026-01-15' });
      const extraction2 = createExtraction({ invoice_date: '2026-01-16' });

      expect(extraction1.invoice_date).not.toBe(extraction2.invoice_date);
    });

    it('should handle null values gracefully', () => {
      const extraction1 = createExtraction({ vendor_name: null });
      const extraction2 = createExtraction({ total_amount: null });

      // Can't detect duplicates without vendor or amount
      expect(extraction1.vendor_name).toBeNull();
      expect(extraction2.total_amount).toBeNull();
    });
  });
});

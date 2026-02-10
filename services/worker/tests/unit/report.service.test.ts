/**
 * Unit tests for Report Service
 */

import * as reportService from '../../src/services/report/report.service';
import type { InvoiceForReport } from '../../../../shared/report.types';

/**
 * Helper to create mock invoice with all required fields
 */
function createMockInvoice(overrides: Partial<InvoiceForReport>): InvoiceForReport {
  return {
    invoiceNumber: '001',
    date: '2026-01-15',
    customerName: 'Customer A',
    amount: 1000,
    currency: 'ILS',
    paymentMethod: 'Cash',
    category: 'Services',
    driveLink: 'https://drive.google.com/...',
    documentType: 'invoice_receipt',
    paymentStatus: 'paid',
    paidAmount: undefined,
    remainingBalance: undefined,
    relatedInvoiceNumber: undefined,
    isLinkedReceipt: false,
    ...overrides,
  };
}

describe('Report Service', () => {
  describe('getDateRangeForPreset', () => {
    it('should return correct date range for this_month', () => {
      const result = reportService.getDateRangeForPreset('this_month');

      expect(result.preset).toBe('this_month');
      expect(result.start).toMatch(/^\d{4}-\d{2}-01$/); // First of month
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return correct date range for last_month', () => {
      const result = reportService.getDateRangeForPreset('last_month');

      expect(result.preset).toBe('last_month');
      expect(result.start).toMatch(/^\d{4}-\d{2}-01$/);
    });

    it('should return correct date range for ytd', () => {
      const result = reportService.getDateRangeForPreset('ytd');

      expect(result.preset).toBe('ytd');
      expect(result.start).toMatch(/^\d{4}-01-01$/); // Jan 1
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Today
    });

    it('should throw error for unknown preset', () => {
      expect(() => {
        reportService.getDateRangeForPreset('invalid_preset');
      }).toThrow('Unknown preset');
    });
  });

  describe('calculateMetrics', () => {
    it('should calculate metrics correctly for empty array', () => {
      const result = reportService.calculateMetrics([]);

      expect(result.totalInvoiced).toBe(0);
      expect(result.totalReceived).toBe(0);
      expect(result.totalOutstanding).toBe(0);
      expect(result.invoicedCount).toBe(0);
      expect(result.receivedCount).toBe(0);
      expect(result.outstandingCount).toBe(0);
      expect(result.avgInvoiced).toBe(0);
      expect(result.avgReceived).toBe(0);
      expect(result.maxInvoice).toBe(0);
      expect(result.minInvoice).toBe(0);
      expect(result.currencies).toEqual([]);
      expect(result.paymentMethods).toEqual({});
    });

    it('should calculate metrics correctly for invoices', () => {
      const invoices: InvoiceForReport[] = [
        createMockInvoice({ invoiceNumber: '001', amount: 1000, paymentMethod: 'Cash' }),
        createMockInvoice({ invoiceNumber: '002', amount: 2000, paymentMethod: 'Transfer' }),
        createMockInvoice({ invoiceNumber: '003', amount: 500, paymentMethod: 'Cash' }),
      ];

      const result = reportService.calculateMetrics(invoices);

      expect(result.totalInvoiced).toBe(3500);
      expect(result.totalReceived).toBe(3500);
      expect(result.totalOutstanding).toBe(0);
      expect(result.invoicedCount).toBe(3);
      expect(result.receivedCount).toBe(3);
      expect(result.outstandingCount).toBe(0);
      expect(result.avgInvoiced).toBeCloseTo(1166.67, 2);
      expect(result.maxInvoice).toBe(2000);
      expect(result.minInvoice).toBe(500);

      expect(result.currencies).toHaveLength(1);
      expect(result.currencies[0].currency).toBe('ILS');
      expect(result.currencies[0].totalInvoiced).toBe(3500);
      expect(result.currencies[0].totalReceived).toBe(3500);
      expect(result.currencies[0].totalOutstanding).toBe(0);

      expect(result.paymentMethods).toEqual({
        Cash: { count: 2, total: 1500 },
        Transfer: { count: 1, total: 2000 },
      });
    });

    it('should handle single invoice correctly', () => {
      const invoices: InvoiceForReport[] = [createMockInvoice({ amount: 1500 })];

      const result = reportService.calculateMetrics(invoices);

      expect(result.totalInvoiced).toBe(1500);
      expect(result.totalReceived).toBe(1500);
      expect(result.totalOutstanding).toBe(0);
      expect(result.invoicedCount).toBe(1);
      expect(result.avgInvoiced).toBe(1500);
      expect(result.maxInvoice).toBe(1500);
      expect(result.minInvoice).toBe(1500);
      expect(result.currencies).toHaveLength(1);
    });

    it('should handle multiple currencies correctly', () => {
      const invoices: InvoiceForReport[] = [
        createMockInvoice({
          invoiceNumber: '001',
          amount: 1000,
          currency: 'ILS',
          paymentMethod: 'Cash',
        }),
        createMockInvoice({
          invoiceNumber: '002',
          amount: 500,
          currency: 'USD',
          paymentMethod: 'Transfer',
        }),
        createMockInvoice({
          invoiceNumber: '003',
          amount: 2000,
          currency: 'ILS',
          paymentMethod: 'Cash',
        }),
        createMockInvoice({
          invoiceNumber: '004',
          amount: 300,
          currency: 'EUR',
          paymentMethod: 'Card',
        }),
      ];

      const result = reportService.calculateMetrics(invoices);

      // Should have 3 currencies
      expect(result.currencies).toHaveLength(3);

      // Primary currency (highest invoiced) should be ILS
      expect(result.currencies[0].currency).toBe('ILS');
      expect(result.currencies[0].totalInvoiced).toBe(3000);
      expect(result.currencies[0].invoicedCount).toBe(2);
      expect(result.currencies[0].avgInvoiced).toBe(1500);
      expect(result.currencies[0].maxInvoice).toBe(2000);
      expect(result.currencies[0].minInvoice).toBe(1000);

      // Second currency should be USD
      expect(result.currencies[1].currency).toBe('USD');
      expect(result.currencies[1].totalInvoiced).toBe(500);
      expect(result.currencies[1].invoicedCount).toBe(1);

      // Third currency should be EUR
      expect(result.currencies[2].currency).toBe('EUR');
      expect(result.currencies[2].totalInvoiced).toBe(300);
      expect(result.currencies[2].invoicedCount).toBe(1);

      // Top-level fields should use primary currency (ILS)
      expect(result.totalInvoiced).toBe(3000);
      expect(result.invoicedCount).toBe(2);
      expect(result.avgInvoiced).toBe(1500);

      // Payment methods should include all currencies
      expect(result.paymentMethods).toEqual({
        Cash: { count: 2, total: 3000 },
        Transfer: { count: 1, total: 500 },
        Card: { count: 1, total: 300 },
      });
    });

    it('should sort currencies by revenue descending', () => {
      const invoices: InvoiceForReport[] = [
        createMockInvoice({ invoiceNumber: '001', amount: 100, currency: 'EUR' }),
        createMockInvoice({ invoiceNumber: '002', amount: 5000, currency: 'ILS' }),
        createMockInvoice({ invoiceNumber: '003', amount: 1000, currency: 'USD' }),
      ];

      const result = reportService.calculateMetrics(invoices);

      // Should be sorted: ILS (5000), USD (1000), EUR (100)
      expect(result.currencies[0].currency).toBe('ILS');
      expect(result.currencies[0].totalInvoiced).toBe(5000);
      expect(result.currencies[1].currency).toBe('USD');
      expect(result.currencies[1].totalInvoiced).toBe(1000);
      expect(result.currencies[2].currency).toBe('EUR');
      expect(result.currencies[2].totalInvoiced).toBe(100);
    });

    it('should handle invoices without currency field (defaults to ILS)', () => {
      const invoices: InvoiceForReport[] = [createMockInvoice({ currency: '' })];

      const result = reportService.calculateMetrics(invoices);

      expect(result.currencies).toHaveLength(1);
      expect(result.currencies[0].currency).toBe('ILS');
      expect(result.currencies[0].totalInvoiced).toBe(1000);
    });
  });
});

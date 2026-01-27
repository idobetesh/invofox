/**
 * Unit tests for Report Service
 */

import * as reportService from '../../src/services/report/report.service';
import type { InvoiceForReport } from '../../../../shared/report.types';

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

      expect(result.totalRevenue).toBe(0);
      expect(result.invoiceCount).toBe(0);
      expect(result.avgInvoice).toBe(0);
      expect(result.maxInvoice).toBe(0);
      expect(result.minInvoice).toBe(0);
      expect(result.currencies).toEqual([]);
      expect(result.paymentMethods).toEqual({});
    });

    it('should calculate metrics correctly for invoices', () => {
      const invoices: InvoiceForReport[] = [
        {
          invoiceNumber: '001',
          date: '2026-01-15',
          customerName: 'Customer A',
          amount: 1000,
          currency: 'ILS',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
        {
          invoiceNumber: '002',
          date: '2026-01-20',
          customerName: 'Customer B',
          amount: 2000,
          currency: 'ILS',
          paymentMethod: 'Transfer',
          category: 'Products',
          driveLink: 'https://drive.google.com/...',
        },
        {
          invoiceNumber: '003',
          date: '2026-01-25',
          customerName: 'Customer C',
          amount: 500,
          currency: 'ILS',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
      ];

      const result = reportService.calculateMetrics(invoices);

      expect(result.totalRevenue).toBe(3500);
      expect(result.invoiceCount).toBe(3);
      expect(result.avgInvoice).toBeCloseTo(1166.67, 2);
      expect(result.maxInvoice).toBe(2000);
      expect(result.minInvoice).toBe(500);
      expect(result.currencies).toHaveLength(1);
      expect(result.currencies[0]).toEqual({
        currency: 'ILS',
        totalRevenue: 3500,
        invoiceCount: 3,
        avgInvoice: expect.closeTo(1166.67, 2),
        maxInvoice: 2000,
        minInvoice: 500,
      });
      expect(result.paymentMethods).toEqual({
        Cash: { count: 2, total: 1500 },
        Transfer: { count: 1, total: 2000 },
      });
    });

    it('should handle single invoice correctly', () => {
      const invoices: InvoiceForReport[] = [
        {
          invoiceNumber: '001',
          date: '2026-01-15',
          customerName: 'Customer A',
          amount: 1500,
          currency: 'ILS',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
      ];

      const result = reportService.calculateMetrics(invoices);

      expect(result.totalRevenue).toBe(1500);
      expect(result.invoiceCount).toBe(1);
      expect(result.avgInvoice).toBe(1500);
      expect(result.maxInvoice).toBe(1500);
      expect(result.minInvoice).toBe(1500);
      expect(result.currencies).toHaveLength(1);
    });

    it('should handle multiple currencies correctly', () => {
      const invoices: InvoiceForReport[] = [
        {
          invoiceNumber: '001',
          date: '2026-01-15',
          customerName: 'Customer A',
          amount: 1000,
          currency: 'ILS',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
        {
          invoiceNumber: '002',
          date: '2026-01-20',
          customerName: 'Customer B',
          amount: 500,
          currency: 'USD',
          paymentMethod: 'Transfer',
          category: 'Products',
          driveLink: 'https://drive.google.com/...',
        },
        {
          invoiceNumber: '003',
          date: '2026-01-25',
          customerName: 'Customer C',
          amount: 2000,
          currency: 'ILS',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
        {
          invoiceNumber: '004',
          date: '2026-01-27',
          customerName: 'Customer D',
          amount: 300,
          currency: 'EUR',
          paymentMethod: 'Card',
          category: 'Software',
          driveLink: 'https://drive.google.com/...',
        },
      ];

      const result = reportService.calculateMetrics(invoices);

      // Should have 3 currencies
      expect(result.currencies).toHaveLength(3);

      // Primary currency (highest revenue) should be ILS
      expect(result.currencies[0].currency).toBe('ILS');
      expect(result.currencies[0].totalRevenue).toBe(3000);
      expect(result.currencies[0].invoiceCount).toBe(2);
      expect(result.currencies[0].avgInvoice).toBe(1500);
      expect(result.currencies[0].maxInvoice).toBe(2000);
      expect(result.currencies[0].minInvoice).toBe(1000);

      // Second currency should be USD
      expect(result.currencies[1].currency).toBe('USD');
      expect(result.currencies[1].totalRevenue).toBe(500);
      expect(result.currencies[1].invoiceCount).toBe(1);

      // Third currency should be EUR
      expect(result.currencies[2].currency).toBe('EUR');
      expect(result.currencies[2].totalRevenue).toBe(300);
      expect(result.currencies[2].invoiceCount).toBe(1);

      // Legacy fields should use primary currency (ILS)
      expect(result.totalRevenue).toBe(3000);
      expect(result.invoiceCount).toBe(2);
      expect(result.avgInvoice).toBe(1500);

      // Payment methods should include all currencies
      expect(result.paymentMethods).toEqual({
        Cash: { count: 2, total: 3000 },
        Transfer: { count: 1, total: 500 },
        Card: { count: 1, total: 300 },
      });
    });

    it('should sort currencies by revenue descending', () => {
      const invoices: InvoiceForReport[] = [
        {
          invoiceNumber: '001',
          date: '2026-01-15',
          customerName: 'Customer A',
          amount: 100,
          currency: 'EUR',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
        {
          invoiceNumber: '002',
          date: '2026-01-20',
          customerName: 'Customer B',
          amount: 5000,
          currency: 'ILS',
          paymentMethod: 'Transfer',
          category: 'Products',
          driveLink: 'https://drive.google.com/...',
        },
        {
          invoiceNumber: '003',
          date: '2026-01-25',
          customerName: 'Customer C',
          amount: 1000,
          currency: 'USD',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
      ];

      const result = reportService.calculateMetrics(invoices);

      // Should be sorted: ILS (5000), USD (1000), EUR (100)
      expect(result.currencies[0].currency).toBe('ILS');
      expect(result.currencies[0].totalRevenue).toBe(5000);
      expect(result.currencies[1].currency).toBe('USD');
      expect(result.currencies[1].totalRevenue).toBe(1000);
      expect(result.currencies[2].currency).toBe('EUR');
      expect(result.currencies[2].totalRevenue).toBe(100);
    });

    it('should handle invoices without currency field (defaults to ILS)', () => {
      const invoices: InvoiceForReport[] = [
        {
          invoiceNumber: '001',
          date: '2026-01-15',
          customerName: 'Customer A',
          amount: 1000,
          currency: '',
          paymentMethod: 'Cash',
          category: 'Services',
          driveLink: 'https://drive.google.com/...',
        },
      ];

      const result = reportService.calculateMetrics(invoices);

      expect(result.currencies).toHaveLength(1);
      expect(result.currencies[0].currency).toBe('ILS');
      expect(result.currencies[0].totalRevenue).toBe(1000);
    });
  });
});

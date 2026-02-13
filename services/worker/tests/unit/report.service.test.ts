/**
 * Report Service Tests
 * Unit tests for balance metrics calculation
 */

import { describe, it, expect } from '@jest/globals';
import type { InvoiceForReport } from '../../../../shared/report.types';
import { calculateBalanceMetrics } from '../../src/services/report/core';

describe('calculateBalanceMetrics', () => {
  it('should calculate net profit correctly with both revenue and expenses', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'INV-001',
        date: '2026-01-15',
        customerName: 'Customer A',
        amount: 10000,
        currency: 'ILS',
        paymentMethod: 'Bank Transfer',
        driveLink: 'https://example.com/inv-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 10000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    const expenseInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'EXP-001',
        date: '2026-01-10',
        customerName: 'Vendor A',
        amount: 6000,
        currency: 'ILS',
        paymentMethod: 'Unknown',
        driveLink: 'https://example.com/exp-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 6000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    expect(metrics.profit).toBe(4000); // 10000 - 6000
    expect(metrics.revenueMetrics?.totalReceived).toBe(10000);
    expect(metrics.expenseMetrics?.totalExpenses).toBe(6000);
  });

  it('should handle multi-currency scenarios correctly', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'INV-001',
        date: '2026-01-15',
        customerName: 'Customer A',
        amount: 10000,
        currency: 'ILS',
        paymentMethod: 'Bank Transfer',
        driveLink: 'https://example.com/inv-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 10000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
      {
        invoiceNumber: 'INV-002',
        date: '2026-01-16',
        customerName: 'Customer B',
        amount: 5000,
        currency: 'USD',
        paymentMethod: 'Credit Card',
        driveLink: 'https://example.com/inv-002',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 5000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    const expenseInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'EXP-001',
        date: '2026-01-10',
        customerName: 'Vendor A',
        amount: 6000,
        currency: 'ILS',
        paymentMethod: 'Unknown',
        driveLink: 'https://example.com/exp-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 6000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
      {
        invoiceNumber: 'EXP-002',
        date: '2026-01-11',
        customerName: 'Vendor B',
        amount: 2000,
        currency: 'USD',
        paymentMethod: 'Unknown',
        driveLink: 'https://example.com/exp-002',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 2000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    expect(metrics.currencies.length).toBe(2);
    expect(metrics.revenueMetrics?.currencies.length).toBe(2);
    expect(metrics.expenseMetrics?.currencies.length).toBe(2);

    // Check ILS currency
    const ilsCurrency = metrics.revenueMetrics?.currencies.find((c) => c.currency === 'ILS');
    expect(ilsCurrency?.totalInvoiced).toBe(10000);

    const ilsExpense = metrics.expenseMetrics?.currencies.find((c) => c.currency === 'ILS');
    expect(ilsExpense?.totalExpenses).toBe(6000);

    // Check USD currency
    const usdCurrency = metrics.revenueMetrics?.currencies.find((c) => c.currency === 'USD');
    expect(usdCurrency?.totalInvoiced).toBe(5000);

    const usdExpense = metrics.expenseMetrics?.currencies.find((c) => c.currency === 'USD');
    expect(usdExpense?.totalExpenses).toBe(2000);
  });

  it('should handle no expenses scenario (profit equals total received)', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'INV-001',
        date: '2026-01-15',
        customerName: 'Customer A',
        amount: 10000,
        currency: 'ILS',
        paymentMethod: 'Bank Transfer',
        driveLink: 'https://example.com/inv-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 10000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    const expenseInvoices: InvoiceForReport[] = [];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    expect(metrics.profit).toBe(10000); // All revenue is profit
    expect(metrics.revenueMetrics?.totalReceived).toBe(10000);
    expect(metrics.expenseMetrics?.totalExpenses).toBe(0);
    expect(metrics.profitMargin).toBe(100); // 100% profit margin
  });

  it('should handle no revenue scenario (negative profit)', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [];

    const expenseInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'EXP-001',
        date: '2026-01-10',
        customerName: 'Vendor A',
        amount: 6000,
        currency: 'ILS',
        paymentMethod: 'Unknown',
        driveLink: 'https://example.com/exp-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 6000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    expect(metrics.profit).toBe(-6000); // Negative profit (loss)
    expect(metrics.revenueMetrics?.totalReceived).toBe(0);
    expect(metrics.expenseMetrics?.totalExpenses).toBe(6000);
  });

  it('should handle empty data (no revenue, no expenses)', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [];
    const expenseInvoices: InvoiceForReport[] = [];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    expect(metrics.profit).toBe(0);
    expect(metrics.profitMargin).toBe(0);
    expect(metrics.revenueMetrics?.totalReceived).toBe(0);
    expect(metrics.expenseMetrics?.totalExpenses).toBe(0);
  });

  it('should calculate profit margin correctly', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'INV-001',
        date: '2026-01-15',
        customerName: 'Customer A',
        amount: 10000,
        currency: 'ILS',
        paymentMethod: 'Bank Transfer',
        driveLink: 'https://example.com/inv-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 10000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    const expenseInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'EXP-001',
        date: '2026-01-10',
        customerName: 'Vendor A',
        amount: 2000,
        currency: 'ILS',
        paymentMethod: 'Unknown',
        driveLink: 'https://example.com/exp-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 2000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    expect(metrics.profit).toBe(8000); // 10000 - 2000
    expect(metrics.profitMargin).toBeCloseTo(80, 1); // (8000 / 10000) * 100 = 80%
  });

  it('should calculate net invoiced and net cash flow correctly', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'INV-001',
        date: '2026-01-15',
        customerName: 'Customer A',
        amount: 15000,
        currency: 'ILS',
        paymentMethod: 'Bank Transfer',
        driveLink: 'https://example.com/inv-001',
        documentType: 'invoice',
        paymentStatus: 'paid',
        paidAmount: 15000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
      {
        invoiceNumber: 'INV-002',
        date: '2026-01-16',
        customerName: 'Customer B',
        amount: 10000,
        currency: 'ILS',
        paymentMethod: 'Credit Card',
        driveLink: 'https://example.com/inv-002',
        documentType: 'invoice',
        paymentStatus: 'unpaid',
        remainingBalance: 10000,
        isLinkedReceipt: false,
      },
    ];

    const expenseInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'EXP-001',
        date: '2026-01-10',
        customerName: 'Vendor A',
        amount: 8000,
        currency: 'ILS',
        paymentMethod: 'Unknown',
        driveLink: 'https://example.com/exp-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 8000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    expect(metrics.netInvoiced).toBe(17000); // (15000 + 10000) - 8000
    expect(metrics.netCashFlow).toBe(7000); // 15000 - 8000
    expect(metrics.profit).toBe(7000); // Same as netCashFlow
  });

  it('should use primary currency with highest absolute net position', () => {
    // Arrange
    const revenueInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'INV-001',
        date: '2026-01-15',
        customerName: 'Customer A',
        amount: 1000,
        currency: 'ILS',
        paymentMethod: 'Bank Transfer',
        driveLink: 'https://example.com/inv-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 1000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
      {
        invoiceNumber: 'INV-002',
        date: '2026-01-16',
        customerName: 'Customer B',
        amount: 10000,
        currency: 'USD',
        paymentMethod: 'Credit Card',
        driveLink: 'https://example.com/inv-002',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 10000,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    const expenseInvoices: InvoiceForReport[] = [
      {
        invoiceNumber: 'EXP-001',
        date: '2026-01-10',
        customerName: 'Vendor A',
        amount: 500,
        currency: 'ILS',
        paymentMethod: 'Unknown',
        driveLink: 'https://example.com/exp-001',
        documentType: 'invoice_receipt',
        paymentStatus: 'paid',
        paidAmount: 500,
        remainingBalance: 0,
        isLinkedReceipt: false,
      },
    ];

    // Act
    const metrics = calculateBalanceMetrics(revenueInvoices, expenseInvoices);

    // Assert
    // USD has the highest absolute net position (10000), so it should be primary
    // Top-level metrics should reflect USD net position
    expect(metrics.currencies[0].currency).toBe('USD');
    expect(metrics.currencies[0].totalInvoiced).toBe(10000); // Net invoiced in USD
  });
});

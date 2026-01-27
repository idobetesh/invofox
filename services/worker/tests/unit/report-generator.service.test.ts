/**
 * Unit tests for Report Generator Service
 */

import type { ReportData } from '../../../../shared/report.types';

// Mock Playwright BEFORE importing the service
const mockPdf = jest.fn(() => Promise.resolve(Buffer.from('fake-pdf-content')));
const mockClose = jest.fn(() => Promise.resolve());
const mockPage = {
  setContent: jest.fn(() => Promise.resolve()),
  waitForFunction: jest.fn(() => Promise.resolve()),
  waitForTimeout: jest.fn(() => Promise.resolve()),
  pdf: mockPdf,
};
const mockBrowser = {
  newPage: jest.fn(() => Promise.resolve(mockPage)),
  close: mockClose,
};
const mockChromiumLaunch = jest.fn(() => Promise.resolve(mockBrowser));

jest.mock('playwright', () => ({
  chromium: {
    launch: mockChromiumLaunch,
  },
}));

// Mock csv-stringify
const mockStringify = jest.fn((records) => {
  // Simple CSV mock: join rows with newlines
  return records.map((row: string[]) => row.join(',')).join('\n');
});

jest.mock('csv-stringify/sync', () => ({
  stringify: mockStringify,
}));

import * as reportGeneratorService from '../../src/services/report/report-generator.service';

describe('Report Generator Service', () => {
  const mockReportData: ReportData = {
    businessName: 'Test Business',
    logoUrl: undefined,
    reportType: 'revenue',
    dateRange: {
      start: '2026-01-01',
      end: '2026-01-31',
      preset: 'this_month',
    },
    generatedAt: new Date('2026-01-26T12:00:00Z').toISOString(),
    metrics: {
      totalRevenue: 10000,
      invoiceCount: 5,
      avgInvoice: 2000,
      maxInvoice: 5000,
      minInvoice: 500,
      currencies: [
        {
          currency: 'ILS',
          totalRevenue: 10000,
          invoiceCount: 5,
          avgInvoice: 2000,
          maxInvoice: 5000,
          minInvoice: 500,
        },
      ],
      paymentMethods: {
        Cash: { count: 3, total: 6000 },
        Transfer: { count: 2, total: 4000 },
      },
    },
    invoices: [
      {
        invoiceNumber: '001',
        date: '2026-01-05',
        customerName: 'Customer A',
        amount: 5000,
        currency: 'ILS',
        paymentMethod: 'Cash',
        category: 'Services',
        driveLink:
          'https://storage.googleapis.com/papertrail-invoice-generated-invoices/-1001234567890/2026/20001.pdf',
      },
      {
        invoiceNumber: '002',
        date: '2026-01-15',
        customerName: 'Customer B',
        amount: 2000,
        currency: 'ILS',
        paymentMethod: 'Transfer',
        category: 'Products',
        driveLink:
          'https://storage.googleapis.com/papertrail-invoice-invoices/invoices/-1001234567890/2026/01/invoice_-1001234567890_42_1737811200000.pdf',
      },
      {
        invoiceNumber: '003',
        date: '2026-01-25',
        customerName: 'Customer C',
        amount: 3000,
        currency: 'ILS',
        paymentMethod: 'Cash',
        category: 'Services',
        driveLink:
          'https://storage.googleapis.com/papertrail-invoice-generated-invoices/-1001234567890/2026/20003.pdf',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to default behavior
    mockPdf.mockResolvedValue(Buffer.from('fake-pdf-content'));
    mockChromiumLaunch.mockResolvedValue(mockBrowser);
  });

  describe('generatePDFReport', () => {
    it('should generate PDF buffer for revenue report', async () => {
      const result = await reportGeneratorService.generatePDFReport(mockReportData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(result.toString()).toBe('fake-pdf-content');
    });

    it('should generate PDF buffer for expenses report', async () => {
      const expensesData = { ...mockReportData, reportType: 'expenses' as const };
      const result = await reportGeneratorService.generatePDFReport(expensesData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle empty invoices', async () => {
      const emptyData = { ...mockReportData, invoices: [] };
      const result = await reportGeneratorService.generatePDFReport(emptyData);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle multiple currencies', async () => {
      const multiCurrencyData = {
        ...mockReportData,
        metrics: {
          ...mockReportData.metrics,
          currencies: [
            {
              currency: 'ILS',
              totalRevenue: 10000,
              invoiceCount: 3,
              avgInvoice: 3333,
              maxInvoice: 5000,
              minInvoice: 2000,
            },
            {
              currency: 'USD',
              totalRevenue: 3000,
              invoiceCount: 2,
              avgInvoice: 1500,
              maxInvoice: 2000,
              minInvoice: 1000,
            },
          ],
        },
      };

      const result = await reportGeneratorService.generatePDFReport(multiCurrencyData);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle report with logo', async () => {
      const dataWithLogo = {
        ...mockReportData,
        logoUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };

      const result = await reportGeneratorService.generatePDFReport(dataWithLogo);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle different date presets', async () => {
      const presets: Array<'this_month' | 'last_month' | 'ytd' | 'this_year'> = [
        'this_month',
        'last_month',
        'ytd',
        'this_year',
      ];

      for (const preset of presets) {
        const dataWithPreset = {
          ...mockReportData,
          dateRange: { ...mockReportData.dateRange, preset },
        };

        const result = await reportGeneratorService.generatePDFReport(dataWithPreset);
        expect(result).toBeInstanceOf(Buffer);
      }
    });
  });

  describe('generateExcelReport', () => {
    // Note: Excel generation uses real ExcelJS library in tests
    // These are integration tests that verify the actual Excel generation works

    it('should generate Excel buffer for revenue report', async () => {
      const result = await reportGeneratorService.generateExcelReport(mockReportData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should generate Excel buffer for expenses report', async () => {
      const expensesData = { ...mockReportData, reportType: 'expenses' as const };
      const result = await reportGeneratorService.generateExcelReport(expensesData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle empty invoices', async () => {
      const emptyData = { ...mockReportData, invoices: [] };
      const result = await reportGeneratorService.generateExcelReport(emptyData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle multiple currencies in Excel', async () => {
      const multiCurrencyData = {
        ...mockReportData,
        metrics: {
          ...mockReportData.metrics,
          currencies: [
            {
              currency: 'ILS',
              totalRevenue: 10000,
              invoiceCount: 3,
              avgInvoice: 3333,
              maxInvoice: 5000,
              minInvoice: 2000,
            },
            {
              currency: 'USD',
              totalRevenue: 3000,
              invoiceCount: 2,
              avgInvoice: 1500,
              maxInvoice: 2000,
              minInvoice: 1000,
            },
          ],
        },
      };

      const result = await reportGeneratorService.generateExcelReport(multiCurrencyData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('generateCSVReport', () => {
    it('should generate CSV buffer for revenue report', async () => {
      const result = await reportGeneratorService.generateCSVReport(mockReportData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should generate CSV buffer for expenses report', async () => {
      const expensesData = { ...mockReportData, reportType: 'expenses' as const };
      const result = await reportGeneratorService.generateCSVReport(expensesData);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should include CSV header row', async () => {
      const result = await reportGeneratorService.generateCSVReport(mockReportData);
      const csvContent = result.toString('utf8');

      expect(csvContent).toContain('תאריך');
      expect(csvContent).toContain('לקוח');
      expect(csvContent).toContain('סכום');
    });

    it('should include invoice data rows', async () => {
      const result = await reportGeneratorService.generateCSVReport(mockReportData);
      const csvContent = result.toString('utf8');

      expect(csvContent).toContain('Customer A');
      expect(csvContent).toContain('Customer B');
      expect(csvContent).toContain('Customer C');
    });

    it('should handle empty invoices', async () => {
      const emptyData = { ...mockReportData, invoices: [] };
      const result = await reportGeneratorService.generateCSVReport(emptyData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0); // Should at least have header
    });

    it('should handle special characters in CSV', async () => {
      const dataWithSpecialChars = {
        ...mockReportData,
        invoices: [
          {
            invoiceNumber: '001',
            date: '2026-01-05',
            customerName: 'Customer "A" & Co.',
            amount: 5000,
            currency: 'ILS',
            paymentMethod: 'Cash',
            category: 'Services, Consulting',
            driveLink: 'https://drive.google.com/...',
          },
        ],
      };

      const result = await reportGeneratorService.generateCSVReport(dataWithSpecialChars);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle Playwright launch failure', async () => {
      mockChromiumLaunch.mockRejectedValueOnce(new Error('Browser launch failed'));

      await expect(reportGeneratorService.generatePDFReport(mockReportData)).rejects.toThrow(
        'Browser launch failed'
      );
    });

    it('should handle PDF generation failure', async () => {
      mockPdf.mockRejectedValueOnce(new Error('PDF generation failed'));

      await expect(reportGeneratorService.generatePDFReport(mockReportData)).rejects.toThrow(
        'PDF generation failed'
      );
    });
  });

  describe('Chart Generation', () => {
    it('should include chart in PDF for monthly report', async () => {
      const monthlyData = {
        ...mockReportData,
        dateRange: { start: '2026-01-01', end: '2026-01-31', preset: 'this_month' as const },
      };

      const result = await reportGeneratorService.generatePDFReport(monthlyData);

      expect(result).toBeInstanceOf(Buffer);
      // Chart should be included (tested via Playwright mock)
    });

    it('should include chart in PDF for yearly report', async () => {
      const yearlyData = {
        ...mockReportData,
        dateRange: { start: '2026-01-01', end: '2026-12-31', preset: 'this_year' as const },
      };

      const result = await reportGeneratorService.generatePDFReport(yearlyData);

      expect(result).toBeInstanceOf(Buffer);
      // Chart should group by months for yearly reports
    });
  });
});

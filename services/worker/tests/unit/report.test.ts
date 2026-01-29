/**
 * Report Template Tests
 * Tests for report HTML generation and logo display
 */

import { generateReportHTML } from '../../src/services/report/report-template';
import type { ReportData } from '../../../../shared/report.types';

describe('Report Template - Logo Display', () => {
  const mockReportData: ReportData = {
    businessName: 'Test Business',
    reportType: 'revenue',
    dateRange: { start: '2026-01-01', end: '2026-01-31', preset: 'this_month' },
    generatedAt: '2026-01-28T10:00:00Z',
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
      paymentMethods: {},
    },
    invoices: [],
  };

  it('should include logo image when logoUrl is provided (base64)', () => {
    const dataWithLogo = {
      ...mockReportData,
      logoUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    };

    const html = generateReportHTML(dataWithLogo);

    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain('class="logo"');
    expect(html).not.toContain('<div class="logo-placeholder">');
  });

  it('should show placeholder when logoUrl is missing', () => {
    const dataWithoutLogo = {
      ...mockReportData,
      logoUrl: undefined,
    };

    const html = generateReportHTML(dataWithoutLogo);

    expect(html).toContain('<div class="logo-placeholder">📄</div>');
    expect(html).not.toContain('<img src=');
  });

  it('should escape HTML in logoUrl to prevent XSS', () => {
    const dataWithMaliciousUrl = {
      ...mockReportData,
      logoUrl: 'data:image/png;base64,abc" onerror="alert(1)"',
    };

    const html = generateReportHTML(dataWithMaliciousUrl);

    // Should escape the quotes and special characters
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('should include business name in header', () => {
    const html = generateReportHTML(mockReportData);

    expect(html).toContain('Test Business');
  });

  it('should show correct report title for revenue report', () => {
    const html = generateReportHTML(mockReportData);

    expect(html).toContain('דוח הכנסות');
  });

  it('should show correct report title for expenses report', () => {
    const expensesData = { ...mockReportData, reportType: 'expenses' as const };
    const html = generateReportHTML(expensesData);

    expect(html).toContain('דוח הוצאות');
  });
});

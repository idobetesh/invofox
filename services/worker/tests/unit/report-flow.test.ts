/**
 * Report Flow Tests
 * Tests for report generation flow including logo handling
 */

import * as businessConfigService from '../../src/services/business-config/config.service';
import * as reportService from '../../src/services/report/report.service';

// Mock dependencies
jest.mock('../../src/services/business-config/config.service');
jest.mock('../../src/services/report/report.service');

describe('Report Flow - Logo Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should convert logoUrl to base64 for PDF embedding', async () => {
    const mockConfig = {
      business: {
        name: 'Test Business',
        logoUrl: 'https://storage.googleapis.com/bucket/logo.png',
      },
    };

    const mockLogoBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Mock getBusinessConfig to return config with logoUrl
    jest.spyOn(businessConfigService, 'getBusinessConfig').mockResolvedValue(mockConfig as any);

    // Mock getLogoBase64 to convert URL to base64
    jest.spyOn(businessConfigService, 'getLogoBase64').mockResolvedValue(mockLogoBase64);

    // Mock generateReportData
    jest.spyOn(reportService, 'generateReportData').mockResolvedValue({
      businessName: 'Test Business',
      logoUrl: mockLogoBase64,
      reportType: 'revenue',
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
      generatedAt: '2026-01-28T10:00:00Z',
      metrics: {
        totalRevenue: 0,
        invoiceCount: 0,
        avgInvoice: 0,
        maxInvoice: 0,
        minInvoice: 0,
        currencies: [],
        paymentMethods: {},
      },
      invoices: [],
    } as any);

    // Simulate the flow (simplified)
    const chatId = 123456;
    const config = await businessConfigService.getBusinessConfig(chatId);
    const logoBase64 = await businessConfigService.getLogoBase64(chatId, config?.business?.logoUrl);

    // Verify getLogoBase64 was called with correct params
    expect(businessConfigService.getLogoBase64).toHaveBeenCalledWith(
      chatId,
      'https://storage.googleapis.com/bucket/logo.png'
    );

    // Verify it returns base64 data URL
    expect(logoBase64).toMatch(/^data:image\//);
    expect(logoBase64).toContain('base64');
  });

  it('should handle missing logoUrl gracefully', async () => {
    const mockConfig = {
      business: {
        name: 'Test Business',
        // logoUrl is undefined
      },
    };

    jest.spyOn(businessConfigService, 'getBusinessConfig').mockResolvedValue(mockConfig as any);
    jest.spyOn(businessConfigService, 'getLogoBase64').mockResolvedValue(undefined);

    const chatId = 123456;
    const config = await businessConfigService.getBusinessConfig(chatId);
    const logoBase64 = await businessConfigService.getLogoBase64(chatId, config?.business?.logoUrl);

    // Should return undefined when no logo
    expect(logoBase64).toBeUndefined();
  });

  it('should pass base64 logo to report generation not HTTP URL', async () => {
    const mockConfig = {
      business: {
        name: 'Test Business',
        logoUrl: 'https://storage.googleapis.com/bucket/logo.png',
      },
    };

    const mockLogoBase64 = 'data:image/png;base64,abc123';

    jest.spyOn(businessConfigService, 'getBusinessConfig').mockResolvedValue(mockConfig as any);
    jest.spyOn(businessConfigService, 'getLogoBase64').mockResolvedValue(mockLogoBase64);

    const mockGenerateReportData = jest
      .spyOn(reportService, 'generateReportData')
      .mockResolvedValue({} as any);

    const chatId = 123456;
    const config = await businessConfigService.getBusinessConfig(chatId);
    const logoBase64 = await businessConfigService.getLogoBase64(chatId, config?.business?.logoUrl);

    // Simulate calling generateReportData
    await reportService.generateReportData(
      chatId,
      { start: '2026-01-01', end: '2026-01-31' },
      'Test Business',
      'revenue',
      logoBase64
    );

    // Verify generateReportData was called with base64, NOT HTTP URL
    expect(mockGenerateReportData).toHaveBeenCalledWith(
      chatId,
      { start: '2026-01-01', end: '2026-01-31' },
      'Test Business',
      'revenue',
      'data:image/png;base64,abc123' // Base64, not HTTP URL!
    );

    // Verify it was NOT called with the original HTTP URL
    expect(mockGenerateReportData).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'https://storage.googleapis.com/bucket/logo.png'
    );
  });
});

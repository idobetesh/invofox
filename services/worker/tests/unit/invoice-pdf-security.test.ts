import { chromium } from 'playwright';
import { generateInvoicePDFWithConfig } from '../../src/services/document-generator/pdf.generator';
import type { InvoiceData, BusinessConfig } from '../../../../shared/types';

const mockPage = {
  route: jest.fn().mockResolvedValue(undefined),
  setContent: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
};
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
};
jest.mock('playwright', () => ({ chromium: { launch: jest.fn(() => mockBrowser) } }));

const data: InvoiceData = {
  invoiceNumber: 'I-2026-1',
  documentType: 'invoice',
  customerName: '<script>alert(1)</script>',
  description: 'Service',
  amount: 100,
  date: '2026-10-24',
};
const config: BusinessConfig = {
  business: {
    name: 'Business',
    taxId: '123456789',
    taxStatus: 'licensed',
    email: 'test@example.com',
    address: 'Address',
    phone: '0501234567',
  },
  invoice: { digitalSignatureText: 'Signed', generatedByText: 'Invofox' },
};

beforeEach(() => jest.clearAllMocks());

it('disables scripts and installs resource restrictions before loading invoice HTML', async () => {
  await generateInvoicePDFWithConfig(data, config);
  expect(mockBrowser.newPage).toHaveBeenCalledWith(
    expect.objectContaining({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
    })
  );
  expect(mockPage.route).toHaveBeenCalledWith('**/*', expect.any(Function));
  expect(mockPage.route.mock.invocationCallOrder[0]).toBeLessThan(
    mockPage.setContent.mock.invocationCallOrder[0]
  );
  expect(mockPage.setContent.mock.calls[0][0]).not.toContain('<script>');
  const args = (chromium.launch as jest.Mock).mock.calls[0][0].args;
  expect(args).not.toContain('--disable-web-security');
  expect(args).not.toContain('--disable-site-isolation-trials');
  expect(mockBrowser.close).toHaveBeenCalled();
});

it('closes the browser when rendering fails', async () => {
  mockPage.pdf.mockRejectedValueOnce(new Error('render failed'));
  await expect(generateInvoicePDFWithConfig(data, config)).rejects.toThrow('render failed');
  expect(mockBrowser.close).toHaveBeenCalled();
});

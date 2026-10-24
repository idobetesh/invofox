import { InvoicePDFService } from '../../src/services/invoice-pdf.service';
import { InvoiceReceiptPDFService } from '../../src/services/invoice-receipt-pdf.service';
import { ReceiptPDFService } from '../../src/services/receipt-pdf.service';

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

const params = {
  invoiceNumber: 'I-2026-1',
  invoiceReceiptNumber: 'IR-2026-1',
  receiptNumber: 'R-2026-1',
  customerName: '<script>alert(1)</script>',
  customerTaxId: '123456789',
  description: 'Service',
  amount: 100,
  currency: 'ILS',
  date: '24/10/2026',
  invoiceDate: '24/10/2026',
  receiptDate: '24/10/2026',
  paymentMethod: 'cash',
  isPartialPayment: false,
  remainingBalance: 0,
  businessName: 'Business',
  businessTaxId: '123456789',
  businessTaxStatus: 'licensed',
  businessEmail: 'test@example.com',
  businessAddress: 'Address',
  businessPhone: '0501234567',
  logoUrl: 'https://storage.googleapis.com/our-bucket/logos/123/logo.png',
};

beforeEach(() => jest.clearAllMocks());

it.each(['invoice', 'invoice_receipt', 'receipt'])(
  'secures admin %s rendering before loading customer content',
  async (type) => {
    if (type === 'invoice') {
      await new InvoicePDFService().generateInvoicePDF(params);
    } else if (type === 'invoice_receipt') {
      await new InvoiceReceiptPDFService().generateInvoiceReceiptPDF(params);
    } else {
      await new ReceiptPDFService().generateReceiptPDF(params);
    }
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
    expect(mockBrowser.close).toHaveBeenCalled();
  }
);

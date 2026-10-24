import { buildInvoiceHTML } from '../../../../shared/templates/invoice-template';
import { buildInvoiceReceiptHTML } from '../../../../shared/templates/invoice-receipt-template';
import { buildReceiptHTML } from '../../../../shared/templates/receipt-template';
import { escapeHtml, getSafeLogoUrl } from '../../../../shared/templates/template-utils';
import { restrictDocumentRequests } from '../../../../shared/pdf-security';

const base = {
  invoiceNumber: 'I-2026-1',
  invoiceReceiptNumber: 'IR-2026-1',
  receiptNumber: 'R-2026-1',
  customerName: 'לקוח & שותפים',
  customerTaxId: '123456789',
  description: 'שירות',
  amount: 1234.5,
  currency: 'ILS',
  date: '24/10/2026',
  invoiceDate: '24/10/2026',
  receiptDate: '24/10/2026',
  paymentMethod: 'מזומן',
  isPartialPayment: true,
  remainingBalance: 50,
  businessName: 'עסק',
  businessTaxId: '123456789',
  businessTaxStatus: 'licensed',
  businessEmail: 'test@example.com',
  businessAddress: 'רחוב 1',
  businessPhone: '0501234567',
};
const commonFields = [
  'customerName',
  'customerTaxId',
  'currency',
  'businessName',
  'businessTaxId',
  'businessTaxStatus',
  'businessEmail',
  'businessAddress',
  'businessPhone',
];
const templates = [
  {
    name: 'invoice',
    build: buildInvoiceHTML,
    fields: [...commonFields, 'invoiceNumber', 'description', 'date'],
  },
  {
    name: 'invoice-receipt',
    build: buildInvoiceReceiptHTML,
    fields: [...commonFields, 'invoiceReceiptNumber', 'description', 'date', 'paymentMethod'],
  },
  {
    name: 'receipt',
    build: buildReceiptHTML,
    fields: [
      ...commonFields,
      'receiptNumber',
      'invoiceNumber',
      'invoiceDate',
      'receiptDate',
      'paymentMethod',
    ],
  },
];
const payload =
  '</title><script>fetch("http://169.254.169.254/")</script><img src=x onerror="alert(1)">';

describe.each(templates)('$name template security', ({ build, fields }) => {
  it.each(fields)('renders hostile %s as text', (field) => {
    const html = build({ ...base, [field]: payload });
    expect(html).toContain(escapeHtml(payload));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
  });

  it('preserves Hebrew, entities and amount formatting', () => {
    const html = build(base);
    expect(html).toContain('לקוח &amp; שותפים');
    expect(html).toContain('₪1,234.50');
    expect(html).toContain("script-src 'none'");
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://169.254.169.254/logo.png',
    'https://attacker.example/logo.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'https://storage.googleapis.com/bucket/logos/logo.png" onerror="alert(1)',
  ])('rejects unsafe logo source %s', (logoUrl) => {
    expect(build({ ...base, logoUrl })).not.toContain('<img');
  });

  it('retains a raster data logo', () => {
    const logoUrl = 'data:image/png;base64,aGVsbG8=';
    expect(build({ ...base, logoUrl })).toContain(`src="${logoUrl}"`);
  });
});

it('escapes multi-invoice numbers and formatted dates in receipts', () => {
  const html = buildReceiptHTML({
    ...base,
    isMultiInvoiceReceipt: true,
    relatedInvoiceNumbers: [payload],
    relatedInvoiceDates: [payload],
  });
  expect(html).toContain(escapeHtml(payload));
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img src=x');
});

describe('Document resource restrictions', () => {
  const logo = 'https://storage.googleapis.com/our-bucket/logos/123/logo.png';

  it.each([
    ['http://169.254.169.254/computeMetadata/v1/', 'image'],
    ['http://127.0.0.1:3000/api/customers', 'document'],
    ['file:///etc/passwd', 'document'],
    ['https://attacker.example/exfiltrate', 'image'],
    ['https://storage.googleapis.com/another-bucket/logos/123/logo.png', 'image'],
    ['https://fonts.googleapis.com.attacker.example/css2', 'stylesheet'],
    ['https://fonts.googleapis.com/css2', 'script'],
    ['https://fonts.gstatic.com/s/font.woff2', 'document'],
    [logo, 'document'],
  ])('blocks %s (%s)', async (url, resourceType) => {
    const route = {
      request: () => ({ url: () => url, resourceType: () => resourceType }),
      abort: jest.fn(),
      continue: jest.fn(),
    };
    const page = {
      route: jest.fn(
        async (_pattern: string, handler: (requestRoute: typeof route) => Promise<void>) =>
          handler(route)
      ),
    };
    await restrictDocumentRequests(page, logo);
    expect(route.abort).toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it.each([
    ['https://fonts.googleapis.com/css2?family=Heebo', 'stylesheet'],
    ['https://fonts.gstatic.com/s/heebo/font.woff2', 'font'],
    [logo, 'image'],
  ])('allows required asset %s', async (url, resourceType) => {
    const route = {
      request: () => ({ url: () => url, resourceType: () => resourceType }),
      abort: jest.fn(),
      continue: jest.fn(),
    };
    const page = {
      route: jest.fn(
        async (_pattern: string, handler: (requestRoute: typeof route) => Promise<void>) =>
          handler(route)
      ),
    };
    await restrictDocumentRequests(page, logo);
    expect(route.continue).toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
  });

  it('accepts uploaded GCS logos but rejects credentials and unexpected paths', () => {
    expect(getSafeLogoUrl(logo)).toBe(logo);
    expect(
      getSafeLogoUrl('https://user:pass@storage.googleapis.com/our-bucket/logos/logo.png')
    ).toBeUndefined();
    expect(
      getSafeLogoUrl('https://storage.googleapis.com/our-bucket/invoices/logo.png')
    ).toBeUndefined();
  });
});

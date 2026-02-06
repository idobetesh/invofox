import { escapeHtml, buildInvoiceHTML } from '../../src/services/document-generator/template';
import type { InvoiceData, BusinessConfig } from '../../../../shared/types';

describe('Template Utilities', () => {
  describe('escapeHtml', () => {
    it('should escape ampersands', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape less than signs', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape greater than signs', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('should escape double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    it('should escape multiple special characters', () => {
      expect(escapeHtml('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should handle string with no special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    it('should handle Hebrew text', () => {
      expect(escapeHtml('שלום עולם')).toBe('שלום עולם');
    });

    it('should prevent XSS injection', () => {
      const malicious = '<script>alert("xss")</script>';
      const escaped = escapeHtml(malicious);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });
  });

  describe('Document Type Labels in PDF', () => {
    const mockBusinessConfig: BusinessConfig = {
      business: {
        name: 'Test Business',
        taxId: '123456789',
        taxStatus: 'licensed',
        email: 'test@example.com',
        phone: '0501234567',
        address: 'Test Address',
        sheetId: 'test-sheet-id',
      },
      invoice: {
        digitalSignatureText: 'מסמך ממוחשב חתום דיגיטלית',
        generatedByText: 'הופק ע"י Invofox',
      },
    };

    const baseInvoiceData: Omit<InvoiceData, 'documentType'> = {
      invoiceNumber: 'TEST-2026-1',
      customerName: 'Test Customer',
      description: 'Test Description',
      amount: 1000,
      date: '2026-01-01',
    };

    it('should render חשבונית for invoice type', () => {
      const invoiceData: InvoiceData = {
        ...baseInvoiceData,
        documentType: 'invoice',
      };

      const html = buildInvoiceHTML(invoiceData, mockBusinessConfig);

      expect(html).toContain('חשבונית / TEST-2026-1');
      expect(html).not.toContain('חשבונית מס - קבלה');
      expect(html).not.toContain('קבלה / TEST-2026-1');
    });

    it('should render חשבונית מס - קבלה for invoice_receipt type', () => {
      const invoiceData: InvoiceData = {
        ...baseInvoiceData,
        documentType: 'invoice_receipt',
        paymentMethod: 'מזומן',
      };

      const html = buildInvoiceHTML(invoiceData, mockBusinessConfig);

      expect(html).toContain('חשבונית מס - קבלה / TEST-2026-1');
      expect(html).not.toContain('חשבונית / TEST-2026-1');
    });

    it('should render קבלה for receipt type', () => {
      const invoiceData: InvoiceData = {
        ...baseInvoiceData,
        documentType: 'receipt',
        paymentMethod: 'מזומן',
      };

      const html = buildInvoiceHTML(invoiceData, mockBusinessConfig);

      expect(html).toContain('קבלה / TEST-2026-1');
      expect(html).not.toContain('חשבונית מס - קבלה');
      expect(html).not.toContain('חשבונית / TEST-2026-1');
    });
  });
});

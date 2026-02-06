/**
 * Invoice-Receipt PDF Generation Service
 * Generates PDF for invoice-receipts (invoice + immediate payment)
 * Uses shared template from /shared/templates
 */

import { chromium } from 'playwright';
import {
  buildInvoiceReceiptHTML,
  type InvoiceReceiptTemplateParams,
} from '../../../../shared/templates/invoice-receipt-template';

interface GenerateInvoiceReceiptPDFParams {
  invoiceReceiptNumber: string;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency: string;
  date: string; // DD/MM/YYYY
  paymentMethod: string;
  businessName: string;
  businessTaxId: string;
  businessTaxStatus: string;
  businessEmail: string;
  businessAddress: string;
  businessPhone: string;
  logoUrl?: string;
}

export class InvoiceReceiptPDFService {
  /**
   * Generate invoice-receipt PDF
   * Returns PDF as Buffer
   */
  async generateInvoiceReceiptPDF(params: GenerateInvoiceReceiptPDFParams): Promise<Buffer> {
    const templateParams: InvoiceReceiptTemplateParams = {
      invoiceReceiptNumber: params.invoiceReceiptNumber,
      customerName: params.customerName,
      customerTaxId: params.customerTaxId,
      description: params.description,
      amount: params.amount,
      currency: params.currency,
      date: params.date,
      paymentMethod: params.paymentMethod,
      businessName: params.businessName,
      businessTaxId: params.businessTaxId,
      businessTaxStatus: params.businessTaxStatus,
      businessEmail: params.businessEmail,
      businessAddress: params.businessAddress,
      businessPhone: params.businessPhone,
      logoUrl: params.logoUrl,
    };

    const html = buildInvoiceReceiptHTML(templateParams);

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
        printBackground: true,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}

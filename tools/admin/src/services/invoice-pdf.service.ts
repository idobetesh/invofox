/**
 * Invoice PDF Generation Service
 * Generates PDF invoices using Playwright
 * Uses shared template from /shared/templates
 */

import { chromium } from 'playwright';
import {
  buildInvoiceHTML,
  type InvoiceTemplateParams,
} from '../../../../shared/templates/invoice-template';

interface GenerateInvoicePDFParams {
  invoiceNumber: string;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency: string;
  date: string; // DD/MM/YYYY
  businessName: string;
  businessTaxId: string;
  businessTaxStatus: string;
  businessEmail: string;
  businessAddress: string;
  businessPhone: string;
  logoUrl?: string;
}

export class InvoicePDFService {
  /**
   * Generate invoice PDF
   * Returns PDF as Buffer
   */
  async generateInvoicePDF(params: GenerateInvoicePDFParams): Promise<Buffer> {
    const templateParams: InvoiceTemplateParams = {
      invoiceNumber: params.invoiceNumber,
      customerName: params.customerName,
      customerTaxId: params.customerTaxId,
      description: params.description,
      amount: params.amount,
      currency: params.currency,
      date: params.date,
      businessName: params.businessName,
      businessTaxId: params.businessTaxId,
      businessTaxStatus: params.businessTaxStatus,
      businessEmail: params.businessEmail,
      businessAddress: params.businessAddress,
      businessPhone: params.businessPhone,
      logoUrl: params.logoUrl,
    };

    const html = buildInvoiceHTML(templateParams);

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

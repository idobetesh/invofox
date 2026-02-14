/**
 * Receipt PDF Generation Service (No Database)
 * Pure PDF generation for testing
 * Uses shared template from /shared/templates
 */

import { chromium } from 'playwright';
import {
  buildReceiptHTML,
  type ReceiptTemplateParams,
} from '../../../../shared/templates/receipt-template';

interface GenerateReceiptPDFParams {
  receiptNumber: string;
  invoiceNumber: string;
  invoiceDate: string; // DD/MM/YYYY
  customerName: string;
  customerTaxId?: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  receiptDate: string; // DD/MM/YYYY
  isPartialPayment: boolean;
  remainingBalance: number;
  businessName: string;
  businessTaxId: string;
  businessTaxStatus: string;
  businessEmail: string;
  businessAddress: string;
  businessPhone: string;
  logoUrl?: string;
  // Multi-invoice receipt fields
  isMultiInvoiceReceipt?: boolean;
  relatedInvoiceNumbers?: string[];
  relatedInvoiceDates?: string[];
}

export class ReceiptPDFService {
  /**
   * Generate receipt PDF without database operations
   * Returns PDF as Buffer
   */
  async generateReceiptPDF(params: GenerateReceiptPDFParams): Promise<Buffer> {
    const templateParams: ReceiptTemplateParams = {
      receiptNumber: params.receiptNumber,
      invoiceNumber: params.invoiceNumber,
      invoiceDate: params.invoiceDate,
      customerName: params.customerName,
      customerTaxId: params.customerTaxId,
      amount: params.amount,
      currency: params.currency,
      paymentMethod: params.paymentMethod,
      receiptDate: params.receiptDate,
      isPartialPayment: params.isPartialPayment,
      remainingBalance: params.remainingBalance,
      businessName: params.businessName,
      businessTaxId: params.businessTaxId,
      businessTaxStatus: params.businessTaxStatus,
      businessEmail: params.businessEmail,
      businessAddress: params.businessAddress,
      businessPhone: params.businessPhone,
      logoUrl: params.logoUrl,
      // Multi-invoice receipt fields
      isMultiInvoiceReceipt: params.isMultiInvoiceReceipt,
      relatedInvoiceNumbers: params.relatedInvoiceNumbers,
      relatedInvoiceDates: params.relatedInvoiceDates,
    };

    const html = buildReceiptHTML(templateParams);

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

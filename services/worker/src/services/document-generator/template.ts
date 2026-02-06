/**
 * Invoice HTML template builder
 * Now uses shared templates from /shared/templates
 */

import type { InvoiceData, BusinessConfig, InvoiceSession } from '../../../../../shared/types';
import {
  buildInvoiceHTML as buildInvoiceTemplate,
  escapeHtml,
  type InvoiceTemplateParams,
} from '../../../../../shared/templates/invoice-template';
import {
  buildInvoiceReceiptHTML as buildInvoiceReceiptTemplate,
  type InvoiceReceiptTemplateParams,
} from '../../../../../shared/templates/invoice-receipt-template';
import {
  buildReceiptHTML as buildReceiptTemplate,
  type ReceiptTemplateParams,
} from '../../../../../shared/templates/receipt-template';

export { escapeHtml };

/**
 * Format date from YYYY-MM-DD to DD/MM/YYYY
 */
function formatDateForInvoice(date: string): string {
  const parts = date.split('-');
  if (parts.length !== 3) {
    return date;
  }
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Build complete HTML for invoice/invoice-receipt/receipt PDF
 * @param data - Invoice data
 * @param businessConfig - Business configuration
 * @param logoBase64 - Optional logo as base64 data URL
 * @param session - Optional invoice session (needed for receipt-specific data)
 */
export function buildInvoiceHTML(
  data: InvoiceData,
  businessConfig: BusinessConfig,
  logoBase64?: string | null,
  session?: InvoiceSession
): string {
  const formattedDate = formatDateForInvoice(data.date);

  // Invoice-Receipt
  if (data.documentType === 'invoice_receipt') {
    const params: InvoiceReceiptTemplateParams = {
      invoiceReceiptNumber: data.invoiceNumber,
      customerName: data.customerName,
      customerTaxId: data.customerTaxId,
      description: data.description,
      amount: data.amount,
      currency: 'ILS',
      date: formattedDate,
      paymentMethod: data.paymentMethod || 'מזומן',
      businessName: businessConfig.business.name,
      businessTaxId: businessConfig.business.taxId,
      businessTaxStatus: businessConfig.business.taxStatus,
      businessEmail: businessConfig.business.email,
      businessAddress: businessConfig.business.address,
      businessPhone: businessConfig.business.phone,
      logoUrl: logoBase64 || undefined,
    };
    return buildInvoiceReceiptTemplate(params);
  }

  // Receipt - Note: this is currently not used as receipts aren't generated via this path yet
  // Receipts will need parent invoice data which should be passed via session
  if (data.documentType === 'receipt') {
    const params: ReceiptTemplateParams = {
      receiptNumber: data.invoiceNumber,
      invoiceNumber: session?.relatedInvoiceNumber || '',
      invoiceDate: formattedDate,
      customerName: data.customerName,
      customerTaxId: data.customerTaxId,
      amount: data.amount,
      paymentMethod: data.paymentMethod || 'מזומן',
      receiptDate: formattedDate,
      isPartialPayment: false, // TODO: Calculate from parent invoice
      remainingBalance: 0, // TODO: Calculate from parent invoice
      businessName: businessConfig.business.name,
      businessTaxId: businessConfig.business.taxId,
      businessTaxStatus: businessConfig.business.taxStatus,
      businessEmail: businessConfig.business.email,
      businessAddress: businessConfig.business.address,
      businessPhone: businessConfig.business.phone,
      logoUrl: logoBase64 || undefined,
    };
    return buildReceiptTemplate(params);
  }

  // Regular Invoice
  const params: InvoiceTemplateParams = {
    invoiceNumber: data.invoiceNumber,
    customerName: data.customerName,
    customerTaxId: data.customerTaxId,
    description: data.description,
    amount: data.amount,
    currency: 'ILS',
    date: formattedDate,
    businessName: businessConfig.business.name,
    businessTaxId: businessConfig.business.taxId,
    businessTaxStatus: businessConfig.business.taxStatus,
    businessEmail: businessConfig.business.email,
    businessAddress: businessConfig.business.address,
    businessPhone: businessConfig.business.phone,
    logoUrl: logoBase64 || undefined,
  };
  return buildInvoiceTemplate(params);
}

/**
 * Invoice HTML template builder
 * Now uses shared templates from /shared/templates
 */

import type {
  InvoiceData,
  BusinessConfig,
  InvoiceSession,
  GeneratedInvoice,
} from '../../../../../shared/types';
import {
  buildInvoiceHTML as buildInvoiceTemplate,
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
import { escapeHtml } from '../../../../../shared/templates/template-utils';

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
 * @param session - Optional invoice session (required for receipts)
 * @param parentInvoice - Parent invoice (required for receipts)
 * @param parentInvoices - Array of parent invoices (for multi-invoice receipts)
 */
export function buildInvoiceHTML(
  data: InvoiceData,
  businessConfig: BusinessConfig,
  logoBase64?: string | null,
  session?: InvoiceSession,
  parentInvoice?: GeneratedInvoice | null,
  parentInvoices?: GeneratedInvoice[]
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
      currency: data.currency || 'ILS', // Use currency from data, default to ILS
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

  // Receipt - Must have parent invoice data
  if (data.documentType === 'receipt') {
    // NEW: Unified path for both single and multi-invoice receipts (using parentInvoices array)
    if (parentInvoices && parentInvoices.length >= 1) {
      // Works for both single (length=1) and multi (length>=2) invoice receipts
      const isSingleInvoice = parentInvoices.length === 1;
      const isMultiInvoice = parentInvoices.length >= 2;

      // For multi-invoice receipts, all invoices are paid in full
      // For single-invoice receipts, payment may be full or partial
      const isPartialPayment = isSingleInvoice && data.amount < parentInvoices[0].amount;
      const remainingBalance = isSingleInvoice
        ? Math.max(
            0,
            (parentInvoices[0].remainingBalance || parentInvoices[0].amount) - data.amount
          )
        : 0;

      const params: ReceiptTemplateParams = {
        receiptNumber: data.invoiceNumber,
        invoiceNumber: parentInvoices[0].invoiceNumber, // For backward compatibility
        invoiceDate: parentInvoices[0].date, // For backward compatibility
        customerName: data.customerName,
        customerTaxId: data.customerTaxId,
        amount: data.amount,
        currency: parentInvoices[0].currency, // Use first invoice currency (should all be same)
        paymentMethod: data.paymentMethod || 'מזומן',
        receiptDate: formattedDate,
        isPartialPayment,
        remainingBalance,
        businessName: businessConfig.business.name,
        businessTaxId: businessConfig.business.taxId,
        businessTaxStatus: businessConfig.business.taxStatus,
        businessEmail: businessConfig.business.email,
        businessAddress: businessConfig.business.address,
        businessPhone: businessConfig.business.phone,
        logoUrl: logoBase64 || undefined,
        // Multi-invoice specific fields (only for 2+ invoices)
        ...(isMultiInvoice && {
          isMultiInvoiceReceipt: true,
          relatedInvoiceNumbers: parentInvoices.map((inv) => inv.invoiceNumber),
          relatedInvoiceDates: parentInvoices.map((inv) => inv.date),
        }),
      };
      return buildReceiptTemplate(params);
    } else if (session?.relatedInvoiceNumber && parentInvoice) {
      // LEGACY: Old receipts created before multi-select (for backward compatibility)
      // Calculate payment tracking info
      const newRemainingBalance =
        (parentInvoice.remainingBalance || parentInvoice.amount) - data.amount;
      const isPartialPayment = newRemainingBalance > 0;

      const params: ReceiptTemplateParams = {
        receiptNumber: data.invoiceNumber,
        invoiceNumber: session.relatedInvoiceNumber,
        invoiceDate: parentInvoice.date, // Use parent invoice date, not receipt date
        customerName: data.customerName,
        customerTaxId: data.customerTaxId,
        amount: data.amount,
        currency: parentInvoice.currency, // Use parent invoice currency
        paymentMethod: data.paymentMethod || 'מזומן',
        receiptDate: formattedDate,
        isPartialPayment,
        remainingBalance: Math.max(0, newRemainingBalance),
        businessName: businessConfig.business.name,
        businessTaxId: businessConfig.business.taxId,
        businessTaxStatus: businessConfig.business.taxStatus,
        businessEmail: businessConfig.business.email,
        businessAddress: businessConfig.business.address,
        businessPhone: businessConfig.business.phone,
        logoUrl: logoBase64 || undefined,
      };
      return buildReceiptTemplate(params);
    } else {
      throw new Error(
        'Receipt generation requires either parentInvoices array or session with relatedInvoiceNumber and parentInvoice'
      );
    }
  }

  // Regular Invoice
  const params: InvoiceTemplateParams = {
    invoiceNumber: data.invoiceNumber,
    customerName: data.customerName,
    customerTaxId: data.customerTaxId,
    description: data.description,
    amount: data.amount,
    currency: data.currency || 'ILS', // Use currency from data, default to ILS
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

/**
 * Document Generation API Module
 * Handles API calls for invoice, receipt, and invoice-receipt generation
 */

import { API_BASE } from './utils.js';

/**
 * Generate an unpaid invoice
 * @param {Object} data - Invoice data
 * @param {string} data.chatId - Business chat ID
 * @param {string} data.customerName - Customer name
 * @param {string} [data.customerTaxId] - Customer tax ID (optional)
 * @param {string} data.description - Service/product description
 * @param {number} data.amount - Invoice amount
 * @param {string} data.currency - Currency code (ILS, USD, EUR)
 * @param {string} data.date - Invoice date (YYYY-MM-DD)
 * @returns {Promise<Object>} Generated invoice with invoiceNumber
 */
export async function generateInvoice(data) {
  console.log('Generating invoice with data:', data);

  const response = await fetch(`${API_BASE}/invoices/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  console.log('Invoice API response status:', response.status);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Invoice generation failed:', error);
    throw new Error(error.message || error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  console.log('Invoice generated successfully:', result);
  return result;
}

/**
 * Generate a receipt for an existing invoice
 * @param {Object} data - Receipt data
 * @param {string} data.invoiceNumber - Existing invoice number
 * @param {number} data.paymentAmount - Payment amount received
 * @param {string} data.paymentMethod - Payment method
 * @param {string} data.date - Receipt date (YYYY-MM-DD)
 * @returns {Promise<Object>} Generated receipt with receiptNumber
 */
export async function generateReceipt(data) {
  console.log('Generating receipt with data:', data);

  const response = await fetch(`${API_BASE}/receipts/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  console.log('Receipt API response status:', response.status);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Receipt generation failed:', error);
    throw new Error(error.message || error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  console.log('Receipt generated successfully:', result);
  return result;
}

/**
 * Generate a paid invoice-receipt (combined document)
 * @param {Object} data - Invoice-receipt data
 * @param {string} data.chatId - Business chat ID
 * @param {string} data.customerName - Customer name
 * @param {string} [data.customerTaxId] - Customer tax ID (optional)
 * @param {string} data.description - Service/product description
 * @param {number} data.amount - Amount
 * @param {string} data.currency - Currency code (ILS, USD, EUR)
 * @param {string} data.paymentMethod - Payment method
 * @param {string} data.date - Document date (YYYY-MM-DD)
 * @returns {Promise<Object>} Generated invoice-receipt with invoiceReceiptNumber
 */
export async function generateInvoiceReceipt(data) {
  console.log('Generating invoice-receipt with data:', data);

  const response = await fetch(`${API_BASE}/invoice-receipts/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  console.log('Invoice-receipt API response status:', response.status);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Invoice-receipt generation failed:', error);
    throw new Error(error.message || error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  console.log('Invoice-receipt generated successfully:', result);
  return result;
}

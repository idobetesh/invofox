/**
 * Invoice HTML template builder
 * Generates RTL Hebrew invoice HTML for PDF rendering
 */

import type { InvoiceData, BusinessConfig, InvoiceDocumentType } from '../../../../../shared/types';

/**
 * Escape HTML to prevent XSS/injection in user input
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

/**
 * Get document type label in Hebrew
 */
function getDocumentTypeLabel(type: InvoiceDocumentType): string {
  return type === 'invoice' ? 'חשבונית' : 'חשבונית קבלה';
}

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
 * Build complete HTML for invoice PDF
 * @param data - Invoice data
 * @param businessConfig - Business configuration
 * @param logoBase64 - Optional logo as base64 data URL
 */
export function buildInvoiceHTML(
  data: InvoiceData,
  businessConfig: BusinessConfig,
  logoBase64?: string | null
): string {
  const documentTypeLabel = getDocumentTypeLabel(data.documentType);
  const formattedDate = formatDateForInvoice(data.date);
  const escapedCustomerName = escapeHtml(data.customerName);
  const escapedDescription = escapeHtml(data.description);
  const escapedCustomerTaxId = data.customerTaxId ? escapeHtml(data.customerTaxId) : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${documentTypeLabel} / ${data.invoiceNumber}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Heebo', 'Arial', 'DejaVu Sans', 'Liberation Sans', sans-serif;
      direction: rtl;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      background: #fff;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 2px solid #2563eb;
      margin-bottom: 20px;
    }
    
    .logo-section {
      display: flex;
      align-items: center;
    }
    
    .logo {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      object-fit: contain;
      margin-left: 15px;
      background: #f8f9fa;
      padding: 8px;
    }
    
    .business-info {
      text-align: right;
      font-size: 13px;
      color: #555;
    }
    
    .business-info .business-name {
      font-size: 18px;
      font-weight: 700;
      color: #333;
      margin-bottom: 5px;
    }
    
    .business-info p {
      margin: 2px 0;
    }
    
    .invoice-title-bar {
      background: #2563eb;
      color: white;
      text-align: center;
      padding: 12px 20px;
      margin: 20px 0;
      font-size: 18px;
      font-weight: 700;
      border-radius: 4px;
    }
    
    .meta-section {
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid #ddd;
    }
    
    .meta-item {
      font-size: 13px;
    }
    
    .meta-label {
      color: #666;
    }
    
    .meta-value {
      font-weight: 500;
    }
    
    .customer-section {
      margin-bottom: 25px;
    }
    
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
    }
    
    .customer-info {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 4px;
    }
    
    .customer-name {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 5px;
    }
    
    .customer-tax-id {
      font-size: 13px;
      color: #666;
    }
    
    .description-section {
      margin-bottom: 25px;
    }
    
    .description-text {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 4px;
      font-size: 14px;
    }
    
    .payment-section {
      margin-bottom: 30px;
    }
    
    .payment-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    
    .payment-table th {
      background: #f1f5f9;
      padding: 12px 15px;
      text-align: right;
      font-weight: 600;
      border: 1px solid #ddd;
      font-size: 13px;
    }
    
    .payment-table td {
      padding: 12px 15px;
      text-align: right;
      border: 1px solid #ddd;
      font-size: 14px;
    }
    
    .total-row {
      background: #f8f9fa;
    }
    
    .total-row td {
      font-weight: 700;
      font-size: 16px;
    }
    
    .total-label {
      text-align: center !important;
      font-weight: 700;
    }
    
    .amount {
      font-weight: 700;
      color: #2563eb;
    }
    
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-size: 12px;
      color: #666;
    }
    
    .digital-signature {
      text-align: left;
    }
    
    .signature-text {
      font-weight: 600;
      color: #333;
      margin-bottom: 3px;
    }
    
    .generated-by {
      font-size: 11px;
    }
    
    .generation-date {
      text-align: right;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="business-info">
      <div class="business-name">${escapeHtml(businessConfig.business.name)}</div>
      <p>${escapeHtml(businessConfig.business.taxStatus)}: ${escapeHtml(businessConfig.business.taxId)}</p>
      <p>${escapeHtml(businessConfig.business.email)}</p>
      <p>כתובת: ${escapeHtml(businessConfig.business.address)}</p>
      <p>${escapeHtml(businessConfig.business.phone)}</p>
    </div>
    <div class="logo-section">
      ${
        logoBase64
          ? `<img src="${logoBase64}" class="logo" alt="לוגו העסק" />`
          : '<div style="width: 100px; height: 100px; background: #e5e7eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #666;">📄</div>'
      }
    </div>
  </div>

  <!-- Invoice Title Bar -->
  <div class="invoice-title-bar">
    ${documentTypeLabel} / ${data.invoiceNumber}
  </div>

  <!-- Meta Section -->
  <div class="meta-section">
    <div class="meta-item">
      <span class="meta-label">עבור:</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">מקור</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">תאריך מסמך: </span>
      <span class="meta-value">${formattedDate}</span>
    </div>
  </div>

  <!-- Customer Section -->
  <div class="customer-section">
    <div class="customer-info">
      <div class="customer-name">שם: ${escapedCustomerName}</div>
      ${escapedCustomerTaxId ? `<div class="customer-tax-id">עוסק מס׳: ${escapedCustomerTaxId}</div>` : '<div class="customer-tax-id">עוסק מס׳: 0</div>'}
    </div>
  </div>

  <!-- Description Section -->
  <div class="description-section">
    <div class="description-text">
      ${escapedDescription}
    </div>
  </div>

  <!-- Payment Section -->
  <div class="payment-section">
    <div class="section-title">פרטי תשלומים:</div>
    <table class="payment-table">
      <thead>
        <tr>
          <th>סוג תשלום</th>
          <th>פרטים</th>
          <th>תאריך</th>
          <th>סה״כ(₪)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(data.paymentMethod)}</td>
          <td></td>
          <td>${formattedDate}</td>
          <td class="amount">${data.amount.toFixed(2)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="3" class="total-label">סה״כ שולם</td>
          <td class="amount">₪${data.amount.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="generation-date">
      תאריך הפקה: ${formattedDate}
    </div>
    <div class="digital-signature">
      <div class="signature-text">${escapeHtml(businessConfig.invoice.digitalSignatureText)}</div>
      <div class="generated-by">${escapeHtml(businessConfig.invoice.generatedByText)}</div>
    </div>
  </div>
</body>
</html>`;
}

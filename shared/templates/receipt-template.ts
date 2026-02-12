/**
 * Shared Receipt Template
 * Used by both admin tool and worker service
 * For standalone receipts linked to invoices
 */

import { getCurrencySymbol, formatAmount } from './template-utils';

export interface ReceiptTemplateParams {
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
}

/**
 * Build receipt HTML
 */
export function buildReceiptHTML(params: ReceiptTemplateParams): string {
  const {
    receiptNumber,
    invoiceNumber,
    invoiceDate,
    customerName,
    customerTaxId = '0',
    amount,
    currency,
    paymentMethod,
    receiptDate,
    isPartialPayment,
    remainingBalance,
    businessName,
    businessTaxId,
    businessTaxStatus,
    businessEmail,
    businessAddress,
    businessPhone,
    logoUrl,
  } = params;

  const currencySymbol = getCurrencySymbol(currency);
  const logoHTML = logoUrl
    ? `<img src="${logoUrl}" class="logo" alt="לוגו העסק" />`
    : '<div style="width: 100px; height: 100px; background: #e5e7eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #666;">📄</div>';

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>קבלה / ${receiptNumber}</title>
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

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
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

    .related-invoice-info {
      padding: 12px 0;
      margin-bottom: 20px;
    }

    .related-invoice-info .text {
      font-size: 14px;
      color: #333;
      text-align: right;
    }

    .remaining-balance-info {
      padding: 12px 0;
      margin: 20px 0;
    }

    .remaining-balance-info .text {
      font-size: 14px;
      color: #333;
      text-align: right;
    }

    .remaining-balance-info .amount {
      font-weight: 600;
      color: #333;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="business-info">
      <div class="business-name">${businessName}</div>
      <p>${businessTaxStatus}: ${businessTaxId}</p>
      <p>${businessEmail}</p>
      <p>כתובת: ${businessAddress}</p>
      <p>${businessPhone}</p>
    </div>
    <div class="logo-section">
      ${logoHTML}
    </div>
  </div>

  <!-- Invoice Title Bar -->
  <div class="invoice-title-bar">
    קבלה / ${receiptNumber}
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
      <span class="meta-value">${receiptDate}</span>
    </div>
  </div>

  <!-- Related Invoice Section -->
  <div class="related-invoice-info">
    <div class="text">מסמך זה מקושר לחשבונית</div>
    <div class="text" style="font-size: 13px; color: #666; margin-top: 4px;">מספר חשבונית: ${invoiceNumber} | תאריך: ${invoiceDate}</div>
  </div>

  <!-- Customer Section -->
  <div class="customer-section">
    <div class="customer-info">
      <div class="customer-name">שם: ${customerName}</div>
      <div class="customer-tax-id">עוסק מס׳: ${customerTaxId}</div>
    </div>
  </div>

  <!-- Payment Section -->
  <div class="payment-section">
    <div class="section-title">פרטי תשלום:</div>
    <table class="payment-table">
      <thead>
        <tr>
          <th>סוג תשלום</th>
          <th>פרטים</th>
          <th>תאריך</th>
          <th>סה״כ(${currencySymbol})</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${paymentMethod}</td>
          <td></td>
          <td>${receiptDate}</td>
          <td class="amount">${currencySymbol}${formatAmount(amount)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="3" class="total-label">סה״כ שולם</td>
          <td class="amount">${currencySymbol}${formatAmount(amount)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${
    isPartialPayment
      ? `
  <!-- Remaining Balance Info -->
  <div class="remaining-balance-info">
    <div class="text">יתרה לתשלום: <span class="amount">${currencySymbol}${formatAmount(remainingBalance)}</span></div>
  </div>
  `
      : `
  <!-- Full Payment Info -->
  <div class="remaining-balance-info">
    <div class="text">שולם במלואו</div>
  </div>
  `
  }

  <!-- Footer -->
  <div class="footer">
    <div class="generation-date">
      תאריך הפקה: ${receiptDate}
    </div>
    <div class="digital-signature">
      <div class="signature-text">מסמך ממוחשב חתום דיגיטלית</div>
      <div class="generated-by">הופק ע"י Invofox</div>
    </div>
  </div>
</body>
</html>`;
}

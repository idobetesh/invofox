/**
 * Report HTML Template
 * Template for generating PDF reports with Hebrew RTL support
 */

import type {
  ReportData,
  DateRange,
  BalanceInvoiceForReport,
  ReportType,
} from '../../../../../shared/report.types';
import { REPORT_TYPE_NAMES, REPORT_CHART_TITLES } from '../../../../../shared/report.types';

/**
 * Get currency symbol for display
 */
function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    ILS: '₪',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  };
  return symbols[currency] || currency + ' ';
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Format date range for display (dd/mm/yyyy - dd/mm/yyyy)
 */
function formatDateRange(range: DateRange): string {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  return `${formatDate(range.start)} - ${formatDate(range.end)}`;
}

/**
 * Format invoice date for display (dd/mm/yyyy)
 */
function formatInvoiceDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Group invoices by time period (day or month)
 */
function groupInvoicesByPeriod(
  invoices: ReportData['invoices'],
  dateRange: DateRange
): { labels: string[]; data: number[] } {
  const preset = dateRange.preset;
  const groupByMonth = preset === 'ytd';

  // Create a map to store totals by period
  const periodMap = new Map<string, number>();

  // Group invoices
  invoices.forEach((inv) => {
    const date = new Date(inv.date);
    let key: string;

    if (groupByMonth) {
      // Group by month (e.g., "2026-01" for January 2026)
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else {
      // Group by day (e.g., "2026-01-15")
      key = inv.date;
    }

    const current = periodMap.get(key) || 0;
    periodMap.set(key, current + inv.amount);
  });

  // Fill in missing periods with zeros
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);
  const filledMap = new Map<string, number>();

  if (groupByMonth) {
    // Fill months
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const key = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      filledMap.set(key, periodMap.get(key) || 0);
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  } else {
    // Fill days
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const key = currentDate.toISOString().split('T')[0];
      filledMap.set(key, periodMap.get(key) || 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Convert to arrays and format labels
  const labels: string[] = [];
  const data: number[] = [];

  filledMap.forEach((value, key) => {
    if (groupByMonth) {
      // Format as "mm/yy" (e.g., "01/26", "02/26")
      const [year, month] = key.split('-');
      const shortYear = year.slice(-2); // Last 2 digits of year
      labels.push(`${month}/${shortYear}`);
    } else {
      // Format as "dd/mm" with padding (e.g., "03/01", "15/01")
      const date = new Date(key);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      labels.push(`${day}/${month}`);
    }
    data.push(value);
  });

  return { labels, data };
}

/**
 * Generate chart configuration as JSON
 */
function generateChartConfig(
  labels: string[],
  data: number[],
  reportType: string,
  currency: string
): string {
  const title = REPORT_CHART_TITLES[reportType as ReportType] || 'מגמה';
  const currencySymbol = getCurrencySymbol(currency);
  // Use nicer colors with gradients
  const backgroundColor =
    reportType === 'revenue'
      ? 'rgba(59, 130, 246, 0.8)'
      : reportType === 'balance'
        ? 'rgba(16, 185, 129, 0.8)'
        : 'rgba(239, 68, 68, 0.8)';
  const borderColor =
    reportType === 'revenue'
      ? 'rgb(37, 99, 235)'
      : reportType === 'balance'
        ? 'rgb(5, 150, 105)'
        : 'rgb(220, 38, 38)';
  const hoverColor =
    reportType === 'revenue'
      ? 'rgba(37, 99, 235, 0.9)'
      : reportType === 'balance'
        ? 'rgba(5, 150, 105, 0.9)'
        : 'rgba(220, 38, 38, 0.9)';

  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: title,
          data,
          backgroundColor: backgroundColor,
          borderColor: borderColor,
          borderWidth: 2,
          hoverBackgroundColor: hoverColor,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: {
              size: 14,
              weight: 500,
            },
            // Use a marker string that will be replaced with the actual callback function
            callback: '__CURRENCY_CALLBACK_PLACEHOLDER__' as unknown as (value: number) => string,
          },
        },
        x: {
          ticks: {
            font: {
              size: 14,
              weight: 500,
            },
            maxRotation: 45,
            minRotation: 45,
          },
        },
      },
    },
  };

  // JSON.stringify drops functions, so we need to manually build the config string
  // with the callback function included
  const configStr = JSON.stringify(config);
  // Replace the placeholder marker with the actual callback function that includes currency symbol
  return configStr.replace(
    '"callback":"__CURRENCY_CALLBACK_PLACEHOLDER__"',
    `"callback":function(value){return '${currencySymbol}'+value.toLocaleString();}`
  );
}

/**
 * Generate complete HTML for PDF report
 */
export function generateReportHTML(data: ReportData): string {
  const { metrics, dateRange, businessName, logoUrl, invoices, reportType } = data;
  const primaryCurrency = metrics.currencies[0]?.currency || 'ILS';
  const primarySymbolEsc = escapeHtml(getCurrencySymbol(primaryCurrency));

  // Dynamic titles based on report type
  const reportTitle = `דוח ${REPORT_TYPE_NAMES[reportType]}`;

  // Generate chart data
  const chartData = groupInvoicesByPeriod(invoices, dateRange);
  const chartConfig = generateChartConfig(
    chartData.labels,
    chartData.data,
    reportType,
    primaryCurrency
  );

  return `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${reportTitle}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', sans-serif;
      direction: rtl;
      padding: 20px;
      color: #333;
      font-size: 14px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 20px;
    }
    .header-right {
      text-align: right;
      flex: 1;
    }
    .header-right h1 { font-size: 24px; color: #2563eb; margin-bottom: 10px; }
    .header-right .business { font-size: 15px; color: #666; margin-bottom: 5px; }
    .header-right .period { font-size: 12px; color: #999; }
    .header-left {
      display: flex;
      align-items: center;
      margin-left: 20px;
    }
    .logo {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      object-fit: cover;
    }
    .logo-placeholder {
      width: 80px;
      height: 80px;
      background: #e5e7eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: #666;
    }

    .table-container { margin-bottom: 30px; }
    .table-container h2 { color: #2563eb; margin-bottom: 15px; font-size: 18px; }

    .chart-container {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      page-break-inside: avoid;
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
    }
    .chart-container h2 { color: #2563eb; margin-bottom: 15px; font-size: 18px; }
    .chart-wrapper {
      position: relative;
      width: 100%;
      height: 200px;
    }
    #revenueChart {
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      font-size: 13px;
    }
    th {
      background: #2563eb;
      color: white;
      padding: 10px;
      text-align: right;
      font-weight: bold;
      font-size: 13px;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #e5e7eb;
      text-align: right;
      font-size: 13px;
    }
    tr:hover { background: #f9fafb; }
    a {
      color: #2563eb;
      text-decoration: none;
      font-weight: 500;
    }
    a:hover {
      color: #1d4ed8;
      text-decoration: underline;
    }

    .summary {
      background: #f3f4f6;
      padding: 20px;
      border-radius: 8px;
      margin-top: 30px;
      page-break-before: always;
      page-break-after: avoid;
    }
    .summary h2 { color: #2563eb; margin-bottom: 15px; font-size: 18px; }
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }
    .metric {
      background: white;
      padding: 15px;
      border-radius: 6px;
      border-right: 4px solid #2563eb;
    }
    .metric .label { font-size: 12px; color: #666; margin-bottom: 5px; }
    .metric .value { font-size: 20px; font-weight: bold; color: #111; }
    .metric.highlight { border-right-color: #10b981; }
    .metric.warning { border-right-color: #f59e0b; }

    .status-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-paid {
      background: #d1fae5;
      color: #047857;
    }
    .status-unpaid {
      background: #fef3c7;
      color: #92400e;
    }
    .status-partial {
      background: #dbeafe;
      color: #1e40af;
    }

    .collection-rate {
      margin-top: 15px;
      padding: 12px;
      background: white;
      border-radius: 6px;
      border-right: 4px solid #8b5cf6;
      font-size: 14px;
    }
    .collection-rate .label { color: #666; margin-left: 8px; }
    .collection-rate .value { font-weight: bold; color: #8b5cf6; font-size: 16px; }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      text-align: center;
      color: #999;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-right">
      <h1>${reportTitle}</h1>
      <div class="business">${escapeHtml(businessName)}</div>
      <div class="period">${formatDateRange(dateRange)}</div>
    </div>
    <div class="header-left">
      ${
        logoUrl
          ? `<img src="${escapeHtml(logoUrl)}" class="logo" alt="Logo" />`
          : '<div class="logo-placeholder">📄</div>'
      }
    </div>
  </div>

  <div class="table-container">
    <h2>פירוט ${reportType === 'balance' ? 'מסמכים' : reportType === 'revenue' ? 'חשבוניות' : 'הוצאות'}</h2>
    <table>
      <thead>
        <tr>
          ${reportType === 'balance' ? '<th>סוג</th>' : ''}
          <th>תאריך</th>
          <th>${reportType === 'revenue' ? 'לקוח' : reportType === 'expenses' ? 'ספק' : 'לקוח/ספק'}</th>
          <th>סכום</th>
          ${reportType === 'revenue' ? '<th>סטטוס</th>' : ''}
          <th>קטגוריה</th>
        </tr>
      </thead>
      <tbody>
        ${invoices
          .filter((inv) => !inv.isLinkedReceipt) // Filter out linked receipts
          .map((inv) => {
            // Determine if this is an expense (for balance reports)
            const isExpense =
              reportType === 'balance' &&
              (inv as BalanceInvoiceForReport).reportSource === 'expenses';
            const rowStyle = isExpense ? ' style="background-color: #fee2e2;"' : '';

            // Type cell for balance reports
            let typeCell = '';
            if (reportType === 'balance') {
              const typeText = isExpense ? 'הוצאה' : 'הכנסה';
              const typeColor = isExpense ? '#dc2626' : '#059669';
              typeCell = `<td style="font-weight: 600; color: ${typeColor};">${typeText}</td>`;
            }

            // Status badge only for revenue (and revenue items in balance)
            let statusCell = '';
            if (reportType === 'revenue' || (reportType === 'balance' && !isExpense)) {
              let statusText = 'ממתין';
              let statusClass = 'status-unpaid';

              if (inv.paymentStatus === 'paid') {
                statusText = 'שולם';
                statusClass = 'status-paid';
              } else if (inv.paymentStatus === 'partial') {
                const symbol = getCurrencySymbol(inv.currency);
                statusText = `חלקי (${escapeHtml(symbol)}${(inv.paidAmount || 0).toLocaleString()})`;
                statusClass = 'status-partial';
              }
              statusCell = `<td><span class="status-badge ${statusClass}">${escapeHtml(statusText)}</span></td>`;
            }

            // Amount display (negative for expenses in balance reports)
            const amountDisplay = isExpense
              ? `-${escapeHtml(getCurrencySymbol(inv.currency))}${inv.amount.toLocaleString()}`
              : `${escapeHtml(getCurrencySymbol(inv.currency))}${inv.amount.toLocaleString()}`;

            return `
          <tr${rowStyle}>
            ${typeCell}
            <td>${formatInvoiceDate(inv.date)}</td>
            <td>${
              inv.driveLink
                ? `<a href="${escapeHtml(inv.driveLink)}" target="_blank" title="לחץ לפתיחת ה${isExpense ? 'קבלה' : 'חשבונית'}">${escapeHtml(inv.customerName)}</a>`
                : escapeHtml(inv.customerName)
            }</td>
            <td>${amountDisplay}</td>
            ${statusCell}
            <td>${escapeHtml(inv.category || 'כללי')}</td>
          </tr>
        `;
          })
          .join('')}
      </tbody>
    </table>
  </div>

  <div class="summary">
    <h2>סיכום ${reportType === 'balance' ? 'מאזן' : reportType === 'revenue' ? 'הכנסות' : 'הוצאות'}</h2>

    ${
      reportType === 'balance'
        ? `
    <!-- Balance Report: Three-Part Summary -->
    <!-- Part 1: Revenue Metrics -->
    <div style="margin-bottom: 20px; padding: 15px; background: white; border-radius: 6px; border-right: 4px solid #059669;">
      <div style="font-size: 16px; font-weight: bold; color: #059669; margin-bottom: 15px;">הכנסות</div>
      <div class="summary-grid">
        <div class="metric">
          <div class="label">הונפקו</div>
          <div class="value">${primarySymbolEsc}${(metrics.revenueMetrics?.totalInvoiced || 0).toLocaleString()}</div>
          <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.revenueMetrics?.invoicedCount || 0} מסמכים</div>
        </div>
        <div class="metric highlight">
          <div class="label">התקבלו</div>
          <div class="value">${primarySymbolEsc}${(metrics.revenueMetrics?.totalReceived || 0).toLocaleString()}</div>
          <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.revenueMetrics?.receivedCount || 0} תשלומים</div>
        </div>
        <div class="metric warning">
          <div class="label">ממתינות</div>
          <div class="value">${primarySymbolEsc}${(metrics.revenueMetrics?.totalOutstanding || 0).toLocaleString()}</div>
          <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.revenueMetrics?.outstandingCount || 0} חשבוניות</div>
        </div>
        <div class="metric">
          <div class="label">ממוצע</div>
          <div class="value">${primarySymbolEsc}${Math.round(metrics.revenueMetrics?.avgInvoiced || 0).toLocaleString()}</div>
        </div>
      </div>
    </div>

    <!-- Part 2: Expense Metrics -->
    <div style="margin-bottom: 20px; padding: 15px; background: white; border-radius: 6px; border-right: 4px solid #dc2626;">
      <div style="font-size: 16px; font-weight: bold; color: #dc2626; margin-bottom: 15px;">הוצאות</div>
      <div class="summary-grid">
        <div class="metric">
          <div class="label">סה"כ הוצאות</div>
          <div class="value">${primarySymbolEsc}${(metrics.expenseMetrics?.totalExpenses || 0).toLocaleString()}</div>
          <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.expenseMetrics?.expenseCount || 0} הוצאות</div>
        </div>
        <div class="metric">
          <div class="label">ממוצע להוצאה</div>
          <div class="value">${primarySymbolEsc}${Math.round(metrics.expenseMetrics?.avgExpense || 0).toLocaleString()}</div>
        </div>
      </div>
    </div>

    <!-- Part 3: Net Balance -->
    <div style="margin-bottom: 20px; padding: 15px; background: white; border-radius: 6px; border-right: 4px solid #8b5cf6;">
      <div style="font-size: 16px; font-weight: bold; color: #8b5cf6; margin-bottom: 15px;">מאזן נקי</div>
      <div class="summary-grid">
        <div class="metric">
          <div class="label">רווח נקי</div>
          <div class="value" style="color: ${(metrics.profit || 0) >= 0 ? '#059669' : '#dc2626'};">
            ${primarySymbolEsc}${(metrics.profit || 0).toLocaleString()}
          </div>
        </div>
        <div class="metric">
          <div class="label">שולי רווח</div>
          <div class="value" style="color: ${(metrics.profitMargin || 0) >= 0 ? '#059669' : '#dc2626'};">
            ${(metrics.profitMargin || 0).toFixed(1)}%
          </div>
        </div>
        <div class="metric">
          <div class="label">תזרים מזומנים</div>
          <div class="value">${primarySymbolEsc}${(metrics.netCashFlow || 0).toLocaleString()}</div>
        </div>
        <div class="metric">
          <div class="label">נטו הונפק</div>
          <div class="value">${primarySymbolEsc}${(metrics.netInvoiced || 0).toLocaleString()}</div>
        </div>
      </div>
    </div>
    `
        : metrics.currencies.length > 1
          ? `
    <div style="margin-bottom: 20px; padding: 15px; background: white; border-radius: 6px; border-right: 4px solid #2563eb;">
      <div style="font-size: 14px; font-weight: bold; color: #2563eb; margin-bottom: 10px;">סה"כ לפי מטבע</div>
      ${metrics.currencies
        .map((curr) => {
          const symbol = getCurrencySymbol(curr.currency);
          const currEsc = escapeHtml(curr.currency);
          const symbolEsc = escapeHtml(symbol);
          if (reportType === 'revenue') {
            return `<div style="margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="color: #666; font-size: 12px;">${currEsc} - הונפקו</span>
              <span style="font-weight: bold; font-size: 14px;">${symbolEsc}${curr.totalInvoiced.toLocaleString()}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="color: #059669; font-size: 12px;">${currEsc} - התקבלו</span>
              <span style="font-weight: bold; font-size: 14px; color: #059669;">${symbolEsc}${curr.totalReceived.toLocaleString()}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #d97706; font-size: 12px;">${currEsc} - ממתינות</span>
              <span style="font-weight: bold; font-size: 14px; color: #d97706;">${symbolEsc}${curr.totalOutstanding.toLocaleString()}</span>
            </div>
          </div>`;
          } else {
            // Expenses - just show total
            return `<div style="margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #666; font-size: 12px;">${currEsc} - סה"כ</span>
              <span style="font-weight: bold; font-size: 14px;">${symbolEsc}${curr.totalInvoiced.toLocaleString()}</span>
            </div>
          </div>`;
          }
        })
        .join('')}
    </div>
    `
          : ''
    }

    ${
      reportType !== 'balance'
        ? `
    <div class="summary-grid">
      ${
        reportType === 'revenue'
          ? `
      <div class="metric">
        <div class="label">סה"כ חשבוניות שהונפקו</div>
        <div class="value">${primarySymbolEsc}${metrics.totalInvoiced.toLocaleString()}</div>
        <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.invoicedCount} מסמכים</div>
      </div>
      <div class="metric highlight">
        <div class="label">תקבולים בפועל</div>
        <div class="value">${primarySymbolEsc}${metrics.totalReceived.toLocaleString()}</div>
        <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.receivedCount} תשלומים</div>
      </div>
      <div class="metric warning">
        <div class="label">חשבוניות ממתינות</div>
        <div class="value">${primarySymbolEsc}${metrics.totalOutstanding.toLocaleString()}</div>
        <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.outstandingCount} חשבוניות</div>
      </div>
      <div class="metric">
        <div class="label">ממוצע לחשבונית</div>
        <div class="value">${primarySymbolEsc}${Math.round(metrics.avgInvoiced).toLocaleString()}</div>
      </div>
      `
          : `
      <div class="metric">
        <div class="label">סה"כ הוצאות</div>
        <div class="value">${primarySymbolEsc}${metrics.totalInvoiced.toLocaleString()}</div>
        <div style="font-size: 11px; color: #999; margin-top: 5px;">${metrics.invoicedCount} הוצאות</div>
      </div>
      <div class="metric">
        <div class="label">ממוצע להוצאה</div>
        <div class="value">${primarySymbolEsc}${Math.round(metrics.avgInvoiced).toLocaleString()}</div>
      </div>
      <div class="metric">
        <div class="label">הוצאה מקסימלית</div>
        <div class="value">${primarySymbolEsc}${metrics.maxInvoice.toLocaleString()}</div>
      </div>
      <div class="metric">
        <div class="label">הוצאה מינימלית</div>
        <div class="value">${primarySymbolEsc}${metrics.minInvoice.toLocaleString()}</div>
      </div>
      `
      }
    </div>

    ${
      reportType === 'revenue' && metrics.totalInvoiced > 0
        ? `
    <div class="collection-rate">
      <span class="label">אחוז גביה:</span>
      <span class="value">${((metrics.totalReceived / metrics.totalInvoiced) * 100).toFixed(1)}%</span>
    </div>
    `
        : ''
    }
    `
        : ''
    }
  </div>

  <div class="chart-container" ${reportType === 'balance' ? 'style="page-break-before: always;"' : ''}>
    <h2>מגמת ${reportType === 'balance' ? 'רווח' : reportType === 'revenue' ? 'הכנסות' : 'הוצאות'} לאורך זמן</h2>
    <div class="chart-wrapper">
      <canvas id="revenueChart"></canvas>
    </div>
  </div>

  <script>
    // Wait for Chart.js to load and then render the chart with high DPI
    // @ts-ignore - This code runs in the browser, not Node.js
    window.addEventListener('load', function() {
      const canvas = document.getElementById('revenueChart');
      const ctx = canvas.getContext('2d');

      // Get the display size
      const wrapper = canvas.parentElement;
      const displayWidth = wrapper.clientWidth;
      const displayHeight = 200;

      // Set the size in memory (scaled to account for DPI)
      const scale = 3; // 3x for retina displays
      canvas.width = displayWidth * scale;
      canvas.height = displayHeight * scale;

      // Normalize coordinate system to use CSS pixels
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      ctx.scale(scale, scale);

      const config = ${chartConfig};
      new Chart(ctx, config);
    });
  </script>

  <div class="footer">
    נוצר ב-${new Date().toLocaleDateString('he-IL')} | נוצר על ידי Invofox 🦊
  </div>
</body>
</html>
  `.trim();
}

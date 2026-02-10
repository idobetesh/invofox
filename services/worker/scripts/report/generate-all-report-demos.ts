/**
 * Generate All Report Format Demos
 * Creates demo reports in all formats (PDF, Excel, CSV) for both revenue and expenses
 *
 * Usage: npx ts-node scripts/generate-all-report-demos.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ReportData } from '../../../../shared/report.types';
import * as reportGeneratorService from '../../src/services/report/report-generator.service';
import { processLogoForCircularDisplay } from '../../src/services/business-config/logo-processor.service';
// IMPORTANT: Import the SAME template function that production uses
import { generateReportHTML } from '../../src/services/report/report-template';

// Mock data for revenue report
const revenueReportData: ReportData = {
  businessName: 'דוגמה בע"מ - Demo Business Ltd',
  logoUrl: undefined,
  reportType: 'revenue',
  dateRange: {
    start: '2026-01-01',
    end: '2026-01-31',
    preset: 'this_month',
  },
  generatedAt: new Date().toISOString(),
  metrics: {
    totalInvoiced: 45650,
    totalReceived: 35200, // ~77% collection rate
    totalOutstanding: 10450,
    invoicedCount: 23,
    receivedCount: 18,
    outstandingCount: 5,
    avgInvoiced: 1984.78,
    avgReceived: 1955.56,
    maxInvoice: 5200,
    minInvoice: 350,
    currencies: [
      {
        currency: 'ILS',
        totalInvoiced: 45650,
        totalReceived: 35200,
        totalOutstanding: 10450,
        invoicedCount: 23,
        receivedCount: 18,
        outstandingCount: 5,
        avgInvoiced: 1984.78,
        avgReceived: 1955.56,
        maxInvoice: 5200,
        minInvoice: 350,
      },
    ],
    paymentMethods: {
      מזומן: { count: 11, total: 22000 },
      'העברה בנקאית': { count: 8, total: 18500 },
      'כרטיס אשראי': { count: 3, total: 3950 },
      "צ'ק": { count: 1, total: 1200 },
    },
  },
  invoices: [
    {
      invoiceNumber: '2026-001',
      date: '2026-01-03',
      customerName: 'לקוח א\' בע"מ',
      amount: 5200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'שירותי ייעוץ',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-001.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-002',
      date: '2026-01-05',
      customerName: "לקוח ב' - עסק פרטי",
      amount: 3800,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'פיתוח תוכנה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-002.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-003',
      date: '2026-01-08',
      customerName: "חברה ג' לטכנולוגיה",
      amount: 2400,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'תחזוקה שוטפת',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-003.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-004',
      date: '2026-01-10',
      customerName: "לקוח ד' - פרילנסר",
      amount: 1900,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'עיצוב גרפי',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-004.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-005',
      date: '2026-01-12',
      customerName: "עסק ה' - חנות אינטרנט",
      amount: 4200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'פיתוח אתר',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-005.pdf',
      documentType: 'invoice',
      paymentStatus: 'unpaid',
      isLinkedReceipt: false,
      remainingBalance: 4200,
    },
    {
      invoiceNumber: '2026-006',
      date: '2026-01-15',
      customerName: "לקוח ו' - סטארטאפ",
      amount: 3200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'ייעוץ טכני',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-006.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-007',
      date: '2026-01-17',
      customerName: "חברה ז' למסחר",
      amount: 1550,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'אינטגרציה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-007.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-008',
      date: '2026-01-19',
      customerName: "לקוח ח' - משרד עורכי דין",
      amount: 2800,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'ניהול מערכות',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-008.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-009',
      date: '2026-01-22',
      customerName: "עסק ט' - מסעדה",
      amount: 1200,
      currency: 'ILS',
      paymentMethod: "צ'ק",
      category: 'מערכת הזמנות',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-009.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-010',
      date: '2026-01-24',
      customerName: 'לקוח י\' בע"מ',
      amount: 3500,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'אפליקציה ניידת',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-010.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-011',
      date: '2026-01-26',
      customerName: "חברה יא' - קמעונאות",
      amount: 2100,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'בדיקות איכות',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-011.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-012',
      date: '2026-01-28',
      customerName: "לקוח יב' - תעשייה",
      amount: 4800,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'אוטומציה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-012.pdf',
      documentType: 'invoice',
      paymentStatus: 'partial',
      isLinkedReceipt: false,
      paidAmount: 3250,
      remainingBalance: 1550,
    },
    {
      invoiceNumber: '2026-013',
      date: '2026-01-29',
      customerName: "עסק יג' - בריאות",
      amount: 2600,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'מערכת ניהול',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-013.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-014',
      date: '2026-01-30',
      customerName: "לקוח יד' - חינוך",
      amount: 1800,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'פלטפורמת למידה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-014.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-015',
      date: '2026-01-31',
      customerName: "חברה טו' - לוגיסטיקה",
      amount: 3800,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'מעקב משלוחים',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-015.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-016',
      date: '2026-01-07',
      customerName: "לקוח טז' - תיירות",
      amount: 1450,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'אתר הזמנות',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-016.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-017',
      date: '2026-01-09',
      customerName: "עסק יז' - אופנה",
      amount: 2200,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'חנות מקוונת',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-017.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-018',
      date: '2026-01-13',
      customerName: 'לקוח יח\' - נדל"ן',
      amount: 3600,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'מערכת CRM',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-018.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-019',
      date: '2026-01-16',
      customerName: "חברה יט' - פיננסים",
      amount: 4500,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'דוחות פיננסיים',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-019.pdf',
      documentType: 'invoice',
      paymentStatus: 'partial',
      isLinkedReceipt: false,
      paidAmount: 3100,
      remainingBalance: 1400,
    },
    {
      invoiceNumber: '2026-020',
      date: '2026-01-20',
      customerName: "לקוח כ' - תקשורת",
      amount: 2900,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'ניהול מדיה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-020.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-021',
      date: '2026-01-23',
      customerName: "עסק כא' - ספורט",
      amount: 1750,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'אפליקציית כושר',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-021.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: '2026-022',
      date: '2026-01-27',
      customerName: "לקוח כב' - אנרגיה",
      amount: 3300,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'ניטור מערכות',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-022.pdf',
      documentType: 'invoice',
      paymentStatus: 'unpaid',
      isLinkedReceipt: false,
      remainingBalance: 3300,
    },
    {
      invoiceNumber: '2026-023',
      date: '2026-01-31',
      customerName: "חברה כג' - רכב",
      amount: 350,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'תיקון באג',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/2026-023.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
  ],
};

// Mock data for expenses report (with mixed currencies)
const expensesReportData: ReportData = {
  businessName: 'דוגמה בע"מ - Demo Business Ltd',
  logoUrl: undefined,
  reportType: 'expenses',
  dateRange: {
    start: '2026-01-01',
    end: '2026-01-31',
    preset: 'this_month',
  },
  generatedAt: new Date().toISOString(),
  metrics: {
    totalInvoiced: 26600,
    totalReceived: 26600, // All paid for demo
    totalOutstanding: 0,
    invoicedCount: 15,
    receivedCount: 15,
    outstandingCount: 0,
    avgInvoiced: 1773.33,
    avgReceived: 1773.33,
    maxInvoice: 4500,
    minInvoice: 250,
    currencies: [
      {
        currency: 'ILS',
        totalInvoiced: 22950,
        totalReceived: 22950,
        totalOutstanding: 0,
        invoicedCount: 12,
        receivedCount: 12,
        outstandingCount: 0,
        avgInvoiced: 1912.5,
        avgReceived: 1912.5,
        maxInvoice: 4500,
        minInvoice: 250,
      },
      {
        currency: 'USD',
        totalInvoiced: 2800,
        totalReceived: 2800,
        totalOutstanding: 0,
        invoicedCount: 2,
        receivedCount: 2,
        outstandingCount: 0,
        avgInvoiced: 1400,
        avgReceived: 1400,
        maxInvoice: 1800,
        minInvoice: 1000,
      },
      {
        currency: 'EUR',
        totalInvoiced: 850,
        totalReceived: 850,
        totalOutstanding: 0,
        invoicedCount: 1,
        receivedCount: 1,
        outstandingCount: 0,
        avgInvoiced: 850,
        avgReceived: 850,
        maxInvoice: 850,
        minInvoice: 850,
      },
    ],
    paymentMethods: {
      'כרטיס אשראי': { count: 8, total: 16500 },
      'העברה בנקאית': { count: 5, total: 10200 },
      מזומן: { count: 2, total: 1650 },
    },
  },
  invoices: [
    {
      invoiceNumber: 'EXP-001',
      date: '2026-01-02',
      customerName: 'Google Cloud Platform',
      amount: 4500,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'שירותי ענן',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-001.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-002',
      date: '2026-01-05',
      customerName: 'משרד רואה חשבון',
      amount: 3200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'שירותים מקצועיים',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-002.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-003',
      date: '2026-01-07',
      customerName: 'Office Depot',
      amount: 850,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'ציוד משרדי',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-003.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-004',
      date: '2026-01-10',
      customerName: 'חברת חשמל',
      amount: 650,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'חשבונות',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-004.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-005',
      date: '2026-01-12',
      customerName: 'GitHub Enterprise',
      amount: 1800,
      currency: 'USD',
      paymentMethod: 'כרטיס אשראי',
      category: 'תוכנה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-005.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-006',
      date: '2026-01-15',
      customerName: 'משרד עורך דין',
      amount: 4200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'שירותים משפטיים',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-006.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-007',
      date: '2026-01-17',
      customerName: 'LinkedIn Premium',
      amount: 350,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'שיווק',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-007.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-008',
      date: '2026-01-19',
      customerName: 'בזק בינלאומי',
      amount: 450,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'תקשורת',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-008.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-009',
      date: '2026-01-21',
      customerName: 'Adobe Creative Cloud',
      amount: 1000,
      currency: 'USD',
      paymentMethod: 'כרטיס אשראי',
      category: 'תוכנה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-009.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-010',
      date: '2026-01-23',
      customerName: 'משלוח ארוחות',
      amount: 950,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'אירוח',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-010.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-011',
      date: '2026-01-25',
      customerName: 'AWS',
      amount: 850,
      currency: 'EUR',
      paymentMethod: 'כרטיס אשראי',
      category: 'שירותי ענן',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-011.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-012',
      date: '2026-01-27',
      customerName: 'חניון חודשי',
      amount: 700,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'תחבורה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-012.pdf',
      documentType: 'receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-013',
      date: '2026-01-28',
      customerName: 'Zoom Pro',
      amount: 550,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'תוכנה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-013.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-014',
      date: '2026-01-30',
      customerName: 'ביטוח לאומי',
      amount: 3600,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'ביטוח',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-014.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
    {
      invoiceNumber: 'EXP-015',
      date: '2026-01-31',
      customerName: 'ניקיון משרדים',
      amount: 250,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'תחזוקה',
      driveLink: 'https://storage.googleapis.com/demo-bucket-invoices/EXP-015.pdf',
      documentType: 'invoice_receipt',
      paymentStatus: 'paid',
      isLinkedReceipt: false,
    },
  ],
};

/**
 * Generate date range for preset
 */
function getDateRangeForPreset(preset: 'this_month' | 'last_month' | 'ytd'): {
  start: string;
  end: string;
  preset: 'this_month' | 'last_month' | 'ytd';
} {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  switch (preset) {
    case 'this_month': {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'this_month' as const,
      };
    }
    case 'last_month': {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'last_month' as const,
      };
    }
    case 'ytd': {
      const start = new Date(year, 0, 1);
      const end = new Date(year, month, now.getDate());
      return {
        start: formatDate(start),
        end: formatDate(end),
        preset: 'ytd' as const,
      };
    }
  }
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Adjust invoice dates to match date range
 */
function adjustInvoiceDates(
  invoices: typeof revenueReportData.invoices,
  dateRange: { start: string; end: string }
): typeof revenueReportData.invoices {
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);
  const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  return invoices.map((inv, index) => {
    // Distribute invoices evenly across the date range
    const dayOffset = Math.floor((index / invoices.length) * rangeDays);
    const invoiceDate = new Date(start);
    invoiceDate.setDate(invoiceDate.getDate() + dayOffset);

    return {
      ...inv,
      date: formatDate(invoiceDate),
    };
  });
}

async function generateAllDemos() {
  console.log('🚀 Generating all report format demos...\n');
  console.log('✅ Using PRODUCTION template from: src/services/report/report-template.ts');
  console.log('   (Same template used by report.controller.ts in production)\n');

  const baseOutputDir = path.join(__dirname, 'output');

  // VERIFICATION: Test that we can access the production template directly
  const testHTML = generateReportHTML(revenueReportData);
  if (!testHTML || !testHTML.includes('<!DOCTYPE html>')) {
    throw new Error('❌ Template verification failed! Not using correct template.');
  }

  // Verify template has circular logo features we added
  const hasCircularLogo = testHTML.includes('border-radius: 50%');
  const hasPlaceholder = testHTML.includes('logo-placeholder');
  const hasDocumentEmoji = testHTML.includes('📄');

  if (!hasCircularLogo || !hasPlaceholder || !hasDocumentEmoji) {
    throw new Error('❌ Template missing circular logo features! Using outdated template.');
  }

  console.log('✅ Template verification passed:');
  console.log('   - Using production template from src/services/report/report-template.ts');
  console.log('   - Circular logo styling: ✓');
  console.log('   - Placeholder support: ✓');
  console.log('   - Document emoji (📄): ✓\n');

  // Load and process logo from docs/assets
  let logoBase64: string | null = null;
  const assetsDir = path.join(__dirname, '../../../../docs/assets');
  const logoFiles = ['logo.png', 'invoice-logo.jpeg'].filter((file) => {
    const filePath = path.join(assetsDir, file);
    return fs.existsSync(filePath);
  });

  if (logoFiles.length > 0) {
    const logoFile = logoFiles[0];
    const logoPath = path.join(assetsDir, logoFile);
    console.log(`🖼️  Loading logo: ${logoFile}`);

    try {
      const logoBuffer = fs.readFileSync(logoPath);
      console.log('   Processing logo to circular format...');
      const processedLogo = await processLogoForCircularDisplay(logoBuffer);
      logoBase64 = `data:image/png;base64,${processedLogo.toString('base64')}`;
      console.log('   ✓ Logo processed and converted to base64\n');
    } catch (error) {
      console.warn(`   ⚠️  Failed to load/process logo: ${error}`);
      console.log('   Using placeholder logo instead\n');
    }
  } else {
    console.log('🖼️  No logo found in docs/assets, using placeholder\n');
  }

  try {
    const reportTypes: Array<{
      type: 'revenue' | 'expenses';
      emoji: string;
      baseData: ReportData;
    }> = [
      {
        type: 'revenue',
        emoji: '📊',
        baseData: { ...revenueReportData, logoUrl: logoBase64 || undefined },
      },
      {
        type: 'expenses',
        emoji: '💸',
        baseData: { ...expensesReportData, logoUrl: logoBase64 || undefined },
      },
    ];

    const datePresets: Array<'this_month' | 'last_month' | 'ytd'> = [
      'this_month',
      'last_month',
      'ytd',
    ];

    let totalGenerated = 0;

    // Generate all combinations
    for (const { type, emoji, baseData } of reportTypes) {
      console.log(`\n${emoji} Generating ${type.toUpperCase()} Reports...\n`);

      for (const preset of datePresets) {
        const dateRange = getDateRangeForPreset(preset);
        const presetLabel = preset.replace('_', ' ').toUpperCase();
        console.log(`  📅 ${presetLabel} (${dateRange.start} to ${dateRange.end})`);

        // Create subfolder: output/revenue/this_month/
        const outputDir = path.join(baseOutputDir, type, preset);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Adjust invoice dates to match the preset
        const adjustedInvoices = adjustInvoiceDates(baseData.invoices, dateRange);

        // Create report data for this preset
        const reportData: ReportData = {
          ...baseData,
          dateRange,
          invoices: adjustedInvoices,
          generatedAt: new Date().toISOString(),
        };

        // Generate PDF
        console.log('     📄 PDF...');
        const pdf = await reportGeneratorService.generatePDFReport(reportData);
        const pdfPath = path.join(outputDir, `${type}-${preset}.pdf`);
        fs.writeFileSync(pdfPath, pdf);
        console.log(`        ✅ ${type}-${preset}.pdf (${(pdf.length / 1024).toFixed(2)} KB)`);
        totalGenerated++;

        // Generate Excel
        console.log('     📊 Excel...');
        const excel = await reportGeneratorService.generateExcelReport(reportData);
        const excelPath = path.join(outputDir, `${type}-${preset}.xlsx`);
        fs.writeFileSync(excelPath, excel);
        console.log(`        ✅ ${type}-${preset}.xlsx (${(excel.length / 1024).toFixed(2)} KB)`);
        totalGenerated++;

        // Generate CSV
        console.log('     📝 CSV...');
        const csv = await reportGeneratorService.generateCSVReport(reportData);
        const csvPath = path.join(outputDir, `${type}-${preset}.csv`);
        fs.writeFileSync(csvPath, csv);
        console.log(`        ✅ ${type}-${preset}.csv (${(csv.length / 1024).toFixed(2)} KB)`);
        totalGenerated++;

        console.log('');
      }
    }

    // Summary
    console.log('\n✅ All demo reports generated successfully!\n');
    console.log(`📁 Output directory: ${baseOutputDir}`);
    console.log(`📊 Total files generated: ${totalGenerated}\n`);
    console.log('📂 Folder structure:');
    console.log('   output/');
    console.log('   ├── revenue/');
    console.log('   │   ├── this_month/');
    console.log('   │   │   ├── revenue-this_month.pdf');
    console.log('   │   │   ├── revenue-this_month.xlsx');
    console.log('   │   │   └── revenue-this_month.csv');
    console.log('   │   ├── last_month/');
    console.log('   │   │   └── ...');
    console.log('   │   ├── ytd/');
    console.log('   │   │   └── ...');
    console.log('   └── expenses/');
    console.log('       ├── this_month/');
    console.log('       │   └── ...');
    console.log('       ├── last_month/');
    console.log('       │   └── ...');
    console.log('       └── ytd/');
    console.log('           └── ...');
    console.log('\n💡 Open the PDF files to view the reports!');
  } catch (error) {
    console.error('\n❌ Error generating demo reports:');
    console.error(error);
    process.exit(1);
  }
}

// Run the demo
generateAllDemos();

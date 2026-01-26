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
    totalRevenue: 45650,
    invoiceCount: 23,
    avgInvoice: 1984.78,
    maxInvoice: 5200,
    minInvoice: 350,
    currencies: [
      {
        currency: 'ILS',
        totalRevenue: 45650,
        invoiceCount: 23,
        avgInvoice: 1984.78,
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
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-002',
      date: '2026-01-05',
      customerName: "לקוח ב' - עסק פרטי",
      amount: 3800,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'פיתוח תוכנה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-003',
      date: '2026-01-08',
      customerName: "חברה ג' לטכנולוגיה",
      amount: 2400,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'תחזוקה שוטפת',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-004',
      date: '2026-01-10',
      customerName: "לקוח ד' - פרילנסר",
      amount: 1900,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'עיצוב גרפי',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-005',
      date: '2026-01-12',
      customerName: "עסק ה' - חנות אינטרנט",
      amount: 4200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'פיתוח אתר',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-006',
      date: '2026-01-15',
      customerName: "לקוח ו' - סטארטאפ",
      amount: 3200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'ייעוץ טכני',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-007',
      date: '2026-01-17',
      customerName: "חברה ז' למסחר",
      amount: 1550,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'אינטגרציה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-008',
      date: '2026-01-19',
      customerName: "לקוח ח' - משרד עורכי דין",
      amount: 2800,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'ניהול מערכות',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-009',
      date: '2026-01-22',
      customerName: "עסק ט' - מסעדה",
      amount: 1200,
      currency: 'ILS',
      paymentMethod: "צ'ק",
      category: 'מערכת הזמנות',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-010',
      date: '2026-01-24',
      customerName: 'לקוח י\' בע"מ',
      amount: 3500,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'אפליקציה ניידת',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-011',
      date: '2026-01-26',
      customerName: "חברה יא' - קמעונאות",
      amount: 2100,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'בדיקות איכות',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-012',
      date: '2026-01-28',
      customerName: "לקוח יב' - תעשייה",
      amount: 4800,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'אוטומציה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-013',
      date: '2026-01-29',
      customerName: "עסק יג' - בריאות",
      amount: 2600,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'מערכת ניהול',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-014',
      date: '2026-01-30',
      customerName: "לקוח יד' - חינוך",
      amount: 1800,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'פלטפורמת למידה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-015',
      date: '2026-01-31',
      customerName: "חברה טו' - לוגיסטיקה",
      amount: 3800,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'מעקב משלוחים',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-016',
      date: '2026-01-07',
      customerName: "לקוח טז' - תיירות",
      amount: 1450,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'אתר הזמנות',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-017',
      date: '2026-01-09',
      customerName: "עסק יז' - אופנה",
      amount: 2200,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'חנות מקוונת',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-018',
      date: '2026-01-13',
      customerName: 'לקוח יח\' - נדל"ן',
      amount: 3600,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'מערכת CRM',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-019',
      date: '2026-01-16',
      customerName: "חברה יט' - פיננסים",
      amount: 4500,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'דוחות פיננסיים',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-020',
      date: '2026-01-20',
      customerName: "לקוח כ' - תקשורת",
      amount: 2900,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'ניהול מדיה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-021',
      date: '2026-01-23',
      customerName: "עסק כא' - ספורט",
      amount: 1750,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'אפליקציית כושר',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-022',
      date: '2026-01-27',
      customerName: "לקוח כב' - אנרגיה",
      amount: 3300,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'ניטור מערכות',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: '2026-023',
      date: '2026-01-31',
      customerName: "חברה כג' - רכב",
      amount: 350,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'תיקון באג',
      driveLink: 'https://drive.google.com/file/d/xxx',
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
    totalRevenue: 22950,
    invoiceCount: 12,
    avgInvoice: 1912.5,
    maxInvoice: 4500,
    minInvoice: 250,
    currencies: [
      {
        currency: 'ILS',
        totalRevenue: 22950,
        invoiceCount: 12,
        avgInvoice: 1912.5,
        maxInvoice: 4500,
        minInvoice: 250,
      },
      {
        currency: 'USD',
        totalRevenue: 2800,
        invoiceCount: 2,
        avgInvoice: 1400,
        maxInvoice: 1800,
        minInvoice: 1000,
      },
      {
        currency: 'EUR',
        totalRevenue: 850,
        invoiceCount: 1,
        avgInvoice: 850,
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
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-002',
      date: '2026-01-05',
      customerName: 'משרד רואה חשבון',
      amount: 3200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'שירותים מקצועיים',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-003',
      date: '2026-01-07',
      customerName: 'Office Depot',
      amount: 850,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'ציוד משרדי',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-004',
      date: '2026-01-10',
      customerName: 'חברת חשמל',
      amount: 650,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'חשבונות',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-005',
      date: '2026-01-12',
      customerName: 'GitHub Enterprise',
      amount: 1800,
      currency: 'USD',
      paymentMethod: 'כרטיס אשראי',
      category: 'תוכנה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-006',
      date: '2026-01-15',
      customerName: 'משרד עורך דין',
      amount: 4200,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'שירותים משפטיים',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-007',
      date: '2026-01-17',
      customerName: 'LinkedIn Premium',
      amount: 350,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'שיווק',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-008',
      date: '2026-01-19',
      customerName: 'בזק בינלאומי',
      amount: 450,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'תקשורת',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-009',
      date: '2026-01-21',
      customerName: 'Adobe Creative Cloud',
      amount: 1000,
      currency: 'USD',
      paymentMethod: 'כרטיס אשראי',
      category: 'תוכנה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-010',
      date: '2026-01-23',
      customerName: 'משלוח ארוחות',
      amount: 950,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'אירוח',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-011',
      date: '2026-01-25',
      customerName: 'AWS',
      amount: 850,
      currency: 'EUR',
      paymentMethod: 'כרטיס אשראי',
      category: 'שירותי ענן',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-012',
      date: '2026-01-27',
      customerName: 'חניון חודשי',
      amount: 700,
      currency: 'ILS',
      paymentMethod: 'מזומן',
      category: 'תחבורה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-013',
      date: '2026-01-28',
      customerName: 'Zoom Pro',
      amount: 550,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'תוכנה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-014',
      date: '2026-01-30',
      customerName: 'ביטוח לאומי',
      amount: 3600,
      currency: 'ILS',
      paymentMethod: 'העברה בנקאית',
      category: 'ביטוח',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
    {
      invoiceNumber: 'EXP-015',
      date: '2026-01-31',
      customerName: 'ניקיון משרדים',
      amount: 250,
      currency: 'ILS',
      paymentMethod: 'כרטיס אשראי',
      category: 'תחזוקה',
      driveLink: 'https://drive.google.com/file/d/xxx',
    },
  ],
};

async function generateAllDemos() {
  console.log('🚀 Generating all report format demos...\n');
  console.log('✅ Using PRODUCTION template from: src/services/report/report-template.ts');
  console.log('   (Same template used by report.controller.ts in production)\n');

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

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
  // __dirname is services/worker/scripts/report, so go up 3 levels to root, then docs/assets
  const assetsDir = path.join(__dirname, '../../../../docs/assets');
  const logoFiles = ['logo.png', 'invoice-logo.jpeg'].filter((file) => {
    const filePath = path.join(assetsDir, file);
    return fs.existsSync(filePath);
  });

  if (logoFiles.length > 0) {
    const logoFile = logoFiles[0]; // Use first available logo
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

  // Update report data with processed logo
  if (logoBase64) {
    revenueReportData.logoUrl = logoBase64;
    expensesReportData.logoUrl = logoBase64;
  }

  try {
    // Generate Revenue Reports
    console.log('📊 Generating Revenue Reports...');

    console.log('  📄 Creating Revenue PDF...');
    const revenuePdf = await reportGeneratorService.generatePDFReport(revenueReportData);
    fs.writeFileSync(path.join(outputDir, 'demo-revenue-report.pdf'), revenuePdf);
    console.log(
      `     ✅ Saved: demo-revenue-report.pdf (${(revenuePdf.length / 1024).toFixed(2)} KB)`
    );

    console.log('  📊 Creating Revenue Excel...');
    const revenueExcel = await reportGeneratorService.generateExcelReport(revenueReportData);
    fs.writeFileSync(path.join(outputDir, 'demo-revenue-report.xlsx'), revenueExcel);
    console.log(
      `     ✅ Saved: demo-revenue-report.xlsx (${(revenueExcel.length / 1024).toFixed(2)} KB)`
    );

    console.log('  📝 Creating Revenue CSV...');
    const revenueCsv = await reportGeneratorService.generateCSVReport(revenueReportData);
    fs.writeFileSync(path.join(outputDir, 'demo-revenue-report.csv'), revenueCsv);
    console.log(
      `     ✅ Saved: demo-revenue-report.csv (${(revenueCsv.length / 1024).toFixed(2)} KB)`
    );

    // Generate Expenses Reports
    console.log('\n💸 Generating Expenses Reports...');

    console.log('  📄 Creating Expenses PDF...');
    const expensesPdf = await reportGeneratorService.generatePDFReport(expensesReportData);
    fs.writeFileSync(path.join(outputDir, 'demo-expenses-report.pdf'), expensesPdf);
    console.log(
      `     ✅ Saved: demo-expenses-report.pdf (${(expensesPdf.length / 1024).toFixed(2)} KB)`
    );

    console.log('  📊 Creating Expenses Excel...');
    const expensesExcel = await reportGeneratorService.generateExcelReport(expensesReportData);
    fs.writeFileSync(path.join(outputDir, 'demo-expenses-report.xlsx'), expensesExcel);
    console.log(
      `     ✅ Saved: demo-expenses-report.xlsx (${(expensesExcel.length / 1024).toFixed(2)} KB)`
    );

    console.log('  📝 Creating Expenses CSV...');
    const expensesCsv = await reportGeneratorService.generateCSVReport(expensesReportData);
    fs.writeFileSync(path.join(outputDir, 'demo-expenses-report.csv'), expensesCsv);
    console.log(
      `     ✅ Saved: demo-expenses-report.csv (${(expensesCsv.length / 1024).toFixed(2)} KB)`
    );

    // Summary
    console.log('\n✅ All demo reports generated successfully!\n');
    console.log('📁 Output directory:', outputDir);
    console.log('\n📊 Generated files:');
    console.log('   Revenue:');
    console.log('   - demo-revenue-report.pdf   (PDF with charts and formatting)');
    console.log('   - demo-revenue-report.xlsx  (Excel with multiple sheets)');
    console.log('   - demo-revenue-report.csv   (CSV with UTF-8 BOM)');
    console.log('   Expenses:');
    console.log('   - demo-expenses-report.pdf  (PDF with charts and formatting)');
    console.log('   - demo-expenses-report.xlsx (Excel with multiple sheets)');
    console.log('   - demo-expenses-report.csv  (CSV with UTF-8 BOM)');
    console.log('\n💡 Open the PDF files to view the reports!');
  } catch (error) {
    console.error('\n❌ Error generating demo reports:');
    console.error(error);
    process.exit(1);
  }
}

// Run the demo
generateAllDemos();

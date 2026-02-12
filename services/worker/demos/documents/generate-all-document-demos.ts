/**
 * Generate All Document Type Demos
 * Creates demo documents for all three types: invoice, receipt, invoice_receipt
 * Uses the SAME production code from document-generator service
 *
 * Usage: npx tsx demos/documents/generate-all-document-demos.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { buildInvoiceHTML } from '../../src/services/document-generator/template';
import { processLogoForCircularDisplay } from '../../src/services/business-config/logo-processor.service';
import type {
  InvoiceData,
  BusinessConfig,
  InvoiceSession,
  GeneratedInvoice,
} from '../../../../shared/types';

// Demo business config (generic for GitHub)
const sampleBusinessConfig: BusinessConfig = {
  business: {
    name: 'העסק שלי - Demo Business',
    taxId: '512345678',
    taxStatus: 'עוסק פטור מס',
    email: 'demo@example.com',
    phone: '03-1234567',
    address: 'רחוב הדוגמה 42, תל אביב',
  },
  invoice: {
    digitalSignatureText: 'מסמך ממוחשב חתום דיגיטלית',
    generatedByText: 'הופק ע"י Invofox',
  },
};

// Mock parent invoice for receipt demo
const mockParentInvoice: GeneratedInvoice = {
  chatId: 123456,
  invoiceNumber: 'I-2026-99',
  documentType: 'invoice',
  customerName: 'שרה כהן',
  customerTaxId: '987654321',
  description: 'תשלום עבור שירותי עיצוב',
  amount: 3500,
  currency: 'ILS',
  paymentMethod: undefined, // Not yet paid
  date: '15/01/2026',
  generatedAt: new Date('2026-01-15'),
  generatedBy: {
    telegramUserId: 999999,
    username: 'demo_user',
    chatId: 123456,
  },
  pdfLink: 'https://example.com/invoice-20260099.pdf',
  sheetRow: 10,
  paymentStatus: 'unpaid',
  remainingBalance: 3500,
};

// Mock session for receipt demo
const mockReceiptSession: InvoiceSession = {
  status: 'confirming',
  documentType: 'receipt',
  relatedInvoiceNumber: 'I-2026-99',
  customerName: 'שרה כהן',
  customerTaxId: '987654321',
  description: 'תשלום עבור שירותי עיצוב',
  amount: 3500,
  currency: 'ILS',
  paymentMethod: 'כרטיס אשראי',
  date: '2026-01-20',
  createdAt: new Date('2026-01-20'),
  updatedAt: new Date('2026-01-20'),
};

// Mock data for each document type
const documentSamples: Array<{
  type: 'invoice' | 'receipt' | 'invoice_receipt';
  emoji: string;
  hebrewName: string;
  data: InvoiceData;
  session?: InvoiceSession;
  parentInvoice?: GeneratedInvoice;
}> = [
  {
    type: 'invoice',
    emoji: '📄',
    hebrewName: 'חשבונית',
    data: {
      invoiceNumber: 'I-2026-1',
      documentType: 'invoice',
      customerName: 'ישראל ישראלי',
      customerTaxId: '123456789',
      description: 'שירותי ייעוץ טכנולוגי - ינואר 2026',
      amount: 5000,
      paymentMethod: 'העברה בנקאית',
      date: '2026-01-15',
    },
  },
  {
    type: 'receipt',
    emoji: '🧾',
    hebrewName: 'קבלה',
    data: {
      invoiceNumber: 'R-2026-1',
      documentType: 'receipt',
      customerName: 'שרה כהן',
      customerTaxId: '987654321',
      description: 'תשלום עבור שירותי עיצוף',
      amount: 3500,
      paymentMethod: 'כרטיס אשראי',
      date: '2026-01-20',
    },
    session: mockReceiptSession,
    parentInvoice: mockParentInvoice,
  },
  {
    type: 'invoice_receipt',
    emoji: '📋',
    hebrewName: 'חשבונית מס / קבלה',
    data: {
      invoiceNumber: 'IR-2026-1',
      documentType: 'invoice_receipt',
      customerName: 'דוד לוי',
      customerTaxId: '555666777',
      description: 'פיתוח אתר אינטרנט - פברואר 2026',
      amount: 8500,
      paymentMethod: 'העברה בנקאית',
      date: '2026-02-10',
    },
  },
];

async function generateAllDocuments(): Promise<void> {
  console.log('🚀 Generating all document type demos...\n');
  console.log('✅ Using PRODUCTION template from: src/services/document-generator/template\n');

  const baseOutputDir = path.join(__dirname, 'output');

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

  // Launch browser once for all documents
  console.log('🌐 Launching Playwright browser...');
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    console.log('   ✓ Browser launched\n');
  } catch (error: any) {
    if (
      error.message?.includes("Executable doesn't exist") ||
      error.message?.includes('Executable')
    ) {
      console.error('❌ Playwright browser not installed!');
      console.log('\n📦 Installing Playwright browsers...');
      try {
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        console.log('✅ Playwright browsers installed successfully!\n');
        browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        });
      } catch (installError) {
        console.error('\n❌ Failed to install Playwright browsers');
        console.error('Please run manually: npx playwright install chromium');
        throw installError;
      }
    } else {
      throw error;
    }
  }

  try {
    let totalGenerated = 0;

    for (const sample of documentSamples) {
      console.log(
        `${sample.emoji} Generating ${sample.hebrewName.toUpperCase()} (${sample.type})...`
      );

      // Create output directory for this document type
      const typeOutputDir = path.join(baseOutputDir, sample.type);
      if (!fs.existsSync(typeOutputDir)) {
        fs.mkdirSync(typeOutputDir, { recursive: true });
      }

      // Build HTML using production template
      const html = buildInvoiceHTML(
        sample.data,
        sampleBusinessConfig,
        logoBase64,
        sample.session,
        sample.parentInvoice
      );

      // Generate PDF
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });

      await page.close();

      // Save PDF
      const filename = `${sample.type}-${sample.data.invoiceNumber}.pdf`;
      const pdfPath = path.join(typeOutputDir, filename);
      fs.writeFileSync(pdfPath, pdfBuffer);

      const sizeKb = (pdfBuffer.length / 1024).toFixed(2);
      console.log(`   ✅ ${filename} (${sizeKb} KB)`);
      console.log(`      Customer: ${sample.data.customerName}`);
      console.log(`      Amount: ₪${sample.data.amount.toLocaleString()}`);
      console.log(`      Payment: ${sample.data.paymentMethod}\n`);

      totalGenerated++;
    }

    // Summary
    console.log('\n✅ All document demos generated successfully!\n');
    console.log(`📁 Output directory: ${baseOutputDir}`);
    console.log(`📊 Total documents generated: ${totalGenerated}\n`);
    console.log('📂 Folder structure:\n');

    // Use tree command to show actual directory structure
    try {
      const treeOutput = execSync(`tree ${baseOutputDir} -L 2`, { encoding: 'utf-8' });
      console.log(treeOutput);
    } catch (error) {
      // Fallback if tree command is not available
      console.log('   (tree command not available - use `ls -R` to view structure)');
      console.log(`   Run: tree ${baseOutputDir} -L 2\n`);
    }

    console.log('💡 Open the PDF files to view the documents!');
    console.log('\n📄 Document types generated:');
    console.log('   • invoice         - חשבונית (bill for future payment)');
    console.log('   • receipt         - קבלה (payment received)');
    console.log('   • invoice_receipt - חשבונית מס/קבלה (invoice + receipt combined)');
  } finally {
    await browser.close();
  }
}

// Run
generateAllDocuments()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

/**
 * Standalone script to generate a sample invoice PDF with processed logo
 * Run with: npx ts-node scripts/invoice/generate-sample-invoice.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { buildInvoiceHTML } from '../../src/services/invoice-generator/template';
import { processLogoForCircularDisplay } from '../../src/services/business-config/logo-processor.service';
import type { InvoiceData, BusinessConfig } from '../../../../shared/types';

// Demo business config (generic for GitHub)
const sampleBusinessConfig: BusinessConfig = {
  business: {
    name: 'העסק שלי',
    taxId: '512345678',
    taxStatus: 'עוסק מורשה',
    email: 'demo@example.com',
    phone: '03-1234567',
    address: 'רחוב הדוגמה 42, תל אביב',
  },
  invoice: {
    digitalSignatureText: 'מסמך ממוחשב חתום דיגיטלית',
    generatedByText: 'הופק ע"י Invofox',
  },
};

// Demo invoice data (generic for GitHub)
const sampleInvoiceData: InvoiceData = {
  invoiceNumber: '20260001',
  documentType: 'invoice_receipt',
  customerName: 'ישראל ישראלי',
  customerTaxId: '123456789',
  description: 'שירותי ייעוץ - ינואר 2026',
  amount: 1500,
  paymentMethod: 'העברה',
  date: '2026-01-15',
};

async function generateSampleInvoice(): Promise<void> {
  console.log('🔧 Generating sample invoice...\n');

  // Load and process logo from docs/assets
  let logoBase64: string | null = null;
  // __dirname is services/worker/scripts/invoice, so go up 3 levels to root, then docs/assets
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
      console.log('   ✓ Logo processed and converted to base64');
    } catch (error) {
      console.warn(`   ⚠️  Failed to load/process logo: ${error}`);
      console.log('   Using placeholder logo instead');
    }
  } else {
    console.log('🖼️  No logo found in docs/assets, using placeholder');
  }

  // Build HTML (used internally by Playwright to generate PDF)
  const html = buildInvoiceHTML(sampleInvoiceData, sampleBusinessConfig, logoBase64);

  // Prepare output folder
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('🌐 Generating PDF using Playwright...');

  // Launch browser using Playwright
  // If browser is not installed, it will show a helpful error message
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (error: any) {
    if (
      error.message?.includes("Executable doesn't exist") ||
      error.message?.includes('Executable')
    ) {
      console.error('❌ Playwright browser not installed!');
      console.log('\n📦 To install Playwright browsers, run:');
      console.log('   npx playwright install chromium\n');
      console.log('Or the script will attempt to install it automatically...\n');

      // Try to install automatically
      const { execSync } = require('child_process');
      try {
        console.log('📦 Installing Playwright browsers...');
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        console.log('✅ Playwright browsers installed successfully!\n');

        // Try launching again after installation
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      } catch (installError) {
        console.error('\n❌ Failed to install Playwright browsers automatically');
        console.error('Please run manually: npx playwright install chromium');
        throw installError;
      }
    } else {
      throw error;
    }
  }

  try {
    const page = await browser.newPage();

    // Set content
    await page.setContent(html, { waitUntil: 'networkidle' });

    // Generate PDF
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

    // Save PDF (output folder) - PRIMARY OUTPUT
    const pdfPath = path.join(outputDir, 'sample-invoice.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);

    console.log(`\n✅ PDF generated successfully!`);
    console.log(`📁 Location: ${pdfPath}`);
    console.log(`📊 Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
  } finally {
    await browser.close();
  }
}

// Run
generateSampleInvoice()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

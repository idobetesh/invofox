/**
 * Invofox Admin Tool
 *
 * ⚠️ SECURITY WARNING ⚠️
 * - This is a powerful admin tool with DELETE capabilities
 * - Only run locally (localhost) - NEVER deploy to production
 * - Requires GCP admin credentials
 * - Can permanently delete Firestore documents and Storage objects
 * - Use with extreme caution!
 *
 * Usage:
 *   cd tools/admin
 *   npm install
 *   npm start
 *
 * Then open http://localhost:3000 in your browser
 */

import express from 'express';
import * as path from 'path';
import * as dotenv from 'dotenv';

import { getFirestoreClient, getStorageClient } from './src/services/gcp-clients.service';
import { FirestoreService } from './src/services/firestore.service';
import { StorageService } from './src/services/storage.service';
import { HealthService } from './src/services/health.service';
import { CustomerService } from './src/services/customer.service';
import { InviteCodeService } from './src/services/invite-code.service';
import { ReceiptService } from './src/services/receipt.service';
import { InvoiceService } from './src/services/invoice.service';
import { InvoiceReceiptService } from './src/services/invoice-receipt.service';
import { OffboardingService } from './src/offboarding/offboarding.service';
import { FirestoreController } from './src/controllers/firestore.controller';
import { StorageController } from './src/controllers/storage.controller';
import { HealthController } from './src/controllers/health.controller';
import { CustomerController } from './src/controllers/customer.controller';
import { InviteCodeController } from './src/controllers/invite-code.controller';
import { ReceiptController } from './src/controllers/receipt.controller';
import { InvoiceController } from './src/controllers/invoice.controller';
import { InvoiceReceiptController } from './src/controllers/invoice-receipt.controller';
import { OffboardingController } from './src/offboarding/offboarding.controller';
import { requireAuth } from './src/middlewares/auth.middleware';
import { createRoutes } from './src/routes/index';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // Optional password protection
const ADMIN_TELEGRAM_USER_ID = process.env.ADMIN_TELEGRAM_USER_ID;
const ADMIN_TELEGRAM_USERNAME = process.env.ADMIN_TELEGRAM_USERNAME;

// Initialize GCP clients
const firestore = getFirestoreClient();
const storage = getStorageClient();

// Get bucket names from environment
const INVOICES_BUCKET = process.env.STORAGE_BUCKET || 'papertrail-invoice-invoices';
const GENERATED_INVOICES_BUCKET =
  process.env.GENERATED_INVOICES_BUCKET || 'papertrail-invoice-generated-invoices';

// Initialize services
const firestoreService = new FirestoreService(firestore);
const storageService = new StorageService(storage);
const healthService = new HealthService(firestoreService, storageService);
const customerService = new CustomerService(firestore, storage);
const inviteCodeService = new InviteCodeService(firestore);
const receiptService = new ReceiptService();
const invoiceService = new InvoiceService();
const invoiceReceiptService = new InvoiceReceiptService();
const offboardingService = new OffboardingService(
  firestore,
  storage,
  INVOICES_BUCKET,
  GENERATED_INVOICES_BUCKET
);

// Initialize controllers
const firestoreController = new FirestoreController(firestoreService);
const storageController = new StorageController(storageService);
const healthController = new HealthController(healthService);
const customerController = new CustomerController(customerService, offboardingService);
const inviteCodeController = new InviteCodeController(inviteCodeService);
const receiptController = new ReceiptController(receiptService);
const invoiceController = new InvoiceController(invoiceService);
const invoiceReceiptController = new InvoiceReceiptController(invoiceReceiptService);
const offboardingController = new OffboardingController(offboardingService);

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve admin config (no auth required for config endpoint)
app.get('/api/config', (req, res) => {
  res.json({
    adminUserId: ADMIN_TELEGRAM_USER_ID || null,
    adminUsername: ADMIN_TELEGRAM_USERNAME || null,
  });
});

// Apply auth to API routes only (not static files)
app.use('/api', requireAuth(ADMIN_PASSWORD));

// Register routes
app.use(
  '/api',
  createRoutes(
    firestoreController,
    storageController,
    healthController,
    customerController,
    inviteCodeController,
    receiptController,
    invoiceController,
    invoiceReceiptController,
    offboardingController
  )
);

// Start server
app.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT} 🚀`);
});

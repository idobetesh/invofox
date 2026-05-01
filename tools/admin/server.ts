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

// Note on logging: the reused worker code does `import pino from 'pino'`
// (see services/worker/src/logger.ts). Admin does NOT bundle pino — the
// `pino` import is redirected to `src/shims/pino.ts` via tsconfig `paths`
// (registered at runtime by `tsconfig-paths/register` in the start script).
// The shim returns a no-op logger, so any worker-side `logger.info(...)`
// calls are silently swallowed; admin code uses console.log/console.error
// directly (see report.service.ts / report.controller.ts).

import express from 'express';
import * as path from 'path';
import * as dotenv from 'dotenv';

import {
  getFirestoreClient,
  getStorageClient,
  FirestoreService,
  StorageService,
  HealthService,
  CustomerService,
  InviteCodeService,
  ReceiptService,
  InvoiceService,
  InvoiceReceiptService,
  FeatureFlagsService,
  InvoiceJobsService,
  BroadcastService,
  ReportService,
} from './src/services';
import {
  FirestoreController,
  StorageController,
  HealthController,
  CustomerController,
  InviteCodeController,
  ReceiptController,
  InvoiceController,
  InvoiceReceiptController,
  FeatureFlagsController,
  InvoiceJobsController,
  BroadcastController,
  ReportController,
} from './src/controllers';
import { OffboardingService } from './src/offboarding/offboarding.service';
import { OffboardingController } from './src/offboarding/offboarding.controller';
import { requireAuth } from './src/middlewares/auth.middleware';
import { createRoutes } from './src/routes/index';
// Reused worker singleton: initialize once at startup so the report core's
// `getFirestore()` calls hit the same ADC project as the rest of admin.
import { getFirestore as initWorkerFirestore } from '../../services/worker/src/services/firestore.service';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // Optional password protection
const ADMIN_TELEGRAM_USER_ID = process.env.ADMIN_TELEGRAM_USER_ID;
const ADMIN_TELEGRAM_USERNAME = process.env.ADMIN_TELEGRAM_USERNAME;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Initialize GCP clients
const firestore = getFirestoreClient();
const storage = getStorageClient();

// Eagerly initialize the worker's Firestore singleton so the reused report
// code reads from the same project as the admin (uses ADC under the hood).
initWorkerFirestore();

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
const featureFlagsService = new FeatureFlagsService(firestore);
const invoiceJobsService = new InvoiceJobsService(firestore);
const broadcastService = new BroadcastService(firestore, TELEGRAM_BOT_TOKEN);
const reportService = new ReportService(firestore);

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
const featureFlagsController = new FeatureFlagsController(featureFlagsService);
const invoiceJobsController = new InvoiceJobsController(invoiceJobsService);
const broadcastController = new BroadcastController(broadcastService, customerService);
const reportController = new ReportController(reportService);

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const now = new Date();
    const timestamp = `${now.toISOString().slice(0, 10)}|${now.toISOString().slice(11, 19)}`;
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
    offboardingController,
    featureFlagsController,
    invoiceJobsController,
    broadcastController,
    reportController
  )
);

// Start server
app.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT} 🚀`);
});

/**
 * Papertrail Admin Tool
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
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';
import * as dotenv from 'dotenv';

import { FirestoreService } from './src/services/firestore.service';
import { StorageService } from './src/services/storage.service';
import { HealthService } from './src/services/health.service';
import { CustomerService } from './src/services/customer.service';
import { InviteCodeService } from './src/services/invite-code.service';
import { FirestoreController } from './src/controllers/firestore.controller';
import { StorageController } from './src/controllers/storage.controller';
import { HealthController } from './src/controllers/health.controller';
import { CustomerController } from './src/controllers/customer.controller';
import { InviteCodeController } from './src/controllers/invite-code.controller';
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
const firestore = new Firestore();
const storage = new Storage();

// Initialize services
const firestoreService = new FirestoreService(firestore);
const storageService = new StorageService(storage);
const healthService = new HealthService(firestoreService, storageService);
const customerService = new CustomerService(firestore, storage);
const inviteCodeService = new InviteCodeService(firestore);

// Initialize controllers
const firestoreController = new FirestoreController(firestoreService);
const storageController = new StorageController(storageService);
const healthController = new HealthController(healthService);
const customerController = new CustomerController(customerService);
const inviteCodeController = new InviteCodeController(inviteCodeService);

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
    inviteCodeController
  )
);

// Start server
app.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT} 🚀`);
});

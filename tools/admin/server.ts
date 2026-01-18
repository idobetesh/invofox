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
import { FirestoreController } from './src/controllers/firestore.controller';
import { StorageController } from './src/controllers/storage.controller';
import { HealthController } from './src/controllers/health.controller';
import { requireAuth } from './src/middlewares/auth.middleware';
import { createRoutes } from './src/routes/index';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // Optional password protection

// Initialize GCP clients
const firestore = new Firestore();
const storage = new Storage();

// Initialize services
const firestoreService = new FirestoreService(firestore);
const storageService = new StorageService(storage);
const healthService = new HealthService(firestoreService, storageService);

// Initialize controllers
const firestoreController = new FirestoreController(firestoreService);
const storageController = new StorageController(storageService);
const healthController = new HealthController(healthService);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Apply auth to API routes only (not static files)
app.use('/api', requireAuth(ADMIN_PASSWORD));

// Register routes
app.use('/api', createRoutes(firestoreController, storageController, healthController));

// Start server
app.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT} 🚀`);
});

/**
 * Application routes
 */

import { Router } from 'express';
import { validateCloudTasks } from '../middlewares/cloudTasks';
import * as healthController from '../controllers/health.controller';
import * as processController from '../controllers/process.controller';

const router = Router();

// Health check (includes version)
router.get('/health', healthController.getHealth);

// Invoice processing (Cloud Tasks validated)
router.post('/process', validateCloudTasks, processController.processInvoice);

// Callback query handling (from webhook-handler)
router.post('/callback', processController.handleCallback);

// Manual failure notification (for testing)
router.post('/notify-failure', processController.notifyFailure);

export default router;

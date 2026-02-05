import { Router } from 'express';
import { FirestoreController } from '../controllers/firestore.controller';
import { StorageController } from '../controllers/storage.controller';
import { HealthController } from '../controllers/health.controller';
import { CustomerController } from '../controllers/customer.controller';
import { InviteCodeController } from '../controllers/invite-code.controller';
import { ReceiptController } from '../controllers/receipt.controller';
import { InvoiceController } from '../controllers/invoice.controller';
import { InvoiceReceiptController } from '../controllers/invoice-receipt.controller';
import { OffboardingController } from '../offboarding/offboarding.controller';
import { createHealthRoutes } from './health.routes';
import { createFirestoreRoutes } from './firestore.routes';
import { createStorageRoutes } from './storage.routes';
import { createCustomerRoutes } from './customer.routes';
import { createInviteCodeRoutes } from './invite-code.routes';
import { createReceiptRoutes } from './receipt.routes';
import { createInvoiceRoutes } from './invoice.routes';
import { createInvoiceReceiptRoutes } from './invoice-receipt.routes';
import { createOffboardingRoutes } from './offboarding.routes';

export function createRoutes(
  firestoreController: FirestoreController,
  storageController: StorageController,
  healthController: HealthController,
  customerController: CustomerController,
  inviteCodeController: InviteCodeController,
  receiptController: ReceiptController,
  invoiceController: InvoiceController,
  invoiceReceiptController: InvoiceReceiptController,
  offboardingController: OffboardingController
): Router {
  const router = Router();

  // Mount all sub-routers
  router.use(createHealthRoutes(healthController));
  router.use(createFirestoreRoutes(firestoreController));
  router.use(createStorageRoutes(storageController));
  router.use(createCustomerRoutes(customerController));
  router.use(createInviteCodeRoutes(inviteCodeController));
  router.use(createReceiptRoutes(receiptController));
  router.use(createInvoiceRoutes(invoiceController));
  router.use(createInvoiceReceiptRoutes(invoiceReceiptController));
  router.use(createOffboardingRoutes(offboardingController));

  return router;
}

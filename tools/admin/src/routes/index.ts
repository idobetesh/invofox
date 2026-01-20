import { Router } from 'express';
import { FirestoreController } from '../controllers/firestore.controller';
import { StorageController } from '../controllers/storage.controller';
import { HealthController } from '../controllers/health.controller';
import { CustomerController } from '../controllers/customer.controller';
import { InviteCodeController } from '../controllers/invite-code.controller';

export function createRoutes(
  firestoreController: FirestoreController,
  storageController: StorageController,
  healthController: HealthController,
  customerController: CustomerController,
  inviteCodeController: InviteCodeController
): Router {
  const router = Router();

  // Health check (detailed status)
  router.get('/health', healthController.check);

  // Firestore routes
  router.get('/firestore/collections', firestoreController.listCollections);
  // Specific routes before parameterized ones to avoid conflicts
  router.post(
    '/firestore/collections/:collectionName/delete-multiple',
    firestoreController.deleteMultipleDocuments
  );
  router.get('/firestore/collections/:collectionName/:documentId', firestoreController.getDocument);
  router.put(
    '/firestore/collections/:collectionName/:documentId',
    firestoreController.updateDocument
  );
  router.delete(
    '/firestore/collections/:collectionName/:documentId',
    firestoreController.deleteDocument
  );
  router.get('/firestore/collections/:collectionName', firestoreController.listDocuments);

  // Storage routes
  router.get('/storage/buckets', storageController.listBuckets);
  router.get('/storage/buckets/:bucketName/objects', storageController.listObjects);
  router.get('/storage/buckets/:bucketName/objects/*', storageController.getObject);
  router.delete('/storage/buckets/:bucketName/objects/*', storageController.deleteObject);
  router.post(
    '/storage/buckets/:bucketName/delete-multiple',
    storageController.deleteMultipleObjects
  );

  // Customer routes
  router.get('/customers', customerController.listCustomers);
  router.get('/customers/:chatId/offboarding-preview', customerController.getOffboardingPreview);
  router.delete('/customers/:chatId/offboard', customerController.offboardCustomer);

  // Invite code routes
  router.post('/invite-codes', inviteCodeController.createInviteCode);
  router.get('/invite-codes', inviteCodeController.listInviteCodes);
  router.get('/invite-codes/:code', inviteCodeController.getInviteCode);
  router.post('/invite-codes/:code/revoke', inviteCodeController.revokeInviteCode);
  router.delete('/invite-codes/:code', inviteCodeController.deleteInviteCode);

  return router;
}

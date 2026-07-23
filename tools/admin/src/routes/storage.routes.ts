import { Router } from 'express';
import { StorageController } from '../controllers/storage.controller';

const BASE_PATH = '/storage/buckets';

export function createStorageRoutes(storageController: StorageController): Router {
  const router = Router();

  router.get(BASE_PATH, storageController.listBuckets);
  router.get(`${BASE_PATH}/:bucketName/objects`, storageController.listObjects);
  router.get(`${BASE_PATH}/:bucketName/objects/*`, storageController.getObject);
  router.delete(`${BASE_PATH}/:bucketName/objects/*`, storageController.deleteObject);
  router.post(`${BASE_PATH}/:bucketName/delete-multiple`, storageController.deleteMultipleObjects);
  router.post(
    `${BASE_PATH}/:bucketName/download-multiple`,
    storageController.downloadMultipleObjects
  );

  return router;
}

import { Router } from 'express';
import { FeatureFlagsController } from '../controllers/feature-flags.controller';

const BASE = '/feature-flags';

export function createFeatureFlagsRoutes(controller: FeatureFlagsController): Router {
  const router = Router();

  router.get(BASE, controller.listFlags); // GET  /feature-flags?includeArchived=true
  router.post(BASE, controller.createFlag); // POST /feature-flags
  router.get(`${BASE}/:key`, controller.getFlag); // GET  /feature-flags/:key
  router.put(`${BASE}/:key`, controller.updateFlag); // PUT  /feature-flags/:key
  router.patch(`${BASE}/:key/toggle`, controller.toggleFlag); // PATCH /feature-flags/:key/toggle
  router.patch(`${BASE}/:key/archive`, controller.archiveFlag); // PATCH /feature-flags/:key/archive
  router.delete(`${BASE}/:key`, controller.deleteFlag); // DELETE /feature-flags/:key
  router.get(`${BASE}/:key/audit`, controller.getAuditLog); // GET  /feature-flags/:key/audit

  return router;
}

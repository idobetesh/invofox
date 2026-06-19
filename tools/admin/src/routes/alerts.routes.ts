import { Router } from 'express';
import { AlertsController } from '../controllers/alerts.controller';

export function createAlertsRoutes(controller: AlertsController): Router {
  const router = Router();
  router.get('/alerts', controller.list);
  return router;
}

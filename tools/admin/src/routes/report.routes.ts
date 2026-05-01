import { Router } from 'express';
import { ReportController } from '../controllers/report.controller';

const BASE = '/reports';

export function createReportRoutes(controller: ReportController): Router {
  const router = Router();

  router.post(`${BASE}/generate`, controller.generate); // POST /reports/generate

  return router;
}

import { Router } from 'express';
import { InvoiceJobsController } from '../controllers/invoice-jobs.controller';

const BASE = '/invoice-jobs';

export function createInvoiceJobsRoutes(controller: InvoiceJobsController): Router {
  const router = Router();

  router.get(BASE, controller.listJobs); // GET  /invoice-jobs
  router.put(`${BASE}/:jobId/correction`, controller.correctJob); // PUT  /invoice-jobs/:jobId/correction

  return router;
}

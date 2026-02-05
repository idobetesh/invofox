/**
 * Invoice Routes
 * API endpoints for invoice generation
 */

import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller';

const BASE_PATH = '/invoices';

export function createInvoiceRoutes(invoiceController: InvoiceController): Router {
  const router = Router();

  // POST /invoices/generate - Generate new invoice
  router.post(`${BASE_PATH}/generate`, invoiceController.generateInvoice);

  return router;
}

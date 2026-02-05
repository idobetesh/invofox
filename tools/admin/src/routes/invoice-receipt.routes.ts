/**
 * Invoice-Receipt Routes
 * API endpoints for invoice-receipt generation
 */

import { Router } from 'express';
import { InvoiceReceiptController } from '../controllers/invoice-receipt.controller';

const BASE_PATH = '/invoice-receipts';

export function createInvoiceReceiptRoutes(
  invoiceReceiptController: InvoiceReceiptController
): Router {
  const router = Router();

  // POST /invoice-receipts/generate - Generate new invoice-receipt
  router.post(`${BASE_PATH}/generate`, invoiceReceiptController.generateInvoiceReceipt);

  return router;
}

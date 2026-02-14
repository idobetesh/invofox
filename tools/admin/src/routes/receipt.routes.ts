/**
 * Receipt Routes
 * API endpoints for receipt generation
 */

import { Router } from 'express';
import { ReceiptController } from '../controllers/receipt.controller';

const BASE_PATH = '/receipts';

export function createReceiptRoutes(receiptController: ReceiptController): Router {
  const router = Router();

  // GET /invoices - List invoices filtered by chatId and status
  router.get('/invoices', receiptController.listInvoices);

  // POST /receipts/generate - Generate receipt for invoice
  router.post(`${BASE_PATH}/generate`, receiptController.generateReceipt);

  // POST /receipts/generate-multi - Generate receipt for multiple invoices
  router.post(`${BASE_PATH}/generate-multi`, receiptController.generateMultiInvoiceReceipt);

  return router;
}

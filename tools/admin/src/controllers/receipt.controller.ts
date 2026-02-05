/**
 * Receipt Controller
 * HTTP handlers for receipt generation endpoints
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Firestore } from '@google-cloud/firestore';
import { ReceiptService } from '../services/receipt.service';

type ValidationRule = { field: string; message?: string; validate?: (value: unknown) => boolean };

function validateBody(body: Record<string, unknown>, rules: ValidationRule[]): string | null {
  for (const { field, message, validate } of rules) {
    const value = body[field];
    if (value === undefined || value === null || value === '') {
      return message ?? `Missing required field: ${field}`;
    }
    if (validate && !validate(value)) {
      return message ?? `Invalid field: ${field}`;
    }
  }
  return null;
}

function badRequest(res: Response, error: string): void {
  res.status(StatusCodes.BAD_REQUEST).json({ error });
}

function serverError(res: Response, action: string, error: unknown): void {
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    error: `Failed to ${action}: ${error instanceof Error ? error.message : 'Unknown error'}`,
  });
}

function isUserError(message: string): boolean {
  const patterns = [
    'not found',
    'does not belong',
    'already paid',
    'exceeds',
    'must be greater',
    'required',
  ];
  return patterns.some((p) => message.toLowerCase().includes(p));
}

export class ReceiptController {
  constructor(private receiptService: ReceiptService) {}

  /**
   * POST /receipts/generate
   * Generate a receipt for an existing invoice
   */
  generateReceipt = async (req: Request, res: Response): Promise<void> => {
    try {
      const { invoiceNumber, paymentAmount, paymentMethod, date, chatId } = req.body;

      const error = validateBody(req.body, [
        { field: 'invoiceNumber' },
        {
          field: 'paymentAmount',
          message: 'Missing or invalid field: paymentAmount (must be a number)',
          validate: (v) => typeof v === 'number',
        },
        { field: 'paymentMethod' },
        {
          field: 'date',
          message: 'Invalid date format. Expected: YYYY-MM-DD',
          validate: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
        },
      ]);
      if (error) {
        return badRequest(res, error);
      }

      // Generate receipt
      const result = await this.receiptService.generateReceiptForInvoice({
        invoiceNumber,
        paymentAmount,
        paymentMethod,
        date,
        chatId,
      });

      res.status(StatusCodes.CREATED).json(result);
    } catch (error) {
      console.error('Error generating receipt:', error);
      if (error instanceof Error && isUserError(error.message)) {
        return badRequest(res, error.message);
      }
      serverError(res, 'generate receipt', error);
    }
  };

  /**
   * GET /invoices
   * List invoices filtered by chatId and payment status
   */
  listInvoices = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatId = req.query.chatId ? parseInt(req.query.chatId as string, 10) : undefined;
      const statusParam = req.query.status as string;

      if (!chatId) {
        return badRequest(res, 'Missing required parameter: chatId');
      }

      // Parse status filter (comma-separated: "unpaid,partial")
      const statusFilter = statusParam ? statusParam.split(',') : ['unpaid', 'partial'];

      // Query Firestore for invoices
      const firestore = new Firestore();

      const query = firestore
        .collection('generated_invoices')
        .where('chatId', '==', chatId)
        .where('documentType', '==', 'invoice');

      // Firestore doesn't support 'in' queries with 'where', so we'll fetch all and filter
      const snapshot = await query.get();

      const invoices = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            invoiceNumber: data.invoiceNumber,
            chatId: data.chatId,
            customerName: data.customerName,
            customerTaxId: data.customerTaxId,
            description: data.description,
            amount: data.amount,
            currency: data.currency || 'ILS',
            date: data.date,
            paymentStatus: data.paymentStatus || 'unpaid',
            paidAmount: data.paidAmount || 0,
            remainingBalance: data.remainingBalance || data.amount,
            relatedReceiptIds: data.relatedReceiptIds || [],
          };
        })
        .filter((invoice) => statusFilter.includes(invoice.paymentStatus));

      res.json({ invoices, count: invoices.length });
    } catch (error) {
      console.error('Error listing invoices:', error);
      serverError(res, 'list invoices', error);
    }
  };
}

/**
 * Invoice-Receipt Controller
 * HTTP handlers for invoice-receipt generation endpoints
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { InvoiceReceiptService } from '../services/invoice-receipt.service';

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
  return ['required', 'must be greater'].some((p) => message.toLowerCase().includes(p));
}

export class InvoiceReceiptController {
  constructor(private invoiceReceiptService: InvoiceReceiptService) {}

  /**
   * POST /invoice-receipts/generate
   * Generate a new invoice-receipt (invoice with immediate payment)
   */
  generateInvoiceReceipt = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        chatId,
        customerName,
        customerTaxId,
        description,
        amount,
        currency,
        date,
        paymentMethod,
      } = req.body;

      const error = validateBody(req.body, [
        { field: 'chatId' },
        { field: 'customerName' },
        { field: 'description' },
        {
          field: 'amount',
          message: 'Missing or invalid field: amount (must be a number)',
          validate: (v) => typeof v === 'number',
        },
        { field: 'currency' },
        {
          field: 'date',
          message: 'Invalid date format. Expected: YYYY-MM-DD',
          validate: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
        },
        { field: 'paymentMethod' },
      ]);
      if (error) {
        return badRequest(res, error);
      }

      const result = await this.invoiceReceiptService.generateInvoiceReceipt({
        chatId,
        customerName,
        customerTaxId,
        description,
        amount,
        currency,
        date,
        paymentMethod,
      });

      res.status(StatusCodes.CREATED).json(result);
    } catch (error) {
      console.error('Error generating invoice-receipt:', error);
      if (error instanceof Error && isUserError(error.message)) {
        return badRequest(res, error.message);
      }
      serverError(res, 'generate invoice-receipt', error);
    }
  };
}

/**
 * Invoice Controller
 * HTTP handlers for invoice generation endpoints
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { InvoiceService } from '../services/invoice.service';

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

export class InvoiceController {
  constructor(private invoiceService: InvoiceService) {}

  /**
   * POST /invoices/generate
   * Generate a new invoice
   *
   * Body:
   * {
   *   "chatId": -1003612582263,
   *   "customerName": "רובינזון ספרים",
   *   "customerTaxId": "123456789" (optional),
   *   "description": "פיתוח אתר",
   *   "amount": 500,
   *   "currency": "ILS",
   *   "date": "2026-02-03",
   *   "paymentMethod": "" (optional)
   * }
   */
  generateInvoice = async (req: Request, res: Response): Promise<void> => {
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

      const validationError = validateBody(req.body, [
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
      ]);

      if (validationError) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: validationError });
        return;
      }

      // Generate invoice
      const result = await this.invoiceService.generateInvoice({
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
      console.error('Error generating invoice:', error);

      // Check if it's a validation error
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('required') || message.includes('must be greater')) {
          res.status(StatusCodes.BAD_REQUEST).json({
            error: error.message,
          });
          return;
        }
      }

      // Internal server error
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to generate invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };
}

/**
 * Invoice Jobs Controller (Admin)
 * List and correct OCR-processed invoice jobs
 *
 * Routes:
 *   GET /api/invoice-jobs         - List jobs (optional ?chatId=N&limit=N)
 *   PUT /api/invoice-jobs/:jobId/correction - Correct amount/date/vendor
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { InvoiceJobsService, InvoiceJobCorrection } from '../services/invoice-jobs.service';

export class InvoiceJobsController {
  constructor(private invoiceJobsService: InvoiceJobsService) {}

  listJobs = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatIdRaw = req.query.chatId;
      const limitRaw = req.query.limit;
      const chatId = chatIdRaw ? parseInt(String(chatIdRaw), 10) : undefined;
      const limit = limitRaw ? Math.min(parseInt(String(limitRaw), 10), 200) : 50;

      if (chatIdRaw && isNaN(chatId!)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid chatId' });
        return;
      }

      const jobs = await this.invoiceJobsService.listInvoiceJobs(chatId, limit);
      res.json({ jobs, total: jobs.length });
    } catch (error) {
      console.error('Error listing invoice jobs:', error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: `Failed to list jobs: ${toMessage(error)}` });
    }
  };

  correctJob = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.params;
    const body = req.body as { totalAmount?: number; invoiceDate?: string; vendorName?: string };

    if (!jobId) {
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing jobId' });
      return;
    }

    const updates: InvoiceJobCorrection = {};
    if (body.totalAmount !== undefined) {
      const n = Number(body.totalAmount);
      if (isNaN(n) || n <= 0) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid totalAmount' });
        return;
      }
      updates.totalAmount = n;
    }
    if (body.invoiceDate !== undefined) {
      updates.invoiceDate = String(body.invoiceDate);
    }
    if (body.vendorName !== undefined) {
      updates.vendorName = String(body.vendorName).trim();
    }

    if (Object.keys(updates).length === 0) {
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'No fields to update' });
      return;
    }

    try {
      await this.invoiceJobsService.correctInvoiceJob(jobId, updates);
      res.json({ ok: true, jobId });
    } catch (error) {
      console.error('Error correcting invoice job:', error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: `Failed to correct job: ${toMessage(error)}` });
    }
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Report Controller (Admin)
 *
 * Routes:
 *   POST /api/reports/generate - Generate one or more reports and stream the
 *                                file(s) as an attachment download.
 *
 * Request body shape:
 *   {
 *     chatId: number,
 *     reportTypes: ('revenue' | 'expenses' | 'balance')[],   // 1+ entries
 *     formats: ('pdf' | 'excel' | 'csv')[],                  // 1+ entries
 *     datePreset?: 'this_month' | 'last_month' | 'ytd',
 *     customStart?: 'YYYY-MM-DD',
 *     customEnd?: 'YYYY-MM-DD',
 *     businessName?: string,
 *     includeLogo?: boolean
 *   }
 *
 * Response:
 *   - 1 type × 1 format → that single file (PDF/Excel/CSV) with its native mime
 *   - otherwise → application/zip containing every (type, format) combination
 */

import archiver from 'archiver';
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { ReportFormat, ReportType, DatePreset } from '../../../../shared/report.types';
import {
  ReportService,
  type GenerateReportsOptions,
  type GenerateReportResult,
  type SortOrder,
} from '../services/report.service';

const VALID_REPORT_TYPES: ReportType[] = ['revenue', 'expenses', 'balance'];
const VALID_FORMATS: ReportFormat[] = ['pdf', 'excel', 'csv'];
const VALID_PRESETS: DatePreset[] = ['this_month', 'last_month', 'ytd'];
const VALID_SORT_ORDERS: SortOrder[] = ['asc', 'desc'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ZIP_MIME = 'application/zip';

export class ReportController {
  constructor(private reportService: ReportService) {}

  generate = async (req: Request, res: Response): Promise<void> => {
    try {
      const options = parseAndValidateBody(req.body);
      const results = await this.reportService.generateReports(options);

      if (results.length === 1) {
        await sendSingleFile(res, results[0]);
        return;
      }

      await streamZip(res, results, options);
    } catch (error) {
      const message = toMessage(error);
      const status = isValidationError(error)
        ? StatusCodes.BAD_REQUEST
        : StatusCodes.INTERNAL_SERVER_ERROR;
      console.error('[reports] Failed to generate report:', message);
      // Headers may not have been sent yet (single-file path or pre-archive
      // failures); guard against double-send for late zip-stream errors.
      if (!res.headersSent) {
        res.status(status).json({ error: `Failed to generate report: ${message}` });
      } else {
        res.end();
      }
    }
  };
}

async function sendSingleFile(res: Response, result: GenerateReportResult): Promise<void> {
  res.setHeader('Content-Type', result.mimeType);
  // Quote the filename to handle non-ASCII characters safely. Browsers will
  // honor a quoted ASCII filename; we keep our generated names ASCII-only.
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Content-Length', String(result.buffer.length));
  res.status(StatusCodes.OK).end(result.buffer);
}

/**
 * Stream a zip archive of every generated report. We use streaming rather than
 * buffering the whole zip so the browser starts receiving bytes immediately
 * and we never hold a large concatenated buffer in memory.
 */
function streamZip(
  res: Response,
  results: GenerateReportResult[],
  options: GenerateReportsOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zipName = buildZipFilename(results, options);

    res.setHeader('Content-Type', ZIP_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('warning', (err) => {
      // ENOENT here means a missing optional file; for our in-memory buffers
      // this should never fire. Surface anything else as a real error.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        reject(err);
      }
    });
    archive.on('error', reject);
    res.on('close', () => resolve());

    archive.pipe(res);

    for (const result of results) {
      archive.append(result.buffer, { name: result.filename });
    }

    archive.finalize().catch(reject);
  });
}

function buildZipFilename(
  results: GenerateReportResult[],
  options: GenerateReportsOptions
): string {
  // Try to infer the date span from the first generated filename, which
  // already encodes the resolved range (e.g. report_revenue_2026-04-01_2026-04-30.pdf).
  // Falls back to the chatId if parsing fails.
  const sample = results[0]?.filename ?? '';
  const match = sample.match(/_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\./);
  const range = match ? `${match[1]}_${match[2]}` : `chat_${options.chatId}`;
  return `reports_${options.chatId}_${range}.zip`;
}

/**
 * Marker class so we can map validation problems to HTTP 400 cleanly.
 */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isValidationError(error: unknown): boolean {
  return error instanceof ValidationError;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Strict whitelist-based validation of the request body. Every input that ends
 * up in a Firestore query or filename gets sanitized here (rule: validate all
 * external input).
 */
function parseAndValidateBody(body: unknown): GenerateReportsOptions {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }

  const raw = body as Record<string, unknown>;

  const chatId = Number(raw.chatId);
  if (!Number.isFinite(chatId) || !Number.isInteger(chatId)) {
    throw new ValidationError('chatId is required and must be an integer');
  }

  const reportTypes = parseEnumArray<ReportType>(
    raw.reportTypes,
    'reportTypes',
    VALID_REPORT_TYPES
  );
  const formats = parseEnumArray<ReportFormat>(raw.formats, 'formats', VALID_FORMATS);

  const customStart = optionalString(raw.customStart);
  const customEnd = optionalString(raw.customEnd);
  const datePreset = optionalString(raw.datePreset);

  if (!customStart && !customEnd && !datePreset) {
    throw new ValidationError(
      'Provide either datePreset or both customStart and customEnd (YYYY-MM-DD)'
    );
  }

  if ((customStart && !customEnd) || (!customStart && customEnd)) {
    throw new ValidationError('Both customStart and customEnd must be provided together');
  }

  if (customStart && customEnd && (!DATE_REGEX.test(customStart) || !DATE_REGEX.test(customEnd))) {
    throw new ValidationError('customStart and customEnd must be in YYYY-MM-DD format');
  }

  if (datePreset && !VALID_PRESETS.includes(datePreset as DatePreset)) {
    throw new ValidationError(`datePreset must be one of: ${VALID_PRESETS.join(', ')}`);
  }

  const businessName = optionalString(raw.businessName);
  if (businessName && businessName.length > 200) {
    throw new ValidationError('businessName must be 200 characters or fewer');
  }

  const includeLogo = raw.includeLogo === undefined ? true : Boolean(raw.includeLogo);

  const sortOrderRaw = optionalString(raw.sortOrder);
  if (sortOrderRaw && !VALID_SORT_ORDERS.includes(sortOrderRaw as SortOrder)) {
    throw new ValidationError(`sortOrder must be one of: ${VALID_SORT_ORDERS.join(', ')}`);
  }
  const sortOrder: SortOrder = (sortOrderRaw as SortOrder) ?? 'asc';

  return {
    chatId,
    reportTypes,
    formats,
    datePreset: customStart ? undefined : (datePreset as DatePreset),
    customStart: customStart || undefined,
    customEnd: customEnd || undefined,
    businessName: businessName || undefined,
    includeLogo,
    sortOrder,
  };
}

/**
 * Validate that `value` is a non-empty array whose entries all belong to the
 * provided `allowed` whitelist. Returns a deduplicated list in the original
 * caller-provided order so filenames are stable across requests.
 */
function parseEnumArray<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[]
): T[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `${fieldName} is required and must be a non-empty array of: ${allowed.join(', ')}`
    );
  }
  if (value.length === 0) {
    throw new ValidationError(`${fieldName} must contain at least one entry`);
  }

  const seen = new Set<T>();
  const out: T[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.includes(entry as T)) {
      throw new ValidationError(
        `${fieldName} entries must be one of: ${allowed.join(', ')} (got ${JSON.stringify(entry)})`
      );
    }
    if (!seen.has(entry as T)) {
      seen.add(entry as T);
      out.push(entry as T);
    }
  }
  return out;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Report Service (Admin)
 *
 * Local-only report generation. Reuses the worker's report core + generators
 * directly (no service rewrites) so admin-side reports match what the bot
 * produces, with two extra affordances: arbitrary custom date ranges and any
 * chatId — both designed for debugging report discrepancies (e.g. a single
 * day's missing expense).
 *
 * Reads from production Firestore + Cloud Storage via Application Default
 * Credentials. Strictly read-only.
 *
 * Multi-generation: callers can request several report types and several
 * formats in a single call. We compute the cartesian product and reuse work
 * across the matrix:
 *   - business name + logo are looked up once
 *   - per-type ReportData is computed once and rendered into each format
 */

import { Firestore } from '@google-cloud/firestore';
import type {
  DateRange,
  ReportFormat,
  ReportType,
  ReportData,
  DatePreset,
  BalanceInvoiceForReport,
  InvoiceForReport,
} from '../../../../shared/report.types';
import { BUSINESS_CONFIG_COLLECTION } from '../../../../shared/collections';
import { generateReportData } from '../../../../services/worker/src/services/report/core';
import { getDateRangeForPreset } from '../../../../services/worker/src/services/report/core/date-utils';
import {
  generatePDFReport,
  generateExcelReport,
  generateCSVReport,
} from '../../../../services/worker/src/services/report/generators';

export type SortOrder = 'asc' | 'desc';

export interface GenerateReportsOptions {
  chatId: number;
  reportTypes: ReportType[];
  formats: ReportFormat[];
  // Either provide a preset or both customStart + customEnd. Custom takes precedence.
  datePreset?: DatePreset;
  customStart?: string; // YYYY-MM-DD
  customEnd?: string; // YYYY-MM-DD
  // Optional override for header business name. If not provided, looked up from business_config.
  businessName?: string;
  // Optional toggle: include the customer logo in the header (PDF only). Defaults to true.
  includeLogo?: boolean;
  // Sort order for invoices by date inside the report body. Defaults to 'asc'
  // (oldest first) — admin-side override; the worker's report core always
  // returns 'desc'. We re-sort here to keep worker code untouched.
  sortOrder?: SortOrder;
}

export interface GenerateReportResult {
  reportType: ReportType;
  format: ReportFormat;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

const MIME_TYPE_BY_FORMAT: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

const EXTENSION_BY_FORMAT: Record<ReportFormat, string> = {
  pdf: 'pdf',
  excel: 'xlsx',
  csv: 'csv',
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class ReportService {
  constructor(private firestore: Firestore) {}

  /**
   * Generate the cartesian product of (reportTypes × formats).
   * Returns one GenerateReportResult per combination, in the order:
   *   for each reportType: for each format
   * which keeps the per-type ReportData hot in memory across format renders.
   */
  async generateReports(options: GenerateReportsOptions): Promise<GenerateReportResult[]> {
    if (options.reportTypes.length === 0) {
      throw new Error('reportTypes must contain at least one entry');
    }
    if (options.formats.length === 0) {
      throw new Error('formats must contain at least one entry');
    }

    const dateRange = this.resolveDateRange(options);

    const businessName = options.businessName?.trim()
      ? options.businessName.trim()
      : await this.lookupBusinessName(options.chatId);

    const includeLogo = options.includeLogo !== false;
    // Only bother fetching the logo if at least one selected format actually
    // uses it (PDF). Excel/CSV ignore the logo entirely.
    const needsLogo = includeLogo && options.formats.includes('pdf');
    const logoUrl = needsLogo ? await this.lookupLogoBase64(options.chatId) : undefined;

    const sortOrder: SortOrder = options.sortOrder ?? 'asc';
    const results: GenerateReportResult[] = [];

    for (const reportType of options.reportTypes) {
      // Compute ReportData once per type, then render in each format. This is
      // the main reason to do the matrix server-side: PDF/Excel/CSV all
      // consume the same shape; only the renderer differs.
      const reportData = await generateReportData(
        options.chatId,
        dateRange,
        businessName,
        reportType,
        logoUrl
      );

      // Worker hard-codes desc by date — re-sort in-place to honor the admin
      // user's choice. Mutating is safe: the array is owned by us.
      sortInvoicesByDate(reportData, sortOrder);

      const invoiceCount = countInvoices(reportData);
      console.log(
        `[reports] chatId=${options.chatId} type=${reportType} ` +
          `range=${dateRange.start}..${dateRange.end} invoices=${invoiceCount} sort=${sortOrder}`
      );

      for (const format of options.formats) {
        const buffer = await this.renderToBuffer(reportData, format);
        results.push({
          reportType,
          format,
          buffer,
          filename: this.buildFilename(reportType, dateRange, format),
          mimeType: MIME_TYPE_BY_FORMAT[format],
        });
      }
    }

    return results;
  }

  private resolveDateRange(options: GenerateReportsOptions): DateRange {
    const { datePreset, customStart, customEnd } = options;

    if (customStart || customEnd) {
      if (!customStart || !customEnd) {
        throw new Error('Both customStart and customEnd must be provided for a custom range');
      }
      if (!DATE_REGEX.test(customStart) || !DATE_REGEX.test(customEnd)) {
        throw new Error('customStart and customEnd must be in YYYY-MM-DD format');
      }
      if (customStart > customEnd) {
        throw new Error('customStart must be on or before customEnd');
      }
      return { start: customStart, end: customEnd };
    }

    if (!datePreset) {
      throw new Error('Either datePreset or customStart+customEnd must be provided');
    }

    return getDateRangeForPreset(datePreset);
  }

  private async lookupBusinessName(chatId: number): Promise<string> {
    try {
      const doc = await this.firestore
        .collection(BUSINESS_CONFIG_COLLECTION)
        .doc(`chat_${chatId}`)
        .get();

      if (doc.exists) {
        const name = doc.data()?.business?.name;
        if (typeof name === 'string' && name.trim().length > 0) {
          return name;
        }
      }
    } catch (error) {
      console.warn(`[reports] failed to look up business name for chat ${chatId}:`, error);
    }
    return 'העסק שלי';
  }

  private async lookupLogoBase64(chatId: number): Promise<string | undefined> {
    try {
      const doc = await this.firestore
        .collection(BUSINESS_CONFIG_COLLECTION)
        .doc(`chat_${chatId}`)
        .get();

      if (!doc.exists) {
        return undefined;
      }

      const logoUrl = doc.data()?.business?.logoUrl;
      if (typeof logoUrl !== 'string' || logoUrl.length === 0) {
        return undefined;
      }

      return await fetchLogoAsBase64(logoUrl);
    } catch (error) {
      console.warn(`[reports] failed to load logo for chat ${chatId}:`, error);
      return undefined;
    }
  }

  private renderToBuffer(reportData: ReportData, format: ReportFormat): Promise<Buffer> {
    if (format === 'pdf') {
      return generatePDFReport(reportData);
    }
    if (format === 'excel') {
      return generateExcelReport(reportData);
    }
    return generateCSVReport(reportData);
  }

  private buildFilename(
    reportType: ReportType,
    dateRange: DateRange,
    format: ReportFormat
  ): string {
    const ext = EXTENSION_BY_FORMAT[format];
    return `report_${reportType}_${dateRange.start}_${dateRange.end}.${ext}`;
  }
}

const LOGO_FETCH_TIMEOUT_MS = 5_000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_LOGO_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * Fetch a logo URL and return as a base64 data URL the report template can embed.
 * Mirrors the worker's behavior for `data:` and `https://` URLs but skips the
 * circular-mask processing (we don't pull in `sharp` for the admin tool).
 */
async function fetchLogoAsBase64(logoUrl: string): Promise<string | undefined> {
  if (logoUrl.startsWith('data:')) {
    return logoUrl;
  }

  if (logoUrl.startsWith('https://')) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(logoUrl, { signal: controller.signal });
      if (!response.ok) {
        return undefined;
      }

      const rawContentType = response.headers.get('content-type') ?? '';
      const contentType = rawContentType.split(';')[0].trim();
      if (!ALLOWED_LOGO_CONTENT_TYPES.has(contentType)) {
        return undefined;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > LOGO_MAX_BYTES) {
        return undefined;
      }

      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } finally {
      clearTimeout(timer);
    }
  }

  // gs://, http://, and other schemes: skip — gs:// would need the worker's
  // storage client, and plain http:// is rejected to avoid SSRF over cleartext.
  return undefined;
}

function countInvoices(reportData: ReportData): number {
  return reportData.reportType === 'balance'
    ? (reportData.invoices as BalanceInvoiceForReport[]).length
    : reportData.invoices.length;
}

/**
 * Re-sort `reportData.invoices` in place by the row's `date` field.
 * Matches the worker's sort key (`new Date(invoice.date).getTime()`) so the
 * comparison logic is identical — only the direction flips.
 */
function sortInvoicesByDate(reportData: ReportData, order: SortOrder): void {
  const invoices = reportData.invoices as Array<InvoiceForReport | BalanceInvoiceForReport>;
  invoices.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return order === 'asc' ? dateA - dateB : dateB - dateA;
  });
}

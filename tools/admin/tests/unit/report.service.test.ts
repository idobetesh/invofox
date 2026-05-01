/**
 * ReportService Unit Tests
 *
 * Covers the validation branches inside generateReports / resolveDateRange
 * and the happy-path cartesian-product render loop.
 *
 * The worker's report core, generators, and Firestore are all mocked so
 * no real credentials or infra are needed.
 */

import { ReportService } from '../../src/services/report.service';
import type { GenerateReportsOptions } from '../../src/services/report.service';

// ---------------------------------------------------------------------------
// Mock worker modules (imported by report.service)
// ---------------------------------------------------------------------------

jest.mock('../../../../services/worker/src/services/report/core', () => ({
  generateReportData: jest.fn(),
}));

jest.mock('../../../../services/worker/src/services/report/core/date-utils', () => ({
  getDateRangeForPreset: jest.fn(),
}));

jest.mock('../../../../services/worker/src/services/report/generators', () => ({
  generatePDFReport: jest.fn(),
  generateExcelReport: jest.fn(),
  generateCSVReport: jest.fn(),
}));

import { generateReportData } from '../../../../services/worker/src/services/report/core';
import { getDateRangeForPreset } from '../../../../services/worker/src/services/report/core/date-utils';
import {
  generatePDFReport,
  generateExcelReport,
  generateCSVReport,
} from '../../../../services/worker/src/services/report/generators';

const mockGenerateReportData = generateReportData as jest.Mock;
const mockGetDateRangeForPreset = getDateRangeForPreset as jest.Mock;
const mockGeneratePDFReport = generatePDFReport as jest.Mock;
const mockGenerateExcelReport = generateExcelReport as jest.Mock;
const mockGenerateCSVReport = generateCSVReport as jest.Mock;

// ---------------------------------------------------------------------------
// Firestore mock
// ---------------------------------------------------------------------------

const mockDocGet = jest.fn();

jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: mockDocGet })),
    })),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(): ReportService {
  const { Firestore } = jest.requireMock('@google-cloud/firestore');
  return new ReportService(new Firestore());
}

function makeOptions(overrides: Partial<GenerateReportsOptions> = {}): GenerateReportsOptions {
  return {
    chatId: 123,
    reportTypes: ['revenue'],
    formats: ['pdf'],
    datePreset: 'this_month',
    ...overrides,
  };
}

const FAKE_REPORT_DATA = {
  reportType: 'revenue',
  invoices: [],
  businessName: 'Test',
  dateRange: { start: '2026-04-01', end: '2026-04-30' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDateRangeForPreset.mockReturnValue({ start: '2026-04-01', end: '2026-04-30' });
  mockGenerateReportData.mockResolvedValue(FAKE_REPORT_DATA);
  mockGeneratePDFReport.mockResolvedValue(Buffer.from('pdf'));
  mockGenerateExcelReport.mockResolvedValue(Buffer.from('xlsx'));
  mockGenerateCSVReport.mockResolvedValue(Buffer.from('csv'));
  mockDocGet.mockResolvedValue({ exists: false });
});

// ---------------------------------------------------------------------------
// generateReports — top-level guards
// ---------------------------------------------------------------------------

describe('generateReports — argument guards', () => {
  it('throws when reportTypes is empty', async () => {
    const svc = makeService();
    await expect(svc.generateReports(makeOptions({ reportTypes: [] }))).rejects.toThrow(
      'reportTypes must contain at least one entry'
    );
  });

  it('throws when formats is empty', async () => {
    const svc = makeService();
    await expect(svc.generateReports(makeOptions({ formats: [] }))).rejects.toThrow(
      'formats must contain at least one entry'
    );
  });
});

// ---------------------------------------------------------------------------
// resolveDateRange — validation branches
// ---------------------------------------------------------------------------

describe('resolveDateRange', () => {
  it('throws when neither preset nor custom range is provided', async () => {
    const svc = makeService();
    await expect(svc.generateReports(makeOptions({ datePreset: undefined }))).rejects.toThrow(
      'Either datePreset or customStart+customEnd must be provided'
    );
  });

  it('throws when customStart is provided without customEnd', async () => {
    const svc = makeService();
    await expect(
      svc.generateReports(makeOptions({ datePreset: undefined, customStart: '2026-01-01' }))
    ).rejects.toThrow('Both customStart and customEnd must be provided');
  });

  it('throws when customEnd is provided without customStart', async () => {
    const svc = makeService();
    await expect(
      svc.generateReports(makeOptions({ datePreset: undefined, customEnd: '2026-01-31' }))
    ).rejects.toThrow('Both customStart and customEnd must be provided');
  });

  it('throws when customStart format is invalid', async () => {
    const svc = makeService();
    await expect(
      svc.generateReports(
        makeOptions({ datePreset: undefined, customStart: '01/01/2026', customEnd: '2026-01-31' })
      )
    ).rejects.toThrow('YYYY-MM-DD');
  });

  it('throws when customStart is after customEnd', async () => {
    const svc = makeService();
    await expect(
      svc.generateReports(
        makeOptions({ datePreset: undefined, customStart: '2026-02-01', customEnd: '2026-01-01' })
      )
    ).rejects.toThrow('customStart must be on or before customEnd');
  });

  it('uses preset date range when no custom range is given', async () => {
    const svc = makeService();
    await svc.generateReports(makeOptions({ datePreset: 'last_month' }));
    expect(mockGetDateRangeForPreset).toHaveBeenCalledWith('last_month');
  });

  it('uses custom date range when both dates are valid', async () => {
    const svc = makeService();
    await svc.generateReports(
      makeOptions({ datePreset: undefined, customStart: '2026-01-01', customEnd: '2026-01-31' })
    );
    expect(mockGenerateReportData).toHaveBeenCalledWith(
      123,
      { start: '2026-01-01', end: '2026-01-31' },
      expect.any(String),
      'revenue',
      undefined
    );
  });
});

// ---------------------------------------------------------------------------
// Happy path — cartesian product and result shape
// ---------------------------------------------------------------------------

describe('generateReports — happy path', () => {
  it('returns one result per (type × format) combination', async () => {
    const svc = makeService();
    const results = await svc.generateReports(
      makeOptions({ reportTypes: ['revenue', 'expenses'], formats: ['pdf', 'csv'] })
    );

    // 2 types × 2 formats = 4 results
    expect(results).toHaveLength(4);
    expect(mockGenerateReportData).toHaveBeenCalledTimes(2);
    expect(mockGeneratePDFReport).toHaveBeenCalledTimes(2);
    expect(mockGenerateCSVReport).toHaveBeenCalledTimes(2);
  });

  it('result contains buffer, filename, and mimeType', async () => {
    const svc = makeService();
    const [result] = await svc.generateReports(makeOptions());

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.filename).toMatch(/report_revenue_.*\.pdf$/);
    expect(result.mimeType).toBe('application/pdf');
  });

  it('generates excel with correct mimeType', async () => {
    const svc = makeService();
    const [result] = await svc.generateReports(makeOptions({ formats: ['excel'] }));

    expect(mockGenerateExcelReport).toHaveBeenCalledTimes(1);
    expect(result.mimeType).toMatch(/spreadsheetml/);
    expect(result.filename).toMatch(/\.xlsx$/);
  });

  it('computes ReportData once per type when multiple formats are requested', async () => {
    const svc = makeService();
    await svc.generateReports(makeOptions({ formats: ['pdf', 'excel', 'csv'] }));

    expect(mockGenerateReportData).toHaveBeenCalledTimes(1);
  });
});

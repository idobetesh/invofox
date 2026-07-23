/**
 * ReportController Unit Tests
 *
 * Tests HTTP-level validation and response-mode selection.
 * ReportService is fully mocked — no Firestore or generators involved.
 *
 * Covers:
 *   - POST /reports/generate: required-field validation, enum validation, date validation
 *   - Single result (1 type × 1 format) → native file response with correct headers
 *   - Multiple results (>1 combination) → zip archive with correct headers
 *   - Service error → 500
 *   - ValidationError → 400
 */

import express from 'express';
import request from 'supertest';
import type { Response as SuperagentResponse } from 'superagent';
import { ReportController } from '../../src/controllers/report.controller';
import { ReportService } from '../../src/services/report.service';
import { createReportRoutes } from '../../src/routes/report.routes';
import type { GenerateReportResult } from '../../src/services/report.service';

jest.mock('../../src/services/report.service');
const MockedService = ReportService as jest.MockedClass<typeof ReportService>;

function makeResult(overrides: Partial<GenerateReportResult> = {}): GenerateReportResult {
  return {
    reportType: 'revenue',
    format: 'pdf',
    buffer: Buffer.from('fake-pdf'),
    filename: 'report_revenue_2026-04-01_2026-04-30.pdf',
    mimeType: 'application/pdf',
    ...overrides,
  };
}

function makeApp(generateReports: jest.Mock = jest.fn().mockResolvedValue([makeResult()])) {
  const svc = new MockedService({} as never);
  Object.assign(svc, { generateReports });
  const controller = new ReportController(svc);
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Connection', 'close');
    next();
  });
  app.use(express.json());
  app.use('/api', createReportRoutes(controller));
  return { app, svc };
}

/** Drain streamed zip bodies fully — avoids flaky HTTP parse errors in parallel Jest workers. */
function postReportGenerateZip(app: express.Application, body: object) {
  return request(app)
    .post('/api/reports/generate')
    .send(body)
    .buffer(true)
    .parse((res: SuperagentResponse, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

const VALID_BODY = {
  chatId: 123,
  reportTypes: ['revenue'],
  formats: ['pdf'],
  datePreset: 'this_month',
};

// ---------------------------------------------------------------------------
// Validation — required fields
// ---------------------------------------------------------------------------

describe('POST /api/reports/generate — validation', () => {
  it('returns 400 when chatId is missing', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, chatId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/chatId/i);
  });

  it('returns 400 when chatId is not an integer', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, chatId: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/chatId/i);
  });

  it('returns 400 when reportTypes is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/reports/generate').send({
      chatId: VALID_BODY.chatId,
      formats: VALID_BODY.formats,
      datePreset: VALID_BODY.datePreset,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportTypes/i);
  });

  it('returns 400 when reportTypes is empty', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, reportTypes: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportTypes/i);
  });

  it('returns 400 for invalid reportType entry', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, reportTypes: ['invalid'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportTypes/i);
  });

  it('returns 400 when formats is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/reports/generate').send({
      chatId: VALID_BODY.chatId,
      reportTypes: VALID_BODY.reportTypes,
      datePreset: VALID_BODY.datePreset,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/formats/i);
  });

  it('returns 400 when formats is empty', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, formats: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/formats/i);
  });

  it('returns 400 for invalid format entry', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, formats: ['docx'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/formats/i);
  });

  it('returns 400 when no date spec is provided', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/reports/generate').send({
      chatId: VALID_BODY.chatId,
      reportTypes: VALID_BODY.reportTypes,
      formats: VALID_BODY.formats,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/datePreset|customStart/i);
  });

  it('returns 400 when only customStart is provided', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, datePreset: undefined, customStart: '2026-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customEnd/i);
  });

  it('returns 400 when only customEnd is provided', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, datePreset: undefined, customEnd: '2026-01-31' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customStart/i);
  });

  it('returns 400 for malformed custom date', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({
        ...VALID_BODY,
        datePreset: undefined,
        customStart: '01-01-2026',
        customEnd: '2026-01-31',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/i);
  });

  it('returns 400 for invalid datePreset', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, datePreset: 'last_year' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/datePreset/i);
  });

  it('returns 400 when businessName exceeds 200 characters', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, businessName: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/businessName/i);
  });

  it('returns 400 for invalid sortOrder', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, sortOrder: 'random' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sortOrder/i);
  });
});

// ---------------------------------------------------------------------------
// Response mode — single file
// ---------------------------------------------------------------------------

describe('POST /api/reports/generate — single file', () => {
  it('returns the file directly when service returns one result', async () => {
    const result = makeResult({
      mimeType: 'application/pdf',
      filename: 'report_revenue_2026-04-01_2026-04-30.pdf',
      buffer: Buffer.from('pdf-content'),
    });
    const { app } = makeApp(jest.fn().mockResolvedValue([result]));

    const res = await request(app).post('/api/reports/generate').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(
      'report_revenue_2026-04-01_2026-04-30.pdf'
    );
    expect(res.headers['content-length']).toBe(String(result.buffer.length));
  });

  it('returns excel with the correct mime type', async () => {
    const result = makeResult({
      format: 'excel',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'report_revenue_2026-04-01_2026-04-30.xlsx',
      buffer: Buffer.from('xlsx-content'),
    });
    const { app } = makeApp(jest.fn().mockResolvedValue([result]));

    const res = await request(app)
      .post('/api/reports/generate')
      .send({ ...VALID_BODY, formats: ['excel'] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });
});

// ---------------------------------------------------------------------------
// Response mode — zip
// ---------------------------------------------------------------------------

describe('POST /api/reports/generate — zip', () => {
  it('returns a zip when service returns multiple results', async () => {
    const results = [
      makeResult({
        reportType: 'revenue',
        format: 'pdf',
        filename: 'report_revenue_2026-04-01_2026-04-30.pdf',
      }),
      makeResult({
        reportType: 'expenses',
        format: 'pdf',
        filename: 'report_expenses_2026-04-01_2026-04-30.pdf',
      }),
    ];
    const { app } = makeApp(jest.fn().mockResolvedValue(results));

    const res = await postReportGenerateZip(app, {
      ...VALID_BODY,
      reportTypes: ['revenue', 'expenses'],
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(res.headers['content-disposition']).toMatch(/\.zip/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it('includes date range in the zip filename', async () => {
    const results = [
      makeResult({ filename: 'report_revenue_2026-04-01_2026-04-30.pdf' }),
      makeResult({ filename: 'report_expenses_2026-04-01_2026-04-30.pdf' }),
    ];
    const { app } = makeApp(jest.fn().mockResolvedValue(results));

    const res = await postReportGenerateZip(app, {
      ...VALID_BODY,
      reportTypes: ['revenue', 'expenses'],
    });

    expect(res.headers['content-disposition']).toContain('2026-04-01_2026-04-30');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('POST /api/reports/generate — errors', () => {
  it('returns 500 when the service throws unexpectedly', async () => {
    const { app } = makeApp(jest.fn().mockRejectedValue(new Error('Firestore unavailable')));
    const res = await request(app).post('/api/reports/generate').send(VALID_BODY);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Firestore unavailable/i);
  });

  it('returns 400 when the request body is not an object', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Content-Type', 'application/json')
      .send('"just-a-string"');
    expect(res.status).toBe(400);
  });
});

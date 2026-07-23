/**
 * FeatureFlagsController Unit Tests
 *
 * Tests HTTP-level validation and error mapping.
 * The FeatureFlagsService is fully mocked — no Firestore involved.
 *
 * Covers:
 *   - POST /api/feature-flags: required fields, key regex, key length, description length, type enum
 *   - PUT /api/feature-flags/:key: description length, not-found mapping
 *   - GET /api/feature-flags/:key: not-found mapping
 *   - PATCH /api/feature-flags/:key/toggle: not-found mapping
 *   - PATCH /api/feature-flags/:key/archive: not-found mapping
 *   - DELETE /api/feature-flags/:key: not-found mapping
 */

import express from 'express';
import request from 'supertest';
import { FeatureFlagsController } from '../../src/controllers/feature-flags.controller';
import { FeatureFlagsService } from '../../src/services/feature-flags.service';
import { createFeatureFlagsRoutes } from '../../src/routes/feature-flags.routes';

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

jest.mock('../../src/services/feature-flags.service');
const MockedService = FeatureFlagsService as jest.MockedClass<typeof FeatureFlagsService>;

function makeApp(svcOverrides: Partial<FeatureFlagsService> = {}) {
  const svc = new MockedService({} as never);
  Object.assign(svc, {
    listFlags: jest.fn().mockResolvedValue([]),
    getFlag: jest.fn().mockResolvedValue(null),
    createFlag: jest.fn().mockResolvedValue({
      key: 'test',
      description: 'Test',
      type: 'boolean',
      enabled: false,
      defaultValue: false,
      archived: false,
      targets: {},
      prerequisites: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    updateFlag: jest.fn().mockResolvedValue({}),
    toggleFlag: jest.fn().mockResolvedValue({ key: 'test', enabled: true }),
    archiveFlag: jest.fn().mockResolvedValue(undefined),
    deleteFlag: jest.fn().mockResolvedValue(undefined),
    getAuditLog: jest.fn().mockResolvedValue([]),
    ...svcOverrides,
  });

  const controller = new FeatureFlagsController(svc);
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Connection', 'close');
    next();
  });
  app.use(express.json());
  app.use('/api', createFeatureFlagsRoutes(controller));
  return { app, svc };
}

// ---------------------------------------------------------------------------
// POST /api/feature-flags — validation
// ---------------------------------------------------------------------------

describe('POST /api/feature-flags', () => {
  it('returns 400 when key is missing', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ description: 'Test', type: 'boolean' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 when description is missing', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my-flag', type: 'boolean' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 when type is missing', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my-flag', description: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 for key with uppercase letters', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'My-Flag', description: 'Test', type: 'boolean' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key must only contain/i);
  });

  it('returns 400 for key with spaces', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my flag', description: 'Test', type: 'boolean' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key must only contain/i);
  });

  it('returns 400 for key with special characters', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my_flag!', description: 'Test', type: 'boolean' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key must only contain/i);
  });

  it('returns 400 when key exceeds 60 characters', async () => {
    const { app } = makeApp();
    const longKey = 'a'.repeat(61);
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: longKey, description: 'Test', type: 'boolean' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/60 characters/i);
  });

  it('accepts key of exactly 60 characters', async () => {
    const { app } = makeApp();
    const key = 'a'.repeat(60);
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key, description: 'Test', type: 'boolean' });
    expect(res.status).toBe(201);
  });

  it('returns 400 when description exceeds 200 characters', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my-flag', description: 'x'.repeat(201), type: 'boolean' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200 characters/i);
  });

  it('returns 400 for invalid type', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my-flag', description: 'Test', type: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type must be one of/i);
  });

  it('returns 409 when flag already exists', async () => {
    const { app } = makeApp({
      createFlag: jest.fn().mockRejectedValue(new Error("Flag 'my-flag' already exists")),
    });
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my-flag', description: 'Test', type: 'boolean' });
    expect(res.status).toBe(409);
  });

  it('returns 201 for valid request', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'my-flag', description: 'Test', type: 'boolean' });
    expect(res.status).toBe(201);
    expect(res.body.flag).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PUT /api/feature-flags/:key
// ---------------------------------------------------------------------------

describe('PUT /api/feature-flags/:key', () => {
  it('returns 400 when description exceeds 200 characters', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put('/api/feature-flags/my-flag')
      .send({ description: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200 characters/i);
  });

  it('returns 404 when flag not found', async () => {
    const { app } = makeApp({
      updateFlag: jest.fn().mockRejectedValue(new Error("Flag 'missing' not found")),
    });
    const res = await request(app)
      .put('/api/feature-flags/missing')
      .send({ description: 'Updated' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/feature-flags/:key
// ---------------------------------------------------------------------------

describe('GET /api/feature-flags/:key', () => {
  it('returns 404 when flag not found', async () => {
    const { app } = makeApp({ getFlag: jest.fn().mockResolvedValue(null) });
    const res = await request(app).get('/api/feature-flags/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 with the flag when found', async () => {
    const flag = {
      key: 'my-flag',
      description: 'Test',
      type: 'boolean',
      enabled: true,
      defaultValue: false,
      archived: false,
    };
    const { app } = makeApp({ getFlag: jest.fn().mockResolvedValue(flag) });
    const res = await request(app).get('/api/feature-flags/my-flag');
    expect(res.status).toBe(200);
    expect(res.body.flag.key).toBe('my-flag');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/feature-flags/:key/toggle
// ---------------------------------------------------------------------------

describe('PATCH /api/feature-flags/:key/toggle', () => {
  it('returns 404 when flag not found', async () => {
    const { app } = makeApp({
      toggleFlag: jest.fn().mockRejectedValue(new Error("Flag 'missing' not found")),
    });
    const res = await request(app).patch('/api/feature-flags/missing/toggle');
    expect(res.status).toBe(404);
  });

  it('returns the new enabled state', async () => {
    const { app } = makeApp({
      toggleFlag: jest.fn().mockResolvedValue({ key: 'my-flag', enabled: true }),
    });
    const res = await request(app).patch('/api/feature-flags/my-flag/toggle');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/feature-flags/:key/archive
// ---------------------------------------------------------------------------

describe('PATCH /api/feature-flags/:key/archive', () => {
  it('returns 404 when flag not found', async () => {
    const { app } = makeApp({
      archiveFlag: jest.fn().mockRejectedValue(new Error("Flag 'missing' not found")),
    });
    const res = await request(app).patch('/api/feature-flags/missing/archive');
    expect(res.status).toBe(404);
  });

  it('returns success message', async () => {
    const { app } = makeApp();
    const res = await request(app).patch('/api/feature-flags/my-flag/archive');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/feature-flags/:key
// ---------------------------------------------------------------------------

describe('DELETE /api/feature-flags/:key', () => {
  it('returns 404 when flag not found', async () => {
    const { app } = makeApp({
      deleteFlag: jest.fn().mockRejectedValue(new Error("Flag 'missing' not found")),
    });
    const res = await request(app).delete('/api/feature-flags/missing');
    expect(res.status).toBe(404);
  });

  it('returns success message', async () => {
    const { app } = makeApp();
    const res = await request(app).delete('/api/feature-flags/my-flag');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/feature-flags/:key/audit
// ---------------------------------------------------------------------------

describe('GET /api/feature-flags/:key/audit', () => {
  it('returns 200 with audit entries', async () => {
    const entries = [
      { flagKey: 'my-flag', action: 'created', timestamp: new Date() },
      { flagKey: 'my-flag', action: 'toggled', timestamp: new Date() },
    ];
    const { app } = makeApp({ getAuditLog: jest.fn().mockResolvedValue(entries) });
    const res = await request(app).get('/api/feature-flags/my-flag/audit');

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('returns 200 with empty entries when no history', async () => {
    const { app } = makeApp({ getAuditLog: jest.fn().mockResolvedValue([]) });
    const res = await request(app).get('/api/feature-flags/my-flag/audit');

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('returns 500 on service error', async () => {
    const { app } = makeApp({
      getAuditLog: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
    });
    const res = await request(app).get('/api/feature-flags/my-flag/audit');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/audit log/i);
  });
});

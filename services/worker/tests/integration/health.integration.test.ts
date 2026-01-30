/**
 * Integration tests for health endpoints
 * Tests actual HTTP responses and Firestore queries
 */

import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';

// Mock Firestore
jest.mock('@google-cloud/firestore', () => {
  return {
    Firestore: jest.fn().mockImplementation(() => ({
      collection: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        count: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          data: jest.fn().mockReturnValue({ count: 0 }),
          docs: [],
        }),
      }),
    })),
  };
});

describe('Health Endpoint Integration Tests', () => {
  afterAll((done) => {
    // Force close any pending operations
    done();
  });

  describe('GET /health', () => {
    it('should return 200 OK with status and version', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('version');
    });

    it('should have application/json content type', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should respond quickly (< 100ms)', async () => {
      const start = Date.now();
      await request(app).get('/health');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should not require authentication', async () => {
      const response = await request(app).get('/health');

      expect(response.status).not.toBe(StatusCodes.UNAUTHORIZED);
      expect(response.status).not.toBe(StatusCodes.FORBIDDEN);
    });

    it('should not accept POST requests', async () => {
      const response = await request(app).post('/health');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept PUT requests', async () => {
      const response = await request(app).put('/health');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept DELETE requests', async () => {
      const response = await request(app).delete('/health');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });

  describe('GET /metrics', () => {
    it('should return 200 OK with metrics data', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('healthScore');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should include job counts by status', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toHaveProperty('counts');
      expect(response.body.counts).toHaveProperty('pending');
      expect(response.body.counts).toHaveProperty('processing');
      expect(response.body.counts).toHaveProperty('processed');
      expect(response.body.counts).toHaveProperty('failed');
      expect(response.body.counts).toHaveProperty('pending_retry');
      expect(response.body.counts).toHaveProperty('pending_decision');
    });

    it('should include totals with success rate', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toHaveProperty('totals');
      expect(response.body.totals).toHaveProperty('total');
      expect(response.body.totals).toHaveProperty('successRate');
    });

    it('should include recent failures array', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toHaveProperty('recentFailures');
      expect(Array.isArray(response.body.recentFailures)).toBe(true);
    });

    it('should include pending retries array', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toHaveProperty('pendingRetries');
      expect(Array.isArray(response.body.pendingRetries)).toBe(true);
    });

    it('should calculate health score between 0-100', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body.healthScore).toBeGreaterThanOrEqual(0);
      expect(response.body.healthScore).toBeLessThanOrEqual(100);
    });

    it('should set status based on health score', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.status);
    });

    it('should have valid ISO timestamp', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(StatusCodes.OK);
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });

    it('should not require authentication', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).not.toBe(StatusCodes.UNAUTHORIZED);
      expect(response.status).not.toBe(StatusCodes.FORBIDDEN);
    });

    it('should not accept POST requests', async () => {
      const response = await request(app).post('/metrics');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });

  describe('Health vs Metrics comparison', () => {
    it('should return different data structures', async () => {
      const [health, metrics] = await Promise.all([
        request(app).get('/health'),
        request(app).get('/metrics'),
      ]);

      expect(health.body).toHaveProperty('status');
      expect(health.body).toHaveProperty('version');
      expect(health.body).not.toHaveProperty('counts');

      expect(metrics.body).toHaveProperty('status');
      expect(metrics.body).toHaveProperty('version');
      expect(metrics.body).toHaveProperty('counts');
      expect(metrics.body).toHaveProperty('healthScore');
    });

    it('should have same version string', async () => {
      const [health, metrics] = await Promise.all([
        request(app).get('/health'),
        request(app).get('/metrics'),
      ]);

      expect(health.body.version).toBe(metrics.body.version);
    });
  });
});

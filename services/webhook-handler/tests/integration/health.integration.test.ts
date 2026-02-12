/**
 * Integration tests for health endpoint
 * Tests actual HTTP responses without mocking
 */

import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';

const REQUEST_TIMEOUT_MS = 5000;

describe('Health Endpoint Integration Tests', () => {
  afterAll((done) => {
    done();
  });

  describe('GET /health', () => {
    it('should return 200 OK and be accessible without authentication', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.status).not.toBe(StatusCodes.UNAUTHORIZED);
      expect(response.status).not.toBe(StatusCodes.FORBIDDEN);
    });

    it('should return valid health check response', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('service');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should have status "healthy"', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.body.status).toBe('healthy');
    });

    it('should have service name "webhook-handler"', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.body.service).toBe('webhook-handler');
    });

    it('should have numeric uptime', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should have ISO timestamp', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.body.timestamp).toBeDefined();
      // Validate ISO 8601 format
      const date = new Date(response.body.timestamp);
      expect(date.toISOString()).toBe(response.body.timestamp);
    });

    it('should have content-type application/json', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should respond quickly (< 100ms)', async () => {
      const start = Date.now();
      await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('Health endpoint availability', () => {
    it('should not require any headers', async () => {
      const response = await request(app).get('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.status).toBe(StatusCodes.OK);
    });

    it('should not accept POST requests', async () => {
      const response = await request(app).post('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept PUT requests', async () => {
      const response = await request(app).put('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept DELETE requests', async () => {
      const response = await request(app).delete('/health').timeout(REQUEST_TIMEOUT_MS);

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });
});

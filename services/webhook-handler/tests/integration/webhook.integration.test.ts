/**
 * Integration tests for webhook endpoint
 * Tests actual HTTP responses and request validation
 */

import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';

// Mock external services for integration tests
jest.mock('../../src/services/tasks.service');
jest.mock('../../src/services/approved-chats.service');
jest.mock('../../src/services/rate-limiter.service');

// Mock config to provide test values
jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({
    webhookSecretPath: 'test-secret-123',
    projectId: 'test-project',
    location: 'us-central1',
    queueName: 'test-queue',
    workerUrl: 'http://localhost:8081',
  })),
  loadConfig: jest.fn(),
}));

// Mock logger to avoid console noise in tests
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Webhook Endpoint Integration Tests', () => {
  afterAll((done) => {
    // Force close any pending operations
    done();
  });

  const VALID_SECRET = 'test-secret-123';
  const INVALID_SECRET = 'wrong-secret';

  // Sample Telegram update payloads
  const createTextMessage = (text: string) => ({
    update_id: 123456789,
    message: {
      message_id: 1,
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Test',
        username: 'testuser',
      },
      chat: {
        id: -1001234567890,
        type: 'supergroup',
        title: 'Test Group',
      },
      date: Math.floor(Date.now() / 1000),
      text: text,
    },
  });

  const createPhotoMessage = () => ({
    update_id: 123456790,
    message: {
      message_id: 2,
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Test',
        username: 'testuser',
      },
      chat: {
        id: -1001234567890,
        type: 'supergroup',
        title: 'Test Group',
      },
      date: Math.floor(Date.now() / 1000),
      photo: [
        {
          file_id: 'test-file-id-123',
          file_unique_id: 'unique-123',
          width: 1280,
          height: 720,
          file_size: 50000,
        },
      ],
    },
  });

  describe('POST /webhook/:secretPath', () => {
    describe('Secret path validation', () => {
      it('should return 404 for invalid secret path', async () => {
        const response = await request(app)
          .post(`/webhook/${INVALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
        expect(response.body).toHaveProperty('error');
      });

      it('should accept valid secret path', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.status).not.toBe(StatusCodes.NOT_FOUND);
      });

      it('should return 404 for missing secret path', async () => {
        const response = await request(app).post('/webhook/').send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });
    });

    describe('Request body validation', () => {
      it('should return 400 for empty body', async () => {
        const response = await request(app).post(`/webhook/${VALID_SECRET}`).send({});

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        expect(response.body.error).toMatch(/invalid update/i);
      });

      it('should return 400 for invalid JSON', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .set('Content-Type', 'application/json')
          .send('invalid json{');

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      });

      it('should return 400 for missing update_id', async () => {
        const invalidUpdate = {
          message: {
            message_id: 1,
            text: 'test',
          },
        };

        const response = await request(app).post(`/webhook/${VALID_SECRET}`).send(invalidUpdate);

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      });

      it('should accept valid text message update', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('Hello'));

        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should accept valid photo message update', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createPhotoMessage());

        expect(response.status).toBe(StatusCodes.OK);
      });
    });

    describe('Content-Type handling', () => {
      it('should accept application/json', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .set('Content-Type', 'application/json')
          .send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should have application/json response', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.headers['content-type']).toMatch(/application\/json/);
      });
    });

    describe('Message types handling', () => {
      it('should handle /invoice command', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('/invoice'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should handle /onboard command', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('/onboard'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should handle regular text messages', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('Hello world'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should handle photo messages', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createPhotoMessage());

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should ignore unknown commands', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('/unknowncommand'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('action', 'ignored_command');
      });
    });

    describe('HTTP method restrictions', () => {
      it('should not accept GET requests', async () => {
        const response = await request(app).get(`/webhook/${VALID_SECRET}`);

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });

      it('should not accept PUT requests', async () => {
        const response = await request(app)
          .put(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });

      it('should not accept DELETE requests', async () => {
        const response = await request(app).delete(`/webhook/${VALID_SECRET}`);

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });
    });

    describe('Response format', () => {
      it('should return ok: true for successful processing', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.body).toHaveProperty('ok');
        expect(typeof response.body.ok).toBe('boolean');
      });

      it('should include action in response', async () => {
        const response = await request(app)
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        if (response.status === StatusCodes.OK) {
          expect(response.body).toHaveProperty('action');
        }
      });
    });

    describe('Error responses', () => {
      it('should return error object for validation failures', async () => {
        const response = await request(app).post(`/webhook/${VALID_SECRET}`).send({});

        expect(response.body).toHaveProperty('error');
        expect(typeof response.body.error).toBe('string');
      });

      it('should return error object for wrong secret', async () => {
        const response = await request(app)
          .post(`/webhook/${INVALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.body).toHaveProperty('error');
      });
    });
  });

  describe('Endpoint not found', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should return 404 for /webhook without secret', async () => {
      const response = await request(app).post('/webhook').send(createTextMessage('test'));

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });
});

/**
 * Integration tests for webhook endpoint
 * Tests actual HTTP responses and request validation
 */

import request from 'supertest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';
import * as approval from '../../src/services/approved-chats.service';
import * as tasks from '../../src/services/tasks.service';
import logger from '../../src/logger';

let server: Server;
let baseUrl: string;

/** Avoid keep-alive socket pollution after malformed-body tests (supertest parse flakes). */
function http() {
  return {
    post: (path: string) => request(baseUrl).post(path).set('Connection', 'close'),
    get: (path: string) => request(baseUrl).get(path).set('Connection', 'close'),
    put: (path: string) => request(baseUrl).put(path).set('Connection', 'close'),
    delete: (path: string) => request(baseUrl).delete(path).set('Connection', 'close'),
  };
}

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
  beforeEach(() => {
    jest.clearAllMocks();
    (approval.isChatApproved as jest.Mock).mockResolvedValue(true);
    (approval.isInOnboarding as jest.Mock).mockResolvedValue(false);
    (tasks.enqueueProcessingTask as jest.Mock).mockResolvedValue('test-task');
    (tasks.enqueueOnboardingPhotoTask as jest.Mock).mockResolvedValue('test-onboarding-task');
  });
  beforeAll((done) => {
    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
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
        const response = await http()
          .post(`/webhook/${INVALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
        expect(response.body).toHaveProperty('error');
      });

      it('should accept valid secret path', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.status).not.toBe(StatusCodes.NOT_FOUND);
      });

      it('should return 404 for missing secret path', async () => {
        const response = await http().post('/webhook/').send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });
    });

    describe('Request body validation', () => {
      it('should return 400 for empty body', async () => {
        const response = await http().post(`/webhook/${VALID_SECRET}`).send({});

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        expect(response.body.error).toMatch(/invalid update/i);
      });

      it('should return 400 for invalid JSON', async () => {
        // Do not use supertest here — malformed bodies can poison keep-alive sockets
        // and cause flaky "Parse Error: Expected HTTP/" on following tests.
        const response = await fetch(`${baseUrl}/webhook/${VALID_SECRET}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Connection: 'close' },
          body: 'invalid json{',
        });
        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      });

      it('should return 400 for missing update_id', async () => {
        const invalidUpdate = {
          message: {
            message_id: 1,
            text: 'test',
          },
        };

        const response = await http().post(`/webhook/${VALID_SECRET}`).send(invalidUpdate);

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      });

      it('should accept valid text message update', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('Hello'));

        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should accept valid photo message update', async () => {
        const response = await http().post(`/webhook/${VALID_SECRET}`).send(createPhotoMessage());

        expect(response.status).toBe(StatusCodes.OK);
      });
    });

    describe('Content-Type handling', () => {
      it('should accept application/json', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .set('Content-Type', 'application/json')
          .send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should have application/json response', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.headers['content-type']).toMatch(/application\/json/);
      });
    });

    describe('Message types handling', () => {
      it('should handle /new command', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('/new'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should handle /onboard command', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('/onboard'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should handle regular text messages', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('Hello world'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should handle photo messages', async () => {
        const response = await http().post(`/webhook/${VALID_SECRET}`).send(createPhotoMessage());

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should ignore unknown commands', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('/unknowncommand'));

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('action', 'ignored_command');
      });
    });

    describe('HTTP method restrictions', () => {
      it('should not accept GET requests', async () => {
        const response = await http().get(`/webhook/${VALID_SECRET}`);

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });

      it('should not accept PUT requests', async () => {
        const response = await http()
          .put(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });

      it('should not accept DELETE requests', async () => {
        const response = await http().delete(`/webhook/${VALID_SECRET}`);

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });
    });

    describe('Response format', () => {
      it('should return ok: true for successful processing', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.body).toHaveProperty('ok');
        expect(typeof response.body.ok).toBe('boolean');
      });

      it('should include action in response', async () => {
        const response = await http()
          .post(`/webhook/${VALID_SECRET}`)
          .send(createTextMessage('test'));

        if (response.status === StatusCodes.OK) {
          expect(response.body).toHaveProperty('action');
        }
      });
    });

    describe('Error responses', () => {
      it('should return error object for validation failures', async () => {
        const response = await http().post(`/webhook/${VALID_SECRET}`).send({});

        expect(response.body).toHaveProperty('error');
        expect(typeof response.body.error).toBe('string');
      });

      it('should return error object for wrong secret', async () => {
        const response = await http()
          .post(`/webhook/${INVALID_SECRET}`)
          .send(createTextMessage('test'));

        expect(response.body).toHaveProperty('error');
      });
    });
  });

  describe('Upload approval', () => {
    const upload = (kind: 'photo' | 'document') => {
      const update = createPhotoMessage();
      return kind === 'photo'
        ? update
        : {
            ...update,
            message: {
              ...update.message,
              photo: undefined,
              document: {
                file_id: 'test-document',
                file_unique_id: 'unique-document',
                file_name: 'invoice.pdf',
                mime_type: 'application/pdf',
                file_size: 100,
              },
            },
          };
    };

    it.each(['photo', 'document'] as const)(
      'ignores %s from a chat that never redeemed an invite',
      async (kind) => {
        (approval.isChatApproved as jest.Mock).mockResolvedValue(false);
        const response = await http().post(`/webhook/${VALID_SECRET}`).send(upload(kind));
        expect(response.body).toEqual({ ok: true, action: 'ignored_upload_unapproved' });
        expect(tasks.enqueueProcessingTask).not.toHaveBeenCalled();
        expect(tasks.enqueueOnboardingPhotoTask).not.toHaveBeenCalled();
      }
    );

    it.each(['photo', 'document'] as const)('queues %s for an approved chat', async (kind) => {
      const response = await http().post(`/webhook/${VALID_SECRET}`).send(upload(kind));
      expect(response.status).toBe(200);
      expect(tasks.enqueueProcessingTask).toHaveBeenCalledTimes(1);
    });

    it('keeps approved onboarding logo uploads on their separate queue path', async () => {
      (approval.isInOnboarding as jest.Mock).mockResolvedValue(true);
      const response = await http().post(`/webhook/${VALID_SECRET}`).send(upload('photo'));
      expect(response.body.action).toBe('onboarding_photo_enqueued');
      expect(tasks.enqueueOnboardingPhotoTask).toHaveBeenCalledTimes(1);
      expect(tasks.enqueueProcessingTask).not.toHaveBeenCalled();
    });

    it('does not bypass approval for a stale onboarding session', async () => {
      (approval.isChatApproved as jest.Mock).mockResolvedValue(false);
      (approval.isInOnboarding as jest.Mock).mockResolvedValue(true);
      await http().post(`/webhook/${VALID_SECRET}`).send(upload('photo'));
      expect(tasks.enqueueOnboardingPhotoTask).not.toHaveBeenCalled();
    });

    it('also rejects unapproved channel photo posts', async () => {
      (approval.isChatApproved as jest.Mock).mockResolvedValue(false);
      const { message, ...update } = createPhotoMessage();
      const response = await http()
        .post(`/webhook/${VALID_SECRET}`)
        .send({ ...update, channel_post: message });
      expect(response.body.action).toBe('ignored_upload_unapproved');
      expect(tasks.enqueueProcessingTask).not.toHaveBeenCalled();
    });
  });

  describe('Secret-safe logging', () => {
    const logged = () =>
      JSON.stringify([
        (logger.info as jest.Mock).mock.calls,
        (logger.warn as jest.Mock).mock.calls,
        (logger.error as jest.Mock).mock.calls,
        (logger.debug as jest.Mock).mock.calls,
      ]);

    it('logs the route pattern without the actual webhook secret or query string', async () => {
      await http()
        .post(`/webhook/${VALID_SECRET}?token=query-secret`)
        .send(createTextMessage('message-secret'));
      expect(logged()).toContain('/webhook/:secretPath');
      expect(logged()).not.toContain(VALID_SECRET);
      expect(logged()).not.toContain('query-secret');
      expect(logged()).not.toContain('message-secret');
    });

    it('does not echo an unknown credential-bearing path into request logs', async () => {
      await http().get('/webhook/unknown-secret/extra?token=query-secret');
      expect(logged()).toContain('[unmatched]');
      expect(logged()).not.toContain('unknown-secret');
      expect(logged()).not.toContain('query-secret');
    });

    it('does not log malformed JSON bodies containing secrets', async () => {
      await http()
        .post(`/webhook/${VALID_SECRET}`)
        .set('Content-Type', 'application/json')
        .send('{"token":"body-secret",');
      expect(logged()).not.toContain('body-secret');
    });
  });

  describe('Endpoint not found', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await http().get('/unknown');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should return 404 for /webhook without secret', async () => {
      const response = await http().post('/webhook').send(createTextMessage('test'));

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });
});

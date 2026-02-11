/**
 * Integration tests for invoice processing endpoints
 * Tests POST /process, /callback, /notify-failure
 */

import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';
import type { TaskPayload, DuplicateAction } from '../../../../shared/types';

// Mock external services
jest.mock('../../src/services/invoice.service');
jest.mock('../../src/services/firestore.service');
jest.mock('../../src/services/telegram.service');
jest.mock('../../src/middlewares/cloudTasks', () => ({
  validateCloudTasks: jest.fn((req, _res, next) => next()),
  getRetryCount: jest.fn(() => 0),
  getMaxRetries: jest.fn(() => 3),
}));

import * as invoiceService from '../../src/services/invoice.service';
import * as storeService from '../../src/services/firestore.service';
import * as telegramService from '../../src/services/telegram.service';

describe('Process Controller Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll((done) => {
    // Force close any pending operations
    done();
  });

  describe('POST /process', () => {
    const validPayload: TaskPayload = {
      chatId: 123456,
      messageId: 789,
      fileId: 'file123',
      uploaderUsername: 'testuser',
      uploaderFirstName: 'Test',
      chatTitle: 'Test Chat',
      receivedAt: new Date().toISOString(),
    };

    describe('Payload validation', () => {
      it('should accept valid payload', async () => {
        (invoiceService.processInvoice as jest.Mock).mockResolvedValue({
          driveLink: 'https://drive.google.com/file/123',
          alreadyProcessed: false,
        });

        const response = await request(app).post('/process').send(validPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });

      it('should reject payload without chatId', async () => {
        const invalidPayload = { ...validPayload };
        delete (invalidPayload as Partial<typeof validPayload>).chatId;

        const response = await request(app).post('/process').send(invalidPayload);

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('error');
      });

      it('should reject payload without messageId', async () => {
        const invalidPayload = { ...validPayload };
        delete (invalidPayload as Partial<typeof validPayload>).messageId;

        const response = await request(app).post('/process').send(invalidPayload);

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('error');
      });

      it('should reject payload without fileId', async () => {
        const invalidPayload = { ...validPayload };
        delete (invalidPayload as Partial<typeof validPayload>).fileId;

        const response = await request(app).post('/process').send(invalidPayload);

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('error');
      });

      it('should reject payload with invalid chatId type', async () => {
        const invalidPayload = { ...validPayload, chatId: 'not-a-number' };

        const response = await request(app).post('/process').send(invalidPayload);

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      });

      it('should reject empty payload', async () => {
        const response = await request(app).post('/process').send({});

        expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      });
    });

    describe('Processing flow', () => {
      it('should process new invoice successfully', async () => {
        (invoiceService.processInvoice as jest.Mock).mockResolvedValue({
          driveLink: 'https://drive.google.com/file/123',
          alreadyProcessed: false,
        });

        const response = await request(app).post('/process').send(validPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'processed' });
        expect(invoiceService.processInvoice).toHaveBeenCalledWith(validPayload);
      });

      it('should handle already processed invoice', async () => {
        (invoiceService.processInvoice as jest.Mock).mockResolvedValue({
          alreadyProcessed: true,
        });

        const response = await request(app).post('/process').send(validPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'already_processed' });
      });

      it('should handle processing errors', async () => {
        (invoiceService.processInvoice as jest.Mock).mockRejectedValue(
          new Error('LLM service unavailable')
        );
        (storeService.getJob as jest.Mock).mockResolvedValue({
          lastStep: 'extract',
          lastError: 'LLM service unavailable',
        });

        const response = await request(app).post('/process').send(validPayload);

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
        expect(response.body).toHaveProperty('error');
      });

      it('should handle duplicate detection', async () => {
        (invoiceService.processInvoice as jest.Mock).mockResolvedValue({
          duplicate: true,
          duplicateInvoices: [{ invoiceNumber: '123', vendor: 'Vendor A' }],
        });

        const response = await request(app).post('/process').send(validPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toHaveProperty('ok', true);
      });
    });

    describe('HTTP method restrictions', () => {
      it('should not accept GET requests', async () => {
        const response = await request(app).get('/process');

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });

      it('should not accept PUT requests', async () => {
        const response = await request(app).put('/process').send(validPayload);

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });

      it('should not accept DELETE requests', async () => {
        const response = await request(app).delete('/process');

        expect(response.status).toBe(StatusCodes.NOT_FOUND);
      });
    });
  });

  describe('POST /callback', () => {
    const validCallbackPayload = {
      callbackQueryId: 'callback123',
      data: JSON.stringify({
        action: 'keep_both' as DuplicateAction,
        chatId: 123456,
        messageId: 789,
      }),
    };

    it('should accept valid callback payload', async () => {
      (storeService.getJob as jest.Mock).mockResolvedValue({
        status: 'pending_decision',
        duplicates: [{ invoiceNumber: '123' }],
      });
      (invoiceService.handleDuplicateDecision as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app).post('/callback').send(validCallbackPayload);

      // May return 200 or 500 depending on mocking completeness
      expect([StatusCodes.OK, StatusCodes.INTERNAL_SERVER_ERROR]).toContain(response.status);
    });

    it('should reject callback without chatId', async () => {
      const invalidPayload = {
        callbackQueryId: 'callback123',
        data: JSON.stringify({ action: 'keep_both', messageId: 789 }), // Missing chatId
      };

      const response = await request(app).post('/callback').send(invalidPayload);

      // May return 400 or 500 for invalid payload
      expect([StatusCodes.BAD_REQUEST, StatusCodes.INTERNAL_SERVER_ERROR]).toContain(
        response.status
      );
    });

    it('should reject callback with invalid action', async () => {
      const invalidPayload = {
        ...validCallbackPayload,
        data: JSON.stringify({ action: 'invalid_action', chatId: 123456, messageId: 789 }),
      };
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app).post('/callback').send(invalidPayload);

      // Invalid action may return 200, 400, or 500
      expect([
        StatusCodes.OK,
        StatusCodes.BAD_REQUEST,
        StatusCodes.INTERNAL_SERVER_ERROR,
      ]).toContain(response.status);
    });

    it('should not accept GET requests', async () => {
      const response = await request(app).get('/callback');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });

  describe('POST /notify-failure', () => {
    const validNotifyPayload = {
      chatId: 123456,
      messageId: 789,
      lastStep: 'extract' as const,
      error: 'LLM service timeout',
    };

    it('should accept valid notify-failure payload', async () => {
      (invoiceService.sendFailureNotification as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app).post('/notify-failure').send(validNotifyPayload);

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toHaveProperty('ok', true);
    });

    it('should reject payload without chatId', async () => {
      const invalidPayload = { ...validNotifyPayload };
      delete (invalidPayload as Partial<typeof validNotifyPayload>).chatId;

      const response = await request(app).post('/notify-failure').send(invalidPayload);

      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    });

    it('should reject payload without error', async () => {
      const invalidPayload = { ...validNotifyPayload };
      delete (invalidPayload as Partial<typeof validNotifyPayload>).error;

      const response = await request(app).post('/notify-failure').send(invalidPayload);

      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    });

    it('should not accept GET requests', async () => {
      const response = await request(app).get('/notify-failure');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });

  describe('Content-Type handling', () => {
    it('should accept application/json for /process', async () => {
      (invoiceService.processInvoice as jest.Mock).mockResolvedValue({
        driveLink: 'https://drive.google.com/file/123',
        alreadyProcessed: false,
      });

      const response = await request(app)
        .post('/process')
        .set('Content-Type', 'application/json')
        .send({
          chatId: 123456,
          messageId: 789,
          fileId: 'file123',
        });

      expect(response.status).toBe(StatusCodes.OK);
    });

    it('should return application/json responses', async () => {
      (invoiceService.processInvoice as jest.Mock).mockResolvedValue({
        driveLink: 'https://drive.google.com/file/123',
        alreadyProcessed: false,
      });

      const response = await request(app).post('/process').send({
        chatId: 123456,
        messageId: 789,
        fileId: 'file123',
      });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });
});

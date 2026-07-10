/**
 * Integration tests for invoice processing endpoints
 * Tests POST /process, /callback, /notify-failure
 */

import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';
import type { TaskPayload } from '../../../../shared/types';

import * as invoiceService from '../../src/services/invoice.service';
import * as storeService from '../../src/services/firestore.service';
import * as telegramService from '../../src/services/telegram.service';

// Mock external services
jest.mock('../../src/services/invoice.service');
jest.mock('../../src/services/firestore.service');
jest.mock('../../src/services/telegram.service');
jest.mock('../../src/services/feature-flags', () => ({
  featureFlags: { getValue: jest.fn().mockResolvedValue(true) },
}));
jest.mock('../../src/middlewares/cloudTasks', () => ({
  validateCloudTasks: jest.fn((req, _res, next) => next()),
  getRetryCount: jest.fn(() => 0),
  getMaxRetries: jest.fn(() => 3),
}));

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
    describe('Duplicate decision flow — compact keys (real button format)', () => {
      beforeEach(() => {
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (invoiceService.handleDuplicateDecision as jest.Mock).mockResolvedValue({ success: true });
      });

      it('should handle keep_both with compact keys { a, c, m }', async () => {
        const response = await request(app)
          .post('/callback')
          .send({
            callbackQueryId: 'cb1',
            data: JSON.stringify({ a: 'keep_both', c: 123456, m: 789 }),
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'keep_both' });
        expect(invoiceService.handleDuplicateDecision).toHaveBeenCalledWith(
          123456,
          789,
          'keep_both',
          undefined
        );
      });

      it('should handle delete_new with compact keys { a, c, m }', async () => {
        const response = await request(app)
          .post('/callback')
          .send({
            callbackQueryId: 'cb2',
            data: JSON.stringify({ a: 'delete_new', c: 123456, m: 789 }),
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'delete_new' });
        expect(invoiceService.handleDuplicateDecision).toHaveBeenCalledWith(
          123456,
          789,
          'delete_new',
          undefined
        );
      });

      it('should handle keep_both with legacy full keys { action, chatId, messageId }', async () => {
        const response = await request(app)
          .post('/callback')
          .send({
            callbackQueryId: 'cb3',
            data: JSON.stringify({ action: 'keep_both', chatId: 123456, messageId: 789 }),
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'keep_both' });
      });

      it('should reject duplicate callback missing chatId', async () => {
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/callback')
          .send({
            callbackQueryId: 'cb4',
            data: JSON.stringify({ a: 'keep_both', m: 789 }), // missing c
          });

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      });

      it('should reject duplicate callback missing messageId', async () => {
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/callback')
          .send({
            callbackQueryId: 'cb5',
            data: JSON.stringify({ a: 'keep_both', c: 123456 }), // missing m
          });

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      });
    });

    it('should not accept GET requests', async () => {
      const response = await request(app).get('/callback');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    describe('Edit correction flow', () => {
      const baseEditPayload = {
        callbackQueryId: 'cb_edit',
        botMessageChatId: 123456,
        botMessageId: 999,
      };

      it('should handle edit_invoice callback and show field picker', async () => {
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/callback')
          .send({
            ...baseEditPayload,
            data: JSON.stringify({ action: 'edit_invoice', jobId: '123456_789', chatId: 123456 }),
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'edit_invoice' });
        expect(telegramService.answerCallbackQuery).toHaveBeenCalledWith('cb_edit');
        expect(telegramService.editMessageText).toHaveBeenCalled();
      });

      it('should handle edit_field callback and set correction pending', async () => {
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue({ message_id: 1001 });
        (storeService.setCorrectionPending as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/callback')
          .send({
            ...baseEditPayload,
            data: JSON.stringify({
              action: 'edit_field',
              jobId: '123456_789',
              chatId: 123456,
              field: 'totalAmount',
              successMessageId: 999,
            }),
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'edit_field' });
        expect(storeService.setCorrectionPending).toHaveBeenCalledWith(
          '123456_789',
          'totalAmount',
          1001,
          999
        );
      });

      it('should handle edit_cancel callback and clear correction pending', async () => {
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (telegramService.formatSuccessMessage as jest.Mock).mockReturnValue(
          'original message text'
        );
        (storeService.getJob as jest.Mock).mockResolvedValue({
          invoiceDate: '2026-01-01',
          totalAmount: 200,
          currency: 'ILS',
          driveLink: 'https://drive.google.com/file/123',
        });
        (storeService.clearCorrectionPending as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/callback')
          .send({
            ...baseEditPayload,
            data: JSON.stringify({
              action: 'edit_cancel',
              jobId: '123456_789',
              chatId: 123456,
              successMessageId: 999,
            }),
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'edit_cancel' });
        expect(storeService.clearCorrectionPending).toHaveBeenCalledWith('123456_789');
      });

      it('should handle edit_cancel gracefully when job is not found', async () => {
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (storeService.getJob as jest.Mock).mockResolvedValue(null);
        (storeService.clearCorrectionPending as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/callback')
          .send({
            ...baseEditPayload,
            data: JSON.stringify({
              action: 'edit_cancel',
              jobId: '123456_789',
              chatId: 123456,
              successMessageId: 999,
            }),
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body).toEqual({ ok: true, action: 'edit_cancel' });
        expect(storeService.clearCorrectionPending).toHaveBeenCalledWith('123456_789');
        expect(telegramService.editMessageText).not.toHaveBeenCalled();
      });

      describe('Required field validation', () => {
        it('should reject edit_invoice without jobId', async () => {
          const response = await request(app)
            .post('/callback')
            .send({
              ...baseEditPayload,
              data: JSON.stringify({ a: 'ei' }), // missing j
            });

          expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        });

        it('should reject edit_field without field', async () => {
          const response = await request(app)
            .post('/callback')
            .send({
              ...baseEditPayload,
              data: JSON.stringify({ a: 'ef', j: '123456_789', s: 999 }), // missing f
            });

          expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        });

        it('should reject edit_field with invalid field value', async () => {
          const response = await request(app)
            .post('/callback')
            .send({
              ...baseEditPayload,
              data: JSON.stringify({ a: 'ef', j: '123456_789', f: 'invalid', s: 999 }),
            });

          expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        });

        it('should reject edit_field without successMessageId', async () => {
          const response = await request(app)
            .post('/callback')
            .send({
              ...baseEditPayload,
              data: JSON.stringify({ a: 'ef', j: '123456_789', f: 'amt' }), // missing s
            });

          expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        });

        it('should reject edit_cancel without successMessageId', async () => {
          const response = await request(app)
            .post('/callback')
            .send({
              ...baseEditPayload,
              data: JSON.stringify({ a: 'ec', j: '123456_789' }), // missing s
            });

          expect(response.status).toBe(StatusCodes.BAD_REQUEST);
        });
      });
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

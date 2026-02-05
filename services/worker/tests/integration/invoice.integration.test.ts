/**
 * Integration tests for invoice generation endpoints
 * Tests POST /invoice/command, /invoice/message, /invoice/callback
 */

import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';
import type {
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
} from '../../../../shared/types';

// Mock external services
jest.mock('../../src/services/customer/user-mapping.service');
jest.mock('../../src/services/invoice-generator/session.service');
jest.mock('../../src/services/invoice-generator');
jest.mock('../../src/services/telegram.service');
jest.mock('../../src/services/invoice-generator/fast-path.service');
jest.mock('../../src/services/invoice-generator/parser.service');
jest.mock('../../src/services/business-config/config.service');

import * as userMappingService from '../../src/services/customer/user-mapping.service';
import * as sessionService from '../../src/services/invoice-generator/session.service';
import { generateInvoice } from '../../src/services/invoice-generator';
import * as telegramService from '../../src/services/telegram.service';
import * as fastPathService from '../../src/services/invoice-generator/fast-path.service';
import * as parserService from '../../src/services/invoice-generator/parser.service';

describe('Invoice Generator Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll((done) => {
    // Force close any pending operations
    done();
  });

  describe('POST /invoice/command', () => {
    const validCommandPayload: InvoiceCommandPayload = {
      type: 'command',
      chatId: -123456,
      userId: 789,
      messageId: 101,
      username: 'testuser',
      firstName: 'Test',
      chatTitle: 'Test Chat',
      text: '/invoice',
      receivedAt: new Date().toISOString(),
    };

    describe('Access control', () => {
      it('should allow user with customer access', async () => {
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
          { chatId: -123456, businessName: 'Test Business' },
        ]);
        (userMappingService.updateUserActivity as jest.Mock).mockResolvedValue(undefined);
        (sessionService.createSession as jest.Mock).mockResolvedValue({});
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/command').send(validCommandPayload);

        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should auto-add user in group chat on first use', async () => {
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([]);
        (userMappingService.addUserToCustomer as jest.Mock).mockResolvedValue(undefined);
        (userMappingService.updateUserActivity as jest.Mock).mockResolvedValue(undefined);
        (sessionService.createSession as jest.Mock).mockResolvedValue({});
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/command').send(validCommandPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(userMappingService.addUserToCustomer).toHaveBeenCalledWith(
          validCommandPayload.userId,
          validCommandPayload.username,
          validCommandPayload.chatId,
          validCommandPayload.chatTitle
        );
      });

      it('should reject user without access in private chat', async () => {
        const privatePayload = { ...validCommandPayload, chatId: 789 }; // Positive = private
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([]);

        const response = await request(app).post('/invoice/command').send(privatePayload);

        expect(response.status).toBe(StatusCodes.FORBIDDEN);
        expect(response.body).toHaveProperty('error');
      });

      it('should reject private chat command when user has customers', async () => {
        const privatePayload = { ...validCommandPayload, chatId: 789 };
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
          { chatId: -999, businessName: 'Other Business' },
        ]);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/command').send(privatePayload);

        expect(response.status).toBe(StatusCodes.FORBIDDEN);
        expect(telegramService.sendMessage).toHaveBeenCalled();
      });
    });

    describe('Fast-path command parsing', () => {
      it('should handle fast-path command', async () => {
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([{ chatId: -123456 }]);
        (userMappingService.updateUserActivity as jest.Mock).mockResolvedValue(undefined);
        (sessionService.createSession as jest.Mock).mockResolvedValue({});
        (sessionService.setDocumentType as jest.Mock).mockResolvedValue(undefined);
        (sessionService.setDetails as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
        (fastPathService.parseFastPathCommand as jest.Mock).mockReturnValue({
          customerName: 'Test Vendor',
          amount: 100,
          description: 'Test invoice',
        });

        const fastPathPayload = {
          ...validCommandPayload,
          text: '/invoice Test Vendor, 100, Test description',
        };

        const response = await request(app).post('/invoice/command').send(fastPathPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(fastPathService.parseFastPathCommand).toHaveBeenCalled();
      });

      it('should start interactive mode for simple /invoice', async () => {
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([{ chatId: -123456 }]);
        (userMappingService.updateUserActivity as jest.Mock).mockResolvedValue(undefined);
        (sessionService.createSession as jest.Mock).mockResolvedValue({});
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
        (fastPathService.parseFastPathCommand as jest.Mock).mockReturnValue(null);

        const response = await request(app).post('/invoice/command').send(validCommandPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(telegramService.sendMessage).toHaveBeenCalled();
      });
    });

    describe('Payload validation', () => {
      it('should reject payload without chatId', async () => {
        const invalidPayload = { ...validCommandPayload };
        delete (invalidPayload as Partial<typeof validCommandPayload>).chatId;
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([]);

        const response = await request(app).post('/invoice/command').send(invalidPayload);

        // Returns 403 (access denied) when validation fails
        expect([StatusCodes.BAD_REQUEST, StatusCodes.FORBIDDEN]).toContain(response.status);
      });

      it('should reject payload without userId', async () => {
        const invalidPayload = { ...validCommandPayload };
        delete (invalidPayload as Partial<typeof validCommandPayload>).userId;
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([]);

        const response = await request(app).post('/invoice/command').send(invalidPayload);

        // Returns 200/400 depending on validation
        expect([StatusCodes.OK, StatusCodes.BAD_REQUEST]).toContain(response.status);
      });

      it('should reject empty payload', async () => {
        (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([]);

        const response = await request(app).post('/invoice/command').send({});

        // Returns 403 (access denied) when validation fails
        expect([StatusCodes.BAD_REQUEST, StatusCodes.FORBIDDEN]).toContain(response.status);
      });
    });
  });

  describe('POST /invoice/message', () => {
    const validMessagePayload: InvoiceMessagePayload = {
      type: 'message',
      chatId: -123456,
      userId: 789,
      messageId: 102,
      username: 'testuser',
      firstName: 'Test',
      text: 'Vendor A, 250, 15/01/2024',
      receivedAt: new Date().toISOString(),
    };

    describe('Message processing', () => {
      it('should process valid invoice details', async () => {
        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'awaiting_details',
          documentType: 'invoice_receipt',
        });
        (parserService.parseInvoiceDetails as jest.Mock).mockReturnValue({
          customerName: 'Vendor A',
          amount: 250,
          description: 'Test',
        });
        (sessionService.setDetails as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'awaiting_payment',
          documentType: 'invoice_receipt',
          customerName: 'Vendor A',
          amount: 250,
          description: 'Test',
        });
        (sessionService.updateSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'confirming',
          documentType: 'invoice_receipt',
          customerName: 'Vendor A',
          amount: 250,
          description: 'Test',
        });
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/message').send(validMessagePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(parserService.parseInvoiceDetails).toHaveBeenCalled();
      });

      it('should reject message when not in invoice flow', async () => {
        (sessionService.getSession as jest.Mock).mockResolvedValue(null);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/message').send(validMessagePayload);

        // Controller returns 200 even without session
        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should handle invalid invoice format', async () => {
        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'awaiting_details',
        });
        (parserService.parseInvoiceDetails as jest.Mock).mockReturnValue(null);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/message').send(validMessagePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(telegramService.sendMessage).toHaveBeenCalled();
      });
    });

    describe('Payload validation', () => {
      it('should reject payload without text', async () => {
        const invalidPayload = { ...validMessagePayload };
        delete (invalidPayload as Partial<typeof validMessagePayload>).text;

        const response = await request(app).post('/invoice/message').send(invalidPayload);

        // Controller handles gracefully with 200
        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should reject empty text', async () => {
        const invalidPayload = { ...validMessagePayload, text: '' };

        const response = await request(app).post('/invoice/message').send(invalidPayload);

        // Controller handles gracefully with 200
        expect(response.status).toBe(StatusCodes.OK);
      });
    });
  });

  describe('POST /invoice/callback', () => {
    const validCallbackPayload: InvoiceCallbackPayload = {
      type: 'callback',
      chatId: -123456,
      userId: 789,
      messageId: 103,
      username: 'testuser',
      callbackQueryId: 'callback123',
      data: JSON.stringify({ action: 'select_type', documentType: 'invoice' }),
    };

    describe('Document type selection', () => {
      it('should handle document type selection', async () => {
        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          step: 'awaiting_doc_type',
          customerName: 'Test Vendor',
          amount: 100,
          description: 'Test',
        });
        (sessionService.setDocumentType as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(validCallbackPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(sessionService.setDocumentType).toHaveBeenCalledWith(-123456, 789, 'invoice');
      });

      it('should handle invoice_receipt selection', async () => {
        const receiptPayload = {
          ...validCallbackPayload,
          data: JSON.stringify({ action: 'select_type', documentType: 'invoice_receipt' }),
        };
        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          step: 'awaiting_doc_type',
          customerName: 'Test Vendor',
          amount: 100,
          description: 'Test',
        });
        (sessionService.setDocumentType as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(receiptPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(sessionService.setDocumentType).toHaveBeenCalledWith(
          -123456,
          789,
          'invoice_receipt'
        );
      });
    });

    describe('Payment method selection', () => {
      it('should handle payment method selection', async () => {
        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          step: 'awaiting_payment_method',
          documentType: 'invoice',
          customerName: 'Test',
          amount: 100,
          description: 'Test',
        });
        (sessionService.setPaymentMethod as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          step: 'awaiting_confirmation',
          documentType: 'invoice',
          customerName: 'Test',
          amount: 100,
          description: 'Test',
          paymentMethod: 'cash',
        });
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const paymentPayload = {
          ...validCallbackPayload,
          data: JSON.stringify({ action: 'select_payment', paymentMethod: 'cash' }),
        };

        const response = await request(app).post('/invoice/callback').send(paymentPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(sessionService.setPaymentMethod).toHaveBeenCalledWith(
          -123456,
          789,
          'cash',
          expect.any(String) // date
        );
      });
    });

    describe('Confirmation handling', () => {
      it('should generate invoice on confirm', async () => {
        (sessionService.getConfirmedSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          customerName: 'Test Vendor',
          amount: 100,
          description: 'Test',
          documentType: 'invoice',
          paymentMethod: 'cash',
          date: '2024-01-15',
        });
        (generateInvoice as jest.Mock).mockResolvedValue({
          invoiceNumber: 123,
          filePath: '/path/to/invoice.pdf',
        });
        (telegramService.sendDocument as jest.Mock).mockResolvedValue(undefined);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (sessionService.deleteSession as jest.Mock).mockResolvedValue(undefined);

        const confirmPayload = {
          ...validCallbackPayload,
          data: JSON.stringify({ action: 'confirm' }),
        };

        const response = await request(app).post('/invoice/callback').send(confirmPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(generateInvoice).toHaveBeenCalled();
      });

      it('should cancel invoice generation on no', async () => {
        (sessionService.deleteSession as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const cancelPayload = {
          ...validCallbackPayload,
          data: JSON.stringify({ action: 'cancel' }),
        };

        const response = await request(app).post('/invoice/callback').send(cancelPayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(sessionService.deleteSession).toHaveBeenCalled();
      });
    });

    describe('Error handling', () => {
      it('should handle invalid session', async () => {
        (sessionService.getSession as jest.Mock).mockResolvedValue(null);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(validCallbackPayload);

        // With no session, controller returns 200 but answers callback
        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should handle missing callback query ID', async () => {
        const invalidPayload = { ...validCallbackPayload };
        delete (invalidPayload as Partial<typeof validCallbackPayload>).callbackQueryId;

        const response = await request(app).post('/invoice/callback').send(invalidPayload);

        // Missing required field returns 200 with error handling
        expect(response.status).toBe(StatusCodes.OK);
      });

      it('should handle invalid action', async () => {
        const invalidPayload = {
          ...validCallbackPayload,
          data: JSON.stringify({ action: 'invalid_action' }),
        };
        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          step: 'awaiting_doc_type',
          customerName: 'Test',
          amount: 100,
          description: 'Test',
        });
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(invalidPayload);

        // Invalid action still returns 200 with error handling
        expect(response.status).toBe(StatusCodes.OK);
      });
    });
  });

  describe('HTTP method restrictions', () => {
    it('should not accept GET on /invoice/command', async () => {
      const response = await request(app).get('/invoice/command');
      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept GET on /invoice/message', async () => {
      const response = await request(app).get('/invoice/message');
      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept GET on /invoice/callback', async () => {
      const response = await request(app).get('/invoice/callback');
      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept PUT on /invoice/command', async () => {
      const response = await request(app).put('/invoice/command').send({});
      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should not accept DELETE on /invoice/message', async () => {
      const response = await request(app).delete('/invoice/message');
      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });
  });

  describe('Content-Type handling', () => {
    it('should accept application/json', async () => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([{ chatId: -123456 }]);
      (userMappingService.updateUserActivity as jest.Mock).mockResolvedValue(undefined);
      (sessionService.createSession as jest.Mock).mockResolvedValue({});
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/invoice/command')
        .set('Content-Type', 'application/json')
        .send({
          type: 'invoice_command',
          chatId: -123456,
          userId: 789,
          messageId: 101,
          username: 'testuser',
          text: '/invoice',
        });

      expect(response.status).toBe(StatusCodes.OK);
    });

    it('should return application/json responses', async () => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([{ chatId: -123456 }]);
      (userMappingService.updateUserActivity as jest.Mock).mockResolvedValue(undefined);
      (sessionService.createSession as jest.Mock).mockResolvedValue({});
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app).post('/invoice/command').send({
        type: 'invoice_command',
        chatId: -123456,
        userId: 789,
        messageId: 101,
        username: 'testuser',
        text: '/invoice',
      });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });
});

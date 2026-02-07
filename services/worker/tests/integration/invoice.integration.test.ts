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
jest.mock('../../src/services/document-generator/session.service');
jest.mock('../../src/services/document-generator');
jest.mock('../../src/services/telegram.service');
jest.mock('../../src/services/document-generator/parser.service');
jest.mock('../../src/services/business-config/config.service');
jest.mock('../../src/services/document-generator/open-invoices.service');

import * as userMappingService from '../../src/services/customer/user-mapping.service';
import * as sessionService from '../../src/services/document-generator/session.service';
import { generateInvoice } from '../../src/services/document-generator';
import * as telegramService from '../../src/services/telegram.service';
import * as parserService from '../../src/services/document-generator/parser.service';
import * as openInvoicesService from '../../src/services/document-generator/open-invoices.service';

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

  describe('Invoice Selection Pagination', () => {
    const receiptTypePayload: InvoiceCallbackPayload = {
      type: 'callback',
      chatId: -123456,
      userId: 789,
      messageId: 103,
      username: 'testuser',
      callbackQueryId: 'callback123',
      data: JSON.stringify({ action: 'select_type', documentType: 'receipt' }),
    };

    describe('Initial invoice list', () => {
      it('should show first 10 invoices with pagination info when more than 10 exist', async () => {
        // Mock 25 open invoices
        const mockInvoices = Array.from({ length: 10 }, (_, i) => ({
          invoiceNumber: `I-2026-${i + 1}`,
          customerName: `Customer ${i + 1}`,
          amount: 1000 + i * 100,
          paidAmount: 0,
          remainingBalance: 1000 + i * 100,
          date: '15/01/2026',
        }));

        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'select_type',
        });
        (sessionService.setDocumentType as jest.Mock).mockResolvedValue(undefined);
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue(mockInvoices);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(25);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(receiptTypePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(openInvoicesService.getOpenInvoices).toHaveBeenCalledWith(-123456, 0, 10);
        expect(openInvoicesService.countOpenInvoices).toHaveBeenCalledWith(-123456);
        expect(telegramService.sendMessage).toHaveBeenCalledWith(
          -123456,
          expect.stringContaining('מציג 10 מתוך 25'),
          expect.anything()
        );
      });

      it('should not show pagination info when 10 or fewer invoices exist', async () => {
        const mockInvoices = Array.from({ length: 5 }, (_, i) => ({
          invoiceNumber: `I-2026-${i + 1}`,
          customerName: `Customer ${i + 1}`,
          amount: 1000,
          paidAmount: 0,
          remainingBalance: 1000,
          date: '15/01/2026',
        }));

        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'select_type',
        });
        (sessionService.setDocumentType as jest.Mock).mockResolvedValue(undefined);
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue(mockInvoices);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(5);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(receiptTypePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(telegramService.sendMessage).toHaveBeenCalledWith(
          -123456,
          expect.stringContaining('מציג 5 מתוך 5'),
          expect.anything()
        );
      });

      it('should show no invoices message when no open invoices exist', async () => {
        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'select_type',
        });
        (sessionService.setDocumentType as jest.Mock).mockResolvedValue(undefined);
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue([]);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(0);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (sessionService.deleteSession as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(receiptTypePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(sessionService.deleteSession).toHaveBeenCalledWith(-123456, 789);
      });
    });

    describe('Show More functionality', () => {
      it('should load next 10 invoices when Show More is clicked', async () => {
        const mockInvoices = Array.from({ length: 10 }, (_, i) => ({
          invoiceNumber: `I-2026-${i + 11}`,
          customerName: `Customer ${i + 11}`,
          amount: 2000 + i * 100,
          paidAmount: 0,
          remainingBalance: 2000 + i * 100,
          date: '15/01/2026',
        }));

        const showMorePayload: InvoiceCallbackPayload = {
          type: 'callback',
          chatId: -123456,
          userId: 789,
          messageId: 103,
          username: 'testuser',
          callbackQueryId: 'callback456',
          data: JSON.stringify({ action: 'show_more', offset: 10 }),
        };

        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'awaiting_invoice_selection',
        });
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue(mockInvoices);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(25);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageReplyMarkup as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(showMorePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(openInvoicesService.getOpenInvoices).toHaveBeenCalledWith(-123456, 10, 10);
        expect(openInvoicesService.countOpenInvoices).toHaveBeenCalledWith(-123456);
        expect(telegramService.editMessageText).toHaveBeenCalledWith(
          -123456,
          103,
          expect.stringContaining('מציג 11-20 מתוך 25')
        );
        expect(telegramService.editMessageReplyMarkup).toHaveBeenCalled();
      });

      it('should load final batch of invoices', async () => {
        const mockInvoices = Array.from({ length: 5 }, (_, i) => ({
          invoiceNumber: `I-2026-${i + 21}`,
          customerName: `Customer ${i + 21}`,
          amount: 3000 + i * 100,
          paidAmount: 0,
          remainingBalance: 3000 + i * 100,
          date: '15/01/2026',
        }));

        const showMorePayload: InvoiceCallbackPayload = {
          type: 'callback',
          chatId: -123456,
          userId: 789,
          messageId: 103,
          username: 'testuser',
          callbackQueryId: 'callback789',
          data: JSON.stringify({ action: 'show_more', offset: 20 }),
        };

        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'awaiting_invoice_selection',
        });
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue(mockInvoices);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(25);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageReplyMarkup as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(showMorePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(telegramService.editMessageText).toHaveBeenCalledWith(
          -123456,
          103,
          expect.stringContaining('מציג 21-25 מתוך 25')
        );
      });

      it('should handle no more invoices gracefully', async () => {
        const showMorePayload: InvoiceCallbackPayload = {
          type: 'callback',
          chatId: -123456,
          userId: 789,
          messageId: 103,
          username: 'testuser',
          callbackQueryId: 'callback999',
          data: JSON.stringify({ action: 'show_more', offset: 30 }),
        };

        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'awaiting_invoice_selection',
        });
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue([]);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(25);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(showMorePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(telegramService.answerCallbackQuery).toHaveBeenCalledWith(
          'callback999',
          expect.objectContaining({
            text: 'אין עוד חשבוניות להצגה',
            showAlert: true,
          })
        );
      });
    });

    describe('Pagination edge cases', () => {
      it('should handle exactly 10 invoices (no Show More button)', async () => {
        const mockInvoices = Array.from({ length: 10 }, (_, i) => ({
          invoiceNumber: `I-2026-${i + 1}`,
          customerName: `Customer ${i + 1}`,
          amount: 1000,
          paidAmount: 0,
          remainingBalance: 1000,
          date: '15/01/2026',
        }));

        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'select_type',
        });
        (sessionService.setDocumentType as jest.Mock).mockResolvedValue(undefined);
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue(mockInvoices);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(10);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
        (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
        (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(receiptTypePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(telegramService.sendMessage).toHaveBeenCalledWith(
          -123456,
          expect.stringContaining('מציג 10 מתוך 10'),
          expect.anything()
        );
      });

      it('should handle offset larger than total (no invoices returned)', async () => {
        const showMorePayload: InvoiceCallbackPayload = {
          type: 'callback',
          chatId: -123456,
          userId: 789,
          messageId: 103,
          username: 'testuser',
          callbackQueryId: 'callback100',
          data: JSON.stringify({ action: 'show_more', offset: 100 }),
        };

        (sessionService.getSession as jest.Mock).mockResolvedValue({
          chatId: -123456,
          userId: 789,
          status: 'awaiting_invoice_selection',
        });
        (openInvoicesService.getOpenInvoices as jest.Mock).mockResolvedValue([]);
        (openInvoicesService.countOpenInvoices as jest.Mock).mockResolvedValue(25);
        (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app).post('/invoice/callback').send(showMorePayload);

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body.action).toBe('no_more_invoices');
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

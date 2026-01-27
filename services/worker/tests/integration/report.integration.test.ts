/**
 * Integration tests for Report API
 */

import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../src/app';
import type { ReportCommandPayload } from '../../../../shared/task.types';

// Mock all dependencies
jest.mock('../../src/services/customer/user-mapping.service');
jest.mock('../../src/services/report/report.service');
jest.mock('../../src/services/report/report-generator.service');
jest.mock('../../src/services/report/report-rate-limiter.service');
jest.mock('../../src/services/report/report-session.service');
jest.mock('../../src/services/telegram.service');
jest.mock('../../src/services/business-config/config.service');

import * as userMappingService from '../../src/services/customer/user-mapping.service';
import * as reportService from '../../src/services/report/report.service';
import * as reportGeneratorService from '../../src/services/report/report-generator.service';
import * as rateLimiterService from '../../src/services/report/report-rate-limiter.service';
import * as reportSessionService from '../../src/services/report/report-session.service';
import * as businessConfigService from '../../src/services/business-config/config.service';
import * as telegramService from '../../src/services/telegram.service';

describe('Report API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /report/command', () => {
    const validPayload: ReportCommandPayload = {
      type: 'command',
      chatId: -123456,
      chatTitle: 'Test Business',
      messageId: 789,
      userId: 12345,
      username: 'testuser',
      firstName: 'Test',
      text: '/report',
      receivedAt: new Date().toISOString(),
    };

    it('should create session successfully', async () => {
      // Setup mocks
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
        { chatId: -123456, businessName: 'Test Business' },
      ]);
      (rateLimiterService.checkReportLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 2,
      });
      (reportSessionService.getActiveSession as jest.Mock).mockResolvedValue(null);
      (reportSessionService.createReportSession as jest.Mock).mockResolvedValue({
        sessionId: 'test_session_123',
        chatId: -123456,
        userId: 12345,
        status: 'active',
        currentStep: 'type',
      });

      const response = await request(app).post('/report/command').send(validPayload);

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body.ok).toBe(true);
      expect(response.body.action).toBe('session_created');
      expect(response.body.sessionId).toBe('test_session_123');
    });

    it('should reject unauthorized users', async () => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([]);

      const response = await request(app).post('/report/command').send(validPayload);

      expect(response.status).toBe(StatusCodes.FORBIDDEN);
      expect(response.body.error).toBe('No access');
    });

    it('should cancel existing session and create new one', async () => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
        { chatId: -123456, businessName: 'Test Business' },
      ]);
      (rateLimiterService.checkReportLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 2,
      });
      (reportSessionService.getActiveSession as jest.Mock).mockResolvedValue({
        sessionId: 'old_session_123',
        chatId: -123456,
        userId: 12345,
        status: 'active',
        currentStep: 'date',
      });
      (reportSessionService.cancelReportSession as jest.Mock).mockResolvedValue(undefined);
      (reportSessionService.createReportSession as jest.Mock).mockResolvedValue({
        sessionId: 'new_session_456',
        chatId: -123456,
        userId: 12345,
        status: 'active',
        currentStep: 'type',
      });

      const response = await request(app).post('/report/command').send(validPayload);

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body.sessionId).toBe('new_session_456');
      expect(reportSessionService.cancelReportSession).toHaveBeenCalledWith('old_session_123');
    });

    it('should handle session creation errors gracefully', async () => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
        { chatId: -123456, businessName: 'Test Business' },
      ]);
      (reportSessionService.getActiveSession as jest.Mock).mockResolvedValue(null);
      (reportSessionService.createReportSession as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app).post('/report/command').send(validPayload);

      expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(response.body.error).toBe('Failed to start report flow');
    });

    it('should handle user with access to different chat', async () => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
        { chatId: -999999, businessName: 'Different Business' },
      ]);

      const response = await request(app).post('/report/command').send(validPayload);

      expect(response.status).toBe(StatusCodes.FORBIDDEN);
    });

    it('should enforce rate limiting', async () => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
        { chatId: -123456, businessName: 'Test Business' },
      ]);
      (rateLimiterService.checkReportLimit as jest.Mock).mockResolvedValue({
        allowed: false,
        resetAt: new Date('2026-01-28T00:00:00Z'),
        remaining: 0,
      });

      const response = await request(app).post('/report/command').send(validPayload);

      expect(response.status).toBe(StatusCodes.TOO_MANY_REQUESTS);
      expect(response.body.error).toContain('Rate limit');
      expect(reportSessionService.createReportSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /report/callback', () => {
    const mockSession = {
      sessionId: 'test_session_123',
      chatId: -123456,
      userId: 12345,
      status: 'active' as const,
      currentStep: 'type' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };

    const baseCallbackPayload = {
      chatId: -123456,
      messageId: 789,
      userId: 12345,
      username: 'testuser',
      firstName: 'Test',
      callbackQueryId: 'abc123',
      receivedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      (userMappingService.getUserCustomers as jest.Mock).mockResolvedValue([
        { chatId: -123456, businessName: 'Test Business' },
      ]);
      (telegramService.editMessageText as jest.Mock).mockResolvedValue(undefined);
      (telegramService.answerCallbackQuery as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendMessage as jest.Mock).mockResolvedValue(undefined);
      (telegramService.sendDocument as jest.Mock).mockResolvedValue(undefined);
    });

    describe('Type Selection', () => {
      it('should handle revenue type selection', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue({
          ...mockSession,
          currentStep: 'type',
        });
        (reportSessionService.updateReportSession as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_type',
                sessionId: 'test_session_123',
                value: 'revenue',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body.ok).toBe(true);
        expect(reportSessionService.updateReportSession).toHaveBeenCalledWith(
          'test_session_123',
          expect.objectContaining({
            reportType: 'revenue',
            currentStep: 'date',
          })
        );
      });

      it('should handle expenses type selection', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue({
          ...mockSession,
          currentStep: 'type',
        });
        (reportSessionService.updateReportSession as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_type',
                sessionId: 'test_session_123',
                value: 'expenses',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(reportSessionService.updateReportSession).toHaveBeenCalledWith(
          'test_session_123',
          expect.objectContaining({
            reportType: 'expenses',
            currentStep: 'date',
          })
        );
      });

      it('should reject invalid report type', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue({
          ...mockSession,
          currentStep: 'type',
        });
        (reportSessionService.updateReportSession as jest.Mock).mockRejectedValue(
          new Error('Invalid report type')
        );

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_type',
                sessionId: 'test_session_123',
                value: 'invalid',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      });
    });

    describe('Date Selection', () => {
      const datePresets = ['this_month', 'last_month', 'ytd', 'this_year'];

      datePresets.forEach((preset) => {
        it(`should handle ${preset} date selection`, async () => {
          (reportSessionService.getReportSession as jest.Mock).mockResolvedValue({
            ...mockSession,
            currentStep: 'date',
            reportType: 'revenue',
          });
          (reportSessionService.updateReportSession as jest.Mock).mockResolvedValue(undefined);
          (reportService.getDateRangeForPreset as jest.Mock).mockReturnValue({
            start: '2026-01-01',
            end: '2026-01-31',
            preset,
          });
          (businessConfigService.getBusinessConfig as jest.Mock).mockResolvedValue({
            business: { name: 'Test Business' },
          });
          (reportService.generateReportData as jest.Mock).mockResolvedValue({
            businessName: 'Test Business',
            reportType: 'revenue',
            dateRange: { start: '2026-01-01', end: '2026-01-31', preset },
            metrics: {
              totalRevenue: 10000,
              invoiceCount: 5,
              avgInvoice: 2000,
              maxInvoice: 5000,
              minInvoice: 500,
              currencies: [
                {
                  currency: 'ILS',
                  totalRevenue: 10000,
                  invoiceCount: 5,
                  avgInvoice: 2000,
                  maxInvoice: 5000,
                  minInvoice: 500,
                },
              ],
              paymentMethods: {},
            },
            invoices: [
              {
                invoiceNumber: '001',
                date: '2026-01-15',
                customerName: 'Test Customer',
                amount: 1000,
                currency: 'ILS',
                paymentMethod: 'Cash',
                driveLink: 'https://drive.google.com/...',
              },
            ],
          });

          const response = await request(app)
            .post('/report/callback')
            .send({
              callback_query: {
                id: baseCallbackPayload.callbackQueryId,
                data: JSON.stringify({
                  action: 'select_date',
                  sessionId: 'test_session_123',
                  value: preset,
                }),
                message: {
                  chat: {
                    id: baseCallbackPayload.chatId,
                  },
                },
              },
            });

          expect(response.status).toBe(StatusCodes.OK);
          expect(reportSessionService.updateReportSession).toHaveBeenCalledWith(
            'test_session_123',
            expect.objectContaining({
              currentStep: 'format',
              datePreset: preset,
            })
          );
        });
      });

      it('should reject invalid date preset', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue({
          ...mockSession,
          currentStep: 'date',
          reportType: 'revenue',
        });
        (reportService.getDateRangeForPreset as jest.Mock).mockImplementation(() => {
          throw new Error('Unknown preset');
        });

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_date',
                sessionId: 'test_session_123',
                value: 'invalid_preset',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      });
    });

    describe('Format Selection & Generation', () => {
      const mockReportData = {
        businessName: 'Test Business',
        logoUrl: undefined,
        reportType: 'revenue' as const,
        dateRange: { start: '2026-01-01', end: '2026-01-31', preset: 'this_month' as const },
        generatedAt: new Date().toISOString(),
        metrics: {
          totalRevenue: 10000,
          invoiceCount: 5,
          avgInvoice: 2000,
          maxInvoice: 5000,
          minInvoice: 500,
          currencies: [
            {
              currency: 'ILS',
              totalRevenue: 10000,
              invoiceCount: 5,
              avgInvoice: 2000,
              maxInvoice: 5000,
              minInvoice: 500,
            },
          ],
          paymentMethods: {},
        },
        invoices: [],
      };

      beforeEach(() => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue({
          ...mockSession,
          currentStep: 'format',
          reportType: 'revenue',
          datePreset: 'this_month',
        });
        (businessConfigService.getBusinessConfig as jest.Mock).mockResolvedValue({
          business: { name: 'Test Business' },
        });
        (reportService.getDateRangeForPreset as jest.Mock).mockReturnValue({
          start: '2026-01-01',
          end: '2026-01-31',
          preset: 'this_month',
        });
        (reportService.generateReportData as jest.Mock).mockResolvedValue(mockReportData);
        (rateLimiterService.checkReportLimit as jest.Mock).mockResolvedValue({
          allowed: true,
          remaining: 2,
        });
        (rateLimiterService.recordReportGeneration as jest.Mock).mockResolvedValue(undefined);
        (reportSessionService.completeReportSession as jest.Mock).mockResolvedValue(undefined);
        (reportSessionService.updateReportSession as jest.Mock).mockResolvedValue(undefined);
      });

      it('should generate PDF report', async () => {
        const pdfBuffer = Buffer.from('fake-pdf-content');
        (reportGeneratorService.generatePDFReport as jest.Mock).mockResolvedValue(pdfBuffer);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_format',
                sessionId: 'test_session_123',
                value: 'pdf',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body.ok).toBe(true);
        expect(reportGeneratorService.generatePDFReport).toHaveBeenCalledWith(mockReportData);
        expect(rateLimiterService.recordReportGeneration).toHaveBeenCalledWith(-123456);
        expect(reportSessionService.completeReportSession).toHaveBeenCalledWith('test_session_123');
      });

      it('should generate Excel report', async () => {
        const excelBuffer = Buffer.from('fake-excel-content');
        (reportGeneratorService.generateExcelReport as jest.Mock).mockResolvedValue(excelBuffer);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_format',
                sessionId: 'test_session_123',
                value: 'excel',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(reportGeneratorService.generateExcelReport).toHaveBeenCalledWith(mockReportData);
      });

      it('should generate CSV report', async () => {
        const csvBuffer = Buffer.from('fake-csv-content');
        (reportGeneratorService.generateCSVReport as jest.Mock).mockResolvedValue(csvBuffer);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_format',
                sessionId: 'test_session_123',
                value: 'csv',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(reportGeneratorService.generateCSVReport).toHaveBeenCalledWith(mockReportData);
      });

      it('should record rate limit after successful generation', async () => {
        const pdfBuffer = Buffer.from('fake-pdf-content');
        (reportGeneratorService.generatePDFReport as jest.Mock).mockResolvedValue(pdfBuffer);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_format',
                sessionId: 'test_session_123',
                value: 'pdf',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(rateLimiterService.recordReportGeneration).toHaveBeenCalledWith(-123456);
      });

      it('should handle generation errors gracefully', async () => {
        (reportGeneratorService.generatePDFReport as jest.Mock).mockRejectedValue(
          new Error('PDF generation failed')
        );

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_format',
                sessionId: 'test_session_123',
                value: 'pdf',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
        expect(response.body.error).toBe('Failed to handle callback');
      });

      it('should handle invalid format gracefully', async () => {
        // Invalid format will default to CSV in the controller
        const csvBuffer = Buffer.from('fake-csv-content');
        (reportGeneratorService.generateCSVReport as jest.Mock).mockResolvedValue(csvBuffer);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_format',
                sessionId: 'test_session_123',
                value: 'invalid',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        // Controller handles invalid format by defaulting to CSV
        expect(response.status).toBe(StatusCodes.OK);
        expect(reportGeneratorService.generateCSVReport).toHaveBeenCalled();
      });
    });

    describe('Session Validation', () => {
      it('should reject callback without active session', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue(null);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_type',
                sessionId: 'test_session_123',
                value: 'revenue',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body.ok).toBe(true);
      });

      it('should reject callback for wrong session ID', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue({
          ...mockSession,
          sessionId: 'different_session_456',
        });

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_type',
                sessionId: 'test_session_123',
                value: 'revenue',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body.ok).toBe(true);
      });

      it('should handle callback errors gracefully', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockRejectedValue(
          new Error('Database error')
        );

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'select_type',
                sessionId: 'test_session_123',
                value: 'revenue',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
        expect(response.body.error).toBe('Failed to handle callback');
      });

      it('should handle malformed callback data', async () => {
        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: 'invalid-json',
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
        expect(response.body.error).toBe('Failed to handle callback');
      });
    });

    describe('Cancel Flow', () => {
      it('should cancel active session', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue(mockSession);
        (reportSessionService.cancelReportSession as jest.Mock).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'cancel',
                sessionId: 'test_session_123',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body.ok).toBe(true);
        expect(reportSessionService.cancelReportSession).toHaveBeenCalledWith('test_session_123');
      });

      it('should handle cancel when no session exists', async () => {
        (reportSessionService.getReportSession as jest.Mock).mockResolvedValue(null);

        const response = await request(app)
          .post('/report/callback')
          .send({
            callback_query: {
              id: baseCallbackPayload.callbackQueryId,
              data: JSON.stringify({
                action: 'cancel',
                sessionId: 'test_session_123',
              }),
              message: {
                chat: {
                  id: baseCallbackPayload.chatId,
                },
              },
            },
          });

        expect(response.status).toBe(StatusCodes.OK);
        expect(response.body.ok).toBe(true);
      });
    });
  });
});

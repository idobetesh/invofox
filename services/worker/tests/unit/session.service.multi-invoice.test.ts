/**
 * Session Service Multi-Invoice Tests
 * Tests for multi-invoice receipt selection and validation
 */

import * as sessionService from '../../src/services/document-generator/session.service';

// Mock Firestore
const mockRunTransaction = jest.fn();
const mockUpdate = jest.fn();
const mockGet = jest.fn();
const mockDoc = jest.fn(() => ({
  update: mockUpdate,
  get: mockGet,
}));
const mockCollection = jest.fn(() => ({
  doc: mockDoc,
}));

// Helper to create mock Timestamp objects
function createMockTimestamp(date: Date = new Date()) {
  return {
    toMillis: () => date.getTime(),
    toDate: () => date,
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: (date.getTime() % 1000) * 1000000,
  };
}

jest.mock('@google-cloud/firestore', () => {
  return {
    Firestore: jest.fn(() => ({
      collection: mockCollection,
      runTransaction: mockRunTransaction,
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date()),
    },
    Timestamp: {
      fromDate: jest.fn((date) => createMockTimestamp(date)),
      now: jest.fn(() => createMockTimestamp(new Date())),
    },
  };
});

describe('Session Service - Multi-Invoice', () => {
  const chatId = 123456;
  const userId = 789012;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('toggleInvoiceSelection', () => {
    it('should add first invoice to empty selection', async () => {
      const invoiceNumber = 'I-2026-100';
      const invoiceData = {
        customerName: 'רבקה לוי',
        remainingBalance: 3000,
        date: '01/01/2026',
        currency: 'ILS',
      };

      // Mock transaction
      mockRunTransaction.mockImplementation(async (callback) => {
        const mockSessionRef = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              chatId,
              userId,
              status: 'awaiting_details',
              documentType: 'receipt',
              selectedInvoiceNumbers: [],
              selectedInvoiceData: [],
            }),
          }),
          update: jest.fn(),
        };

        return callback({
          get: () => mockSessionRef.get(),
          update: (ref: any, data: any) => mockSessionRef.update(data),
        });
      });

      // Mock the read-after-write
      const mockSession = {
        chatId,
        userId,
        status: 'awaiting_details' as const,
        documentType: 'receipt' as const,
        selectedInvoiceNumbers: [invoiceNumber],
        selectedInvoiceData: [{ ...invoiceData, invoiceNumber }],
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.toggleInvoiceSelection(
        chatId,
        userId,
        invoiceNumber,
        invoiceData
      );

      expect(result.selectedInvoiceNumbers).toEqual([invoiceNumber]);
      expect(result.selectedInvoiceData).toEqual([{ ...invoiceData, invoiceNumber }]);
      expect(mockRunTransaction).toHaveBeenCalled();
    });

    it('should add second invoice to existing selection', async () => {
      const existingInvoice = 'I-2026-100';
      const newInvoice = 'I-2026-101';
      const newInvoiceData = {
        customerName: 'רבקה לוי',
        remainingBalance: 2500,
        date: '02/01/2026',
        currency: 'ILS',
      };

      // Mock transaction with existing invoice
      mockRunTransaction.mockImplementation(async (callback) => {
        const mockSessionRef = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              chatId,
              userId,
              status: 'awaiting_details',
              documentType: 'receipt',
              selectedInvoiceNumbers: [existingInvoice],
              selectedInvoiceData: [
                {
                  invoiceNumber: existingInvoice,
                  customerName: 'רבקה לוי',
                  remainingBalance: 3000,
                  date: '01/01/2026',
                  currency: 'ILS',
                },
              ],
            }),
          }),
          update: jest.fn(),
        };

        return callback({
          get: () => mockSessionRef.get(),
          update: (ref: any, data: any) => mockSessionRef.update(data),
        });
      });

      // Mock the read-after-write
      const mockSession = {
        chatId,
        userId,
        selectedInvoiceNumbers: [existingInvoice, newInvoice],
        selectedInvoiceData: [
          {
            invoiceNumber: existingInvoice,
            customerName: 'רבקה לוי',
            remainingBalance: 3000,
            date: '01/01/2026',
            currency: 'ILS',
          },
          { ...newInvoiceData, invoiceNumber: newInvoice },
        ],
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.toggleInvoiceSelection(
        chatId,
        userId,
        newInvoice,
        newInvoiceData
      );

      expect(result.selectedInvoiceNumbers).toHaveLength(2);
      expect(result.selectedInvoiceNumbers).toContain(existingInvoice);
      expect(result.selectedInvoiceNumbers).toContain(newInvoice);
    });

    it('should remove invoice when toggling already selected invoice', async () => {
      const invoiceToRemove = 'I-2026-101';
      const remainingInvoice = 'I-2026-100';

      // Mock transaction with 2 selected invoices
      mockRunTransaction.mockImplementation(async (callback) => {
        const mockSessionRef = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              chatId,
              userId,
              selectedInvoiceNumbers: [remainingInvoice, invoiceToRemove],
              selectedInvoiceData: [
                {
                  invoiceNumber: remainingInvoice,
                  customerName: 'רבקה לוי',
                  remainingBalance: 3000,
                  date: '01/01/2026',
                },
                {
                  invoiceNumber: invoiceToRemove,
                  customerName: 'רבקה לוי',
                  remainingBalance: 2500,
                  date: '02/01/2026',
                },
              ],
            }),
          }),
          update: jest.fn(),
        };

        return callback({
          get: () => mockSessionRef.get(),
          update: (ref: any, data: any) => mockSessionRef.update(data),
        });
      });

      // Mock the read-after-write
      const mockSession = {
        selectedInvoiceNumbers: [remainingInvoice],
        selectedInvoiceData: [
          {
            invoiceNumber: remainingInvoice,
            customerName: 'רבקה לוי',
            remainingBalance: 3000,
            date: '01/01/2026',
          },
        ],
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.toggleInvoiceSelection(chatId, userId, invoiceToRemove, {
        customerName: 'רבקה לוי',
        remainingBalance: 2500,
        date: '02/01/2026',
        currency: 'ILS',
      });

      expect(result.selectedInvoiceNumbers).toHaveLength(1);
      expect(result.selectedInvoiceNumbers).toContain(remainingInvoice);
      expect(result.selectedInvoiceNumbers).not.toContain(invoiceToRemove);
    });

    it('should enforce max 10 invoices limit', async () => {
      // Mock transaction with 10 already selected invoices
      const existingInvoices = Array.from({ length: 10 }, (_, i) => `I-2026-${100 + i}`);
      const existingData = existingInvoices.map((num, i) => ({
        invoiceNumber: num,
        customerName: 'רבקה לוי',
        remainingBalance: 2000 + i * 100,
        date: `${String(i + 1).padStart(2, '0')}/01/2026`,
      }));

      mockRunTransaction.mockImplementation(async (callback) => {
        const mockSessionRef = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              chatId,
              userId,
              selectedInvoiceNumbers: existingInvoices,
              selectedInvoiceData: existingData,
              updatedAt: createMockTimestamp(new Date()),
            }),
          }),
          update: jest.fn(),
        };

        return callback({
          get: () => mockSessionRef.get(),
          update: (_ref: any, _data: any) => {
            // Transaction callback will throw before update
            throw new Error('לא ניתן לבחור יותר מ-10 חשבוניות');
          },
        });
      });

      await expect(
        sessionService.toggleInvoiceSelection(chatId, userId, 'I-2026-111', {
          customerName: 'רבקה לוי',
          remainingBalance: 5000,
          date: '11/01/2026',
          currency: 'ILS',
        })
      ).rejects.toThrow('לא ניתן לבחור יותר מ-10 חשבוניות');
    });
  });

  describe('validateAndConfirmSelection', () => {
    it('should validate and confirm selection with 2 invoices', async () => {
      const invoices = [
        {
          invoiceNumber: 'I-2026-100',
          customerName: 'רבקה לוי',
          remainingBalance: 3000,
          date: '01/01/2026',
        },
        {
          invoiceNumber: 'I-2026-101',
          customerName: 'רבקה לוי',
          remainingBalance: 2500,
          date: '02/01/2026',
        },
      ];

      const now = new Date();

      // Mock transaction
      mockRunTransaction.mockImplementation(async (callback) => {
        const mockSessionRef = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              chatId,
              userId,
              selectedInvoiceNumbers: invoices.map((i) => i.invoiceNumber),
              selectedInvoiceData: invoices,
              updatedAt: createMockTimestamp(now),
              createdAt: createMockTimestamp(now),
            }),
          }),
          update: jest.fn(),
        };

        return callback({
          get: () => mockSessionRef.get(),
          update: (ref: any, data: any) => mockSessionRef.update(data),
        });
      });

      // Mock the read-after-write
      const mockSession = {
        status: 'awaiting_payment',
        customerName: 'רבקה לוי',
        amount: 5500,
        description: 'קבלה עבור חשבוניות: I-2026-100, I-2026-101',
        selectedInvoiceNumbers: invoices.map((i) => i.invoiceNumber),
        selectedInvoiceData: invoices,
        updatedAt: createMockTimestamp(now),
        createdAt: createMockTimestamp(now),
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.validateAndConfirmSelection(chatId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.session.status).toBe('awaiting_payment');
        expect(result.session.customerName).toBe('רבקה לוי');
        expect(result.session.amount).toBe(5500);
        expect(result.session.description).toContain('I-2026-100');
        expect(result.session.description).toContain('I-2026-101');
      }
    });

    it('should reject selection with less than 2 invoices', async () => {
      const now = new Date();

      // Mock getSession to return session with only 1 invoice
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          chatId,
          userId,
          selectedInvoiceNumbers: ['I-2026-100'],
          selectedInvoiceData: [
            {
              invoiceNumber: 'I-2026-100',
              customerName: 'רבקה לוי',
              remainingBalance: 3000,
              date: '01/01/2026',
            },
          ],
          updatedAt: createMockTimestamp(now),
          createdAt: createMockTimestamp(now),
        }),
      });

      const result = await sessionService.validateAndConfirmSelection(chatId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('בחר לפחות 2 חשבוניות');
      }
    });

    it('should reject selection with more than 10 invoices', async () => {
      const now = new Date();
      const tooManyInvoices = Array.from({ length: 11 }, (_, i) => ({
        invoiceNumber: `I-2026-${100 + i}`,
        customerName: 'רבקה לוי',
        remainingBalance: 2000 + i * 100,
        date: `${String(i + 1).padStart(2, '0')}/01/2026`,
      }));

      // Mock getSession to return session with 11 invoices
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          chatId,
          userId,
          selectedInvoiceNumbers: tooManyInvoices.map((i) => i.invoiceNumber),
          selectedInvoiceData: tooManyInvoices,
          updatedAt: createMockTimestamp(now),
          createdAt: createMockTimestamp(now),
        }),
      });

      const result = await sessionService.validateAndConfirmSelection(chatId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('לא ניתן לבחור יותר מ-10 חשבוניות');
      }
    });

    it('should reject selection with inconsistent customer names', async () => {
      const now = new Date();
      const mixedCustomers = [
        {
          invoiceNumber: 'I-2026-100',
          customerName: 'רבקה לוי',
          remainingBalance: 3000,
          date: '01/01/2026',
        },
        {
          invoiceNumber: 'I-2026-101',
          customerName: 'דוד כהן',
          remainingBalance: 2500,
          date: '02/01/2026',
        },
        {
          invoiceNumber: 'I-2026-102',
          customerName: 'רבקה לוי',
          remainingBalance: 1500,
          date: '03/01/2026',
        },
      ];

      // Mock getSession to return session with mixed customers
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          chatId,
          userId,
          selectedInvoiceNumbers: mixedCustomers.map((i) => i.invoiceNumber),
          selectedInvoiceData: mixedCustomers,
          updatedAt: createMockTimestamp(now),
          createdAt: createMockTimestamp(now),
        }),
      });

      const result = await sessionService.validateAndConfirmSelection(chatId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('כל החשבוניות חייבות להיות לאותו לקוח');
      }
    });

    it('should reject selection with mixed currencies', async () => {
      const now = new Date();
      const mixedCurrencies = [
        {
          invoiceNumber: 'I-2026-200',
          customerName: 'רבקה לוי',
          remainingBalance: 3000,
          date: '01/01/2026',
          currency: 'ILS',
        },
        {
          invoiceNumber: 'I-2026-201',
          customerName: 'רבקה לוי',
          remainingBalance: 2500,
          date: '02/01/2026',
          currency: 'USD', // Different currency!
        },
      ];

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          chatId,
          userId,
          selectedInvoiceNumbers: mixedCurrencies.map((i) => i.invoiceNumber),
          selectedInvoiceData: mixedCurrencies,
          updatedAt: createMockTimestamp(now),
          createdAt: createMockTimestamp(now),
        }),
      });

      const result = await sessionService.validateAndConfirmSelection(chatId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('כל החשבוניות חייבות להיות באותו מטבע');
      }
    });

    it('should calculate total amount correctly for 10 invoices', async () => {
      const now = new Date();
      const tenInvoices = Array.from({ length: 10 }, (_, i) => ({
        invoiceNumber: `I-2026-${100 + i}`,
        customerName: 'רבקה לוי',
        remainingBalance: 2000 + i * 100, // 2000, 2100, 2200, ..., 2900
        date: `${String(i + 1).padStart(2, '0')}/01/2026`,
        currency: 'ILS',
      }));

      const expectedTotal = tenInvoices.reduce((sum, inv) => sum + inv.remainingBalance, 0); // 24500

      mockRunTransaction.mockImplementation(async (callback) => {
        const mockSessionRef = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              chatId,
              userId,
              selectedInvoiceNumbers: tenInvoices.map((i) => i.invoiceNumber),
              selectedInvoiceData: tenInvoices,
              updatedAt: createMockTimestamp(now),
              createdAt: createMockTimestamp(now),
            }),
          }),
          update: jest.fn(),
        };

        return callback({
          get: () => mockSessionRef.get(),
          update: (ref: any, data: any) => mockSessionRef.update(data),
        });
      });

      const mockSession = {
        status: 'awaiting_payment',
        amount: expectedTotal,
        selectedInvoiceNumbers: tenInvoices.map((i) => i.invoiceNumber),
        selectedInvoiceData: tenInvoices,
        updatedAt: createMockTimestamp(now),
        createdAt: createMockTimestamp(now),
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.validateAndConfirmSelection(chatId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.session.amount).toBe(expectedTotal);
        expect(result.session.amount).toBe(24500);
      }
    });
  });

  describe('clearInvoiceSelection', () => {
    it('should clear all selected invoices', async () => {
      const now = new Date();
      mockUpdate.mockResolvedValue(undefined);

      const mockSession = {
        selectedInvoiceNumbers: [],
        selectedInvoiceData: [],
        updatedAt: createMockTimestamp(now),
        createdAt: createMockTimestamp(now),
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.clearInvoiceSelection(chatId, userId);

      expect(mockUpdate).toHaveBeenCalledWith({
        selectedInvoiceNumbers: [],
        selectedInvoiceData: [],
        updatedAt: expect.any(Date),
      });
      expect(result.selectedInvoiceNumbers).toEqual([]);
      expect(result.selectedInvoiceData).toEqual([]);
    });
  });
});

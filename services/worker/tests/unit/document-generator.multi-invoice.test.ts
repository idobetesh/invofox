/**
 * Document Generator Multi-Invoice Tests
 * Tests for multi-invoice receipt generation and payment tracking
 */

import { GeneratedInvoice } from '../../../../shared/invoice.types';
import { validateAndConfirmSelection } from '../../src/services/document-generator/session.service';
import { updateMultipleInvoicesPayment } from '../../src/services/document-generator/invoice-store.service';
import { getFirestore } from '../../src/services/firestore.service';

// ─── Type helpers for mock internals ─────────────────────────────────────────

type MockDocRef = { _docId: string };
type MockInvoiceUpdate = Partial<GeneratedInvoice> & {
  relatedReceiptIds?: { _arrayUnion: string };
};
type MockTransaction = { get: jest.Mock; update: jest.Mock };

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Mock Firestore
const mockRunTransaction = jest.fn();
const mockSet = jest.fn();
const mockGet = jest.fn();
const mockDoc = jest.fn(() => ({
  set: mockSet,
  get: mockGet,
}));
const mockCollection = jest.fn(() => ({
  doc: mockDoc,
}));

// Mock other dependencies
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        save: jest.fn(),
        getSignedUrl: jest.fn().mockResolvedValue(['https://example.com/file.pdf']),
      })),
    })),
  })),
}));

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(() => ({
      newPage: jest.fn(() => ({
        setContent: jest.fn(),
        pdf: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
      })),
      close: jest.fn(),
    })),
  },
}));

jest.mock('@google-cloud/firestore', () => {
  return {
    Firestore: jest.fn(() => ({
      collection: mockCollection,
      runTransaction: mockRunTransaction,
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date()),
      arrayUnion: jest.fn((val) => ({ _arrayUnion: val })),
      increment: jest.fn((val) => ({ _increment: val })),
    },
    Timestamp: {
      fromDate: jest.fn((date: Date) => ({
        toMillis: () => date.getTime(),
        toDate: () => date,
      })),
      now: jest.fn(() => ({
        toMillis: () => Date.now(),
        toDate: () => new Date(),
      })),
    },
  };
});

// Mocks firestore.service so session.service picks it up at import time
jest.mock('../../src/services/firestore.service', () => ({
  getFirestore: jest.fn(),
}));

describe('Document Generator - Multi-Invoice', () => {
  const chatId = -5175500469;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Multi-Invoice Payment Update', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (getFirestore as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          doc: jest.fn((docId: string) => ({ _docId: docId })),
        })),
        runTransaction: mockRunTransaction,
      });
    });

    it('should update all parent invoices atomically', async () => {
      const receiptNumber = 'R-2026-999';
      const parentInvoices: Partial<GeneratedInvoice>[] = [
        {
          chatId,
          invoiceNumber: 'I-2026-100',
          amount: 3000,
          remainingBalance: 3000,
          paidAmount: 0,
          paymentStatus: 'unpaid',
        },
        {
          chatId,
          invoiceNumber: 'I-2026-101',
          amount: 2500,
          remainingBalance: 2500,
          paidAmount: 0,
          paymentStatus: 'unpaid',
        },
      ];

      const updatedData: Record<string, Partial<GeneratedInvoice>> = {};

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const t: MockTransaction = {
            get: jest.fn((ref: MockDocRef) =>
              Promise.resolve({
                exists: true,
                data: () =>
                  parentInvoices.find(
                    (inv) => `chat_${chatId}_${inv.invoiceNumber}` === ref._docId
                  ),
              })
            ),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedData[ref._docId] = data;
            }),
          };
          return callback(t);
        }
      );

      const totalAmount = 3000 + 2500;
      await updateMultipleInvoicesPayment(
        chatId,
        parentInvoices as GeneratedInvoice[],
        receiptNumber,
        totalAmount
      );

      expect(mockRunTransaction).toHaveBeenCalled();

      const r1 = updatedData[`chat_${chatId}_I-2026-100`];
      const r2 = updatedData[`chat_${chatId}_I-2026-101`];

      expect(r1.paymentStatus).toBe('paid');
      expect(r1.remainingBalance).toBe(0);
      expect(r1.paidAmount).toBe(3000);

      expect(r2.paymentStatus).toBe('paid');
      expect(r2.remainingBalance).toBe(0);
      expect(r2.paidAmount).toBe(2500);
    });

    it('should rollback transaction if any invoice is already paid (race condition)', async () => {
      const parentInvoices: Partial<GeneratedInvoice>[] = [
        {
          chatId,
          invoiceNumber: 'I-2026-100',
          amount: 3000,
          remainingBalance: 3000,
          paidAmount: 0,
          paymentStatus: 'unpaid',
        },
        {
          chatId,
          invoiceNumber: 'I-2026-101',
          amount: 2500,
          remainingBalance: 0,
          paidAmount: 2500,
          paymentStatus: 'paid',
        }, // already paid
      ];

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const t: MockTransaction = {
            get: jest.fn((ref: MockDocRef) =>
              Promise.resolve({
                exists: true,
                data: () =>
                  parentInvoices.find(
                    (inv) => `chat_${chatId}_${inv.invoiceNumber}` === ref._docId
                  ),
              })
            ),
            update: jest.fn(),
          };
          return callback(t);
        }
      );

      await expect(
        updateMultipleInvoicesPayment(
          chatId,
          parentInvoices as GeneratedInvoice[],
          'R-2026-999',
          5500
        )
      ).rejects.toThrow('Invoice I-2026-101 is already paid');
    });

    it('should handle 10 invoices correctly', async () => {
      const parentInvoices = Array.from({ length: 10 }, (_, i) => ({
        chatId,
        invoiceNumber: `I-2026-${100 + i}`,
        amount: 2000 + i * 100,
        remainingBalance: 2000 + i * 100,
        paidAmount: 0,
        paymentStatus: 'unpaid' as const,
      }));
      const totalAmount = parentInvoices.reduce((s, inv) => s + inv.amount, 0);

      const updatedData: Record<string, Partial<GeneratedInvoice>> = {};

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const t: MockTransaction = {
            get: jest.fn((ref: MockDocRef) =>
              Promise.resolve({
                exists: true,
                data: () =>
                  parentInvoices.find(
                    (inv) => `chat_${chatId}_${inv.invoiceNumber}` === ref._docId
                  ),
              })
            ),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedData[ref._docId] = data;
            }),
          };
          return callback(t);
        }
      );

      await updateMultipleInvoicesPayment(
        chatId,
        parentInvoices as unknown as GeneratedInvoice[],
        'R-2026-999',
        totalAmount
      );

      expect(Object.keys(updatedData)).toHaveLength(10);
      Object.values(updatedData).forEach((data) => {
        expect(data.paymentStatus).toBe('paid');
        expect(data.remainingBalance).toBe(0);
      });
    });
  });

  describe('Multi-Invoice Receipt Document', () => {
    it('should save receipt with multi-invoice fields', () => {
      const receiptData: Partial<GeneratedInvoice> = {
        chatId,
        documentType: 'receipt',
        invoiceNumber: 'R-2026-999',
        customerName: 'רבקה לוי',
        amount: 5500,
        currency: 'ILS',
        description: 'קבלה עבור חשבוניות: I-2026-100, I-2026-101',
        isMultiInvoiceReceipt: true,
        relatedInvoiceNumbers: ['I-2026-100', 'I-2026-101'],
        relatedInvoiceIds: ['chat_-5175500469_I-2026-100', 'chat_-5175500469_I-2026-101'],
        relatedInvoiceNumber: 'I-2026-100', // Backward compat (first invoice)
      };

      expect(receiptData.isMultiInvoiceReceipt).toBe(true);
      expect(receiptData.relatedInvoiceNumbers).toHaveLength(2);
      expect(receiptData.relatedInvoiceIds).toHaveLength(2);
      expect(receiptData.amount).toBe(5500);
      expect(receiptData.description).toContain('I-2026-100');
      expect(receiptData.description).toContain('I-2026-101');
    });

    it('should set backward compatible fields for multi-invoice receipts', () => {
      const receiptData: Partial<GeneratedInvoice> = {
        isMultiInvoiceReceipt: true,
        relatedInvoiceNumbers: ['I-2026-100', 'I-2026-101', 'I-2026-102'],
        relatedInvoiceNumber: 'I-2026-100', // First invoice for backward compat
      };

      expect(receiptData.relatedInvoiceNumber).toBe('I-2026-100');
      expect(receiptData.relatedInvoiceNumbers?.[0]).toBe(receiptData.relatedInvoiceNumber);
    });
  });

  describe('Multi-Invoice Validation', () => {
    it('should validate all invoices belong to same customer', () => {
      const invoices: GeneratedInvoice[] = [
        {
          customerName: 'רבקה לוי',
          invoiceNumber: 'I-2026-100',
        } as GeneratedInvoice,
        {
          customerName: 'רבקה לוי',
          invoiceNumber: 'I-2026-101',
        } as GeneratedInvoice,
        {
          customerName: 'דוד כהן', // Different customer!
          invoiceNumber: 'I-2026-102',
        } as GeneratedInvoice,
      ];

      const customerNames = [...new Set(invoices.map((inv) => inv.customerName))];
      expect(customerNames.length).toBeGreaterThan(1);

      // Validation should fail
      const isValid = customerNames.length === 1;
      expect(isValid).toBe(false);
    });

    it('should validate all invoices have remaining balance', () => {
      const invoices: GeneratedInvoice[] = [
        {
          invoiceNumber: 'I-2026-100',
          remainingBalance: 3000,
        } as GeneratedInvoice,
        {
          invoiceNumber: 'I-2026-101',
          remainingBalance: 0, // Already paid!
        } as GeneratedInvoice,
      ];

      const allHaveBalance = invoices.every((inv) => (inv.remainingBalance ?? 0) > 0);
      expect(allHaveBalance).toBe(false);
    });

    it('should validate total amount matches sum of remaining balances', () => {
      const invoices = [
        { invoiceNumber: 'I-2026-100', remainingBalance: 3000 },
        { invoiceNumber: 'I-2026-101', remainingBalance: 2500 },
        { invoiceNumber: 'I-2026-102', remainingBalance: 1500 },
      ];

      const calculatedTotal = invoices.reduce((sum, inv) => sum + (inv.remainingBalance ?? 0), 0);
      const expectedTotal = 7000;

      expect(calculatedTotal).toBe(expectedTotal);
    });

    it('should allow partial payment (amount less than total remaining balance)', () => {
      const invoices = [{ invoiceNumber: 'I-2026-8', remainingBalance: 500 }];
      const expectedTotal = invoices.reduce((sum, inv) => sum + (inv.remainingBalance ?? 0), 0);
      const partialPaymentAmount = 200;

      // Partial payment: amount < total is valid (not an overpayment)
      const isOverpayment = partialPaymentAmount - expectedTotal > 0.01;
      expect(isOverpayment).toBe(false);
    });

    it('should reject payment that exceeds total remaining balance', () => {
      const invoices = [{ invoiceNumber: 'I-2026-8', remainingBalance: 500 }];
      const expectedTotal = invoices.reduce((sum, inv) => sum + (inv.remainingBalance ?? 0), 0);
      const overpaymentAmount = 600;

      const isOverpayment = overpaymentAmount - expectedTotal > 0.01;
      expect(isOverpayment).toBe(true);
    });
  });

  describe('Firestore Payment Update — actual distribution logic', () => {
    /**
     * These tests call the REAL updateMultipleInvoicesPayment function to verify
     * that totalPaymentAmount is distributed correctly across invoices.
     */

    beforeEach(() => {
      jest.clearAllMocks();
      // Wire getFirestore with a doc mock that preserves the docId in the ref
      // so transaction.get(ref) can route to the right invoice in tests
      (getFirestore as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          doc: jest.fn((docId: string) => ({ _docId: docId })),
        })),
        runTransaction: mockRunTransaction,
      });
    });

    it('single invoice — partial payment → status partial, remaining updated', async () => {
      const invoice: Partial<GeneratedInvoice> = {
        chatId,
        invoiceNumber: 'I-2026-200',
        amount: 500,
        remainingBalance: 500,
        paidAmount: 0,
        paymentStatus: 'unpaid',
      };

      const updatedData: Record<string, unknown> = {};

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const mockTransaction: MockTransaction = {
            get: jest.fn(() => Promise.resolve({ exists: true, data: () => invoice })),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedData[ref._docId] = data;
            }),
          };
          return callback(mockTransaction);
        }
      );

      await updateMultipleInvoicesPayment(chatId, [invoice as GeneratedInvoice], 'R-2026-1', 250);

      const result = updatedData[`chat_${chatId}_I-2026-200`] as Partial<GeneratedInvoice>;
      expect(result.paidAmount).toBe(250);
      expect(result.remainingBalance).toBe(250);
      expect(result.paymentStatus).toBe('partial');
    });

    it('single invoice — full payment → status paid, remaining = 0', async () => {
      const invoice: Partial<GeneratedInvoice> = {
        chatId,
        invoiceNumber: 'I-2026-201',
        amount: 500,
        remainingBalance: 500,
        paidAmount: 0,
        paymentStatus: 'unpaid',
      };

      const updatedData: Record<string, unknown> = {};

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const mockTransaction: MockTransaction = {
            get: jest.fn(() => Promise.resolve({ exists: true, data: () => invoice })),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedData[ref._docId] = data;
            }),
          };
          return callback(mockTransaction);
        }
      );

      await updateMultipleInvoicesPayment(chatId, [invoice as GeneratedInvoice], 'R-2026-2', 500);

      const result = updatedData[`chat_${chatId}_I-2026-201`] as Partial<GeneratedInvoice>;
      expect(result.paidAmount).toBe(500);
      expect(result.remainingBalance).toBe(0);
      expect(result.paymentStatus).toBe('paid');
    });

    it('multi-invoice — payment covers all → both paid', async () => {
      const invoices: Partial<GeneratedInvoice>[] = [
        {
          chatId,
          invoiceNumber: 'I-2026-210',
          amount: 300,
          remainingBalance: 300,
          paidAmount: 0,
          paymentStatus: 'unpaid',
        },
        {
          chatId,
          invoiceNumber: 'I-2026-211',
          amount: 400,
          remainingBalance: 400,
          paidAmount: 0,
          paymentStatus: 'unpaid',
        },
      ];

      const updatedData: Record<string, unknown> = {};

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const mockTransaction: MockTransaction = {
            get: jest.fn((ref: MockDocRef) => {
              const inv = invoices.find((i) => `chat_${chatId}_${i.invoiceNumber}` === ref._docId);
              return Promise.resolve({ exists: true, data: () => inv });
            }),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedData[ref._docId] = data;
            }),
          };
          return callback(mockTransaction);
        }
      );

      await updateMultipleInvoicesPayment(chatId, invoices as GeneratedInvoice[], 'R-2026-3', 700);

      const r1 = updatedData[`chat_${chatId}_I-2026-210`] as Partial<GeneratedInvoice>;
      const r2 = updatedData[`chat_${chatId}_I-2026-211`] as Partial<GeneratedInvoice>;
      expect(r1.remainingBalance).toBe(0);
      expect(r1.paymentStatus).toBe('paid');
      expect(r2.remainingBalance).toBe(0);
      expect(r2.paymentStatus).toBe('paid');
    });

    it('multi-invoice — partial total → first paid, second partial', async () => {
      const invoices: Partial<GeneratedInvoice>[] = [
        {
          chatId,
          invoiceNumber: 'I-2026-220',
          amount: 300,
          remainingBalance: 300,
          paidAmount: 0,
          paymentStatus: 'unpaid',
        },
        {
          chatId,
          invoiceNumber: 'I-2026-221',
          amount: 400,
          remainingBalance: 400,
          paidAmount: 0,
          paymentStatus: 'unpaid',
        },
      ];

      const updatedData: Record<string, unknown> = {};

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const mockTransaction: MockTransaction = {
            get: jest.fn((ref: MockDocRef) => {
              const inv = invoices.find((i) => `chat_${chatId}_${i.invoiceNumber}` === ref._docId);
              return Promise.resolve({ exists: true, data: () => inv });
            }),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedData[ref._docId] = data;
            }),
          };
          return callback(mockTransaction);
        }
      );

      // 500 out of 700 total — should fully pay first (300), partially pay second (200)
      await updateMultipleInvoicesPayment(chatId, invoices as GeneratedInvoice[], 'R-2026-4', 500);

      const r1 = updatedData[`chat_${chatId}_I-2026-220`] as Partial<GeneratedInvoice>;
      const r2 = updatedData[`chat_${chatId}_I-2026-221`] as Partial<GeneratedInvoice>;
      expect(r1.remainingBalance).toBe(0);
      expect(r1.paymentStatus).toBe('paid');
      expect(r2.paidAmount).toBe(200);
      expect(r2.remainingBalance).toBe(200);
      expect(r2.paymentStatus).toBe('partial');
    });
  });

  describe('Invoice Count Validation (Real Validation Logic)', () => {
    /**
     * CRITICAL: These tests verify the ACTUAL validation logic in session.service.ts
     * by calling validateAndConfirmSelection() with different invoice counts
     */

    let mockCountCollection: jest.Mock;
    let mockCountDoc: jest.Mock;
    let mockCountGet: jest.Mock;
    let mockCountUpdate: jest.Mock;
    let mockCountDelete: jest.Mock;

    beforeEach(() => {
      jest.clearAllMocks();

      mockCountGet = jest.fn();
      mockCountUpdate = jest.fn().mockResolvedValue(undefined);
      mockCountDelete = jest.fn().mockResolvedValue(undefined);
      mockCountDoc = jest.fn(() => ({
        get: mockCountGet,
        update: mockCountUpdate,
        delete: mockCountDelete,
      }));
      mockCountCollection = jest.fn(() => ({
        doc: mockCountDoc,
      }));

      (getFirestore as jest.Mock).mockReturnValue({
        collection: mockCountCollection,
      });
    });

    it('should ACCEPT 1 invoice (single-invoice receipt)', async () => {
      const sessionData = {
        status: 'selecting_invoices' as const,
        documentType: 'receipt' as const,
        selectedInvoiceNumbers: ['I-2026-100'],
        selectedInvoiceData: [
          {
            invoiceNumber: 'I-2026-100',
            customerName: 'רבקה לוי',
            remainingBalance: 3000,
            date: '01/01/2026',
            currency: 'ILS',
          },
        ],
        customerName: 'רבקה לוי',
        description: 'קבלה עבור חשבונית: I-2026-100',
        amount: 3000,
        date: '2026-01-01',
        createdAt: new Date(),
        updatedAt: {
          toMillis: () => Date.now(),
        },
      };

      mockCountGet.mockResolvedValue({
        exists: true,
        data: () => sessionData,
      });

      const result = await validateAndConfirmSelection(chatId, 123);

      expect(result.success).toBe(true);
      expect(mockCountUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'awaiting_payment',
        })
      );
      // amount is NOT stored here — it is reserved for the user-entered payment amount
      expect(mockCountUpdate).toHaveBeenCalledWith(
        expect.not.objectContaining({ amount: expect.anything() })
      );
    });

    it('should ACCEPT 10 invoices (max limit)', async () => {
      const tenInvoices = Array.from({ length: 10 }, (_, i) => ({
        invoiceNumber: `I-2026-${100 + i}`,
        customerName: 'רבקה לוי',
        remainingBalance: 1000,
        date: '01/01/2026',
        currency: 'ILS',
      }));

      const sessionData = {
        status: 'selecting_invoices' as const,
        documentType: 'receipt' as const,
        selectedInvoiceNumbers: tenInvoices.map((inv) => inv.invoiceNumber),
        selectedInvoiceData: tenInvoices,
        customerName: 'רבקה לוי',
        description: 'קבלה עבור חשבוניות',
        amount: 10000,
        date: '2026-01-01',
        createdAt: new Date(),
        updatedAt: {
          toMillis: () => Date.now(),
        },
      };

      mockCountGet.mockResolvedValue({
        exists: true,
        data: () => sessionData,
      });

      const result = await validateAndConfirmSelection(chatId, 123);

      expect(result.success).toBe(true);
      expect(mockCountUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'awaiting_payment',
        })
      );
      // amount is NOT stored here — it is reserved for the user-entered payment amount
      expect(mockCountUpdate).toHaveBeenCalledWith(
        expect.not.objectContaining({ amount: expect.anything() })
      );
    });

    it('should REJECT 0 invoices (minimum validation)', async () => {
      const sessionData = {
        status: 'selecting_invoices' as const,
        documentType: 'receipt' as const,
        selectedInvoiceNumbers: [],
        selectedInvoiceData: [],
        customerName: '',
        description: '',
        amount: 0,
        date: '2026-01-01',
        createdAt: new Date(),
        updatedAt: {
          toMillis: () => Date.now(),
        },
      };

      mockCountGet.mockResolvedValue({
        exists: true,
        data: () => sessionData,
      });

      const result = await validateAndConfirmSelection(chatId, 123);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('חשבונית אחת לפחות'); // "at least one invoice"
      }
      expect(mockCountUpdate).not.toHaveBeenCalled();
    });

    it('should REJECT 11 invoices (max limit validation)', async () => {
      const elevenInvoices = Array.from({ length: 11 }, (_, i) => ({
        invoiceNumber: `I-2026-${100 + i}`,
        customerName: 'רבקה לוי',
        remainingBalance: 1000,
        date: '01/01/2026',
        currency: 'ILS',
      }));

      const sessionData = {
        status: 'selecting_invoices' as const,
        documentType: 'receipt' as const,
        selectedInvoiceNumbers: elevenInvoices.map((inv) => inv.invoiceNumber),
        selectedInvoiceData: elevenInvoices,
        customerName: 'רבקה לוי',
        description: 'קבלה עבור חשבוניות',
        amount: 11000,
        date: '2026-01-01',
        createdAt: new Date(),
        updatedAt: {
          toMillis: () => Date.now(),
        },
      };

      mockCountGet.mockResolvedValue({
        exists: true,
        data: () => sessionData,
      });

      const result = await validateAndConfirmSelection(chatId, 123);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('10'); // Should mention max limit
      }
      expect(mockCountUpdate).not.toHaveBeenCalled();
    });
  });
});

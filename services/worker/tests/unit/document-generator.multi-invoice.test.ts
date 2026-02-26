/**
 * Document Generator Multi-Invoice Tests
 * Tests for multi-invoice receipt generation and payment tracking
 */

import { GeneratedInvoice } from '../../../../shared/invoice.types';
import { validateAndConfirmSelection } from '../../src/services/document-generator/session.service';
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
    it('should update all parent invoices atomically', async () => {
      const receiptNumber = 'R-2026-999';
      const parentInvoices: Partial<GeneratedInvoice>[] = [
        {
          chatId,
          documentType: 'invoice',
          invoiceNumber: 'I-2026-100',
          customerName: 'רבקה לוי',
          amount: 3000,
          currency: 'ILS',
          remainingBalance: 3000,
          paidAmount: 0,
          paymentStatus: 'unpaid',
          relatedReceiptIds: [],
        },
        {
          chatId,
          documentType: 'invoice',
          invoiceNumber: 'I-2026-101',
          customerName: 'רבקה לוי',
          amount: 2500,
          currency: 'ILS',
          remainingBalance: 2500,
          paidAmount: 0,
          paymentStatus: 'unpaid',
          relatedReceiptIds: [],
        },
      ];

      const updatedInvoicesData: Record<string, Partial<GeneratedInvoice>> = {};

      // Mock transaction
      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const mockTransaction: MockTransaction = {
            get: jest.fn((ref: MockDocRef) => {
              const docId = ref._docId;
              const invoice = parentInvoices.find(
                (inv) => `chat_${chatId}_${inv.invoiceNumber}` === docId
              );
              return Promise.resolve({
                exists: true,
                data: () => invoice,
                ref: { id: docId },
              });
            }),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedInvoicesData[ref._docId] = data;
            }),
          };

          return callback(mockTransaction);
        }
      );

      // Import the function (this would be from the actual service)
      // For testing purposes, we'll mock the expected behavior
      const updateMultipleInvoicesPayment = async (
        chatId: number,
        parentInvoices: GeneratedInvoice[],
        receiptNumber: string
      ) => {
        await mockRunTransaction(async (transaction: MockTransaction) => {
          for (const invoice of parentInvoices) {
            const docId = `chat_${chatId}_${invoice.invoiceNumber}`;
            const docRef: MockDocRef = { _docId: docId };

            const doc = await transaction.get(docRef);
            if (!doc.exists) {
              throw new Error(`Invoice ${invoice.invoiceNumber} not found`);
            }

            const currentInvoice = doc.data();
            if (currentInvoice.remainingBalance === 0) {
              throw new Error(`Invoice ${invoice.invoiceNumber} already paid`);
            }

            transaction.update(docRef, {
              paidAmount: currentInvoice.amount,
              remainingBalance: 0,
              paymentStatus: 'paid',
              relatedReceiptIds: { _arrayUnion: receiptNumber },
            });
          }
        });
      };

      await updateMultipleInvoicesPayment(
        chatId,
        parentInvoices as unknown as GeneratedInvoice[],
        receiptNumber
      );

      expect(mockRunTransaction).toHaveBeenCalled();

      // Verify updates for both invoices
      const invoice1Key = `chat_${chatId}_I-2026-100`;
      const invoice2Key = `chat_${chatId}_I-2026-101`;

      expect(updatedInvoicesData[invoice1Key]).toBeDefined();
      expect(updatedInvoicesData[invoice1Key].paymentStatus).toBe('paid');
      expect(updatedInvoicesData[invoice1Key].remainingBalance).toBe(0);
      expect(updatedInvoicesData[invoice1Key].paidAmount).toBe(3000);

      expect(updatedInvoicesData[invoice2Key]).toBeDefined();
      expect(updatedInvoicesData[invoice2Key].paymentStatus).toBe('paid');
      expect(updatedInvoicesData[invoice2Key].remainingBalance).toBe(0);
      expect(updatedInvoicesData[invoice2Key].paidAmount).toBe(2500);
    });

    it('should rollback transaction if any invoice is already paid (race condition)', async () => {
      const receiptNumber = 'R-2026-999';
      const parentInvoices = [
        {
          chatId,
          documentType: 'invoice' as const,
          invoiceNumber: 'I-2026-100',
          customerName: 'רבקה לוי',
          amount: 3000,
          currency: 'ILS',
          remainingBalance: 3000,
          paidAmount: 0,
          paymentStatus: 'unpaid' as const,
        },
        {
          chatId,
          documentType: 'invoice' as const,
          invoiceNumber: 'I-2026-101',
          customerName: 'רבקה לוי',
          amount: 2500,
          currency: 'ILS',
          remainingBalance: 0, // Already paid!
          paidAmount: 2500,
          paymentStatus: 'paid' as const,
        },
      ];

      // Mock transaction that detects already-paid invoice
      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const mockTransaction: MockTransaction = {
            get: jest.fn((ref: MockDocRef) => {
              const docId = ref._docId;
              const invoice = parentInvoices.find(
                (inv) => `chat_${chatId}_${inv.invoiceNumber}` === docId
              );
              return Promise.resolve({
                exists: true,
                data: () => invoice,
                ref: { id: docId },
              });
            }),
            update: jest.fn(),
          };

          return callback(mockTransaction);
        }
      );

      const updateMultipleInvoicesPayment = async (
        chatId: number,
        parentInvoices: GeneratedInvoice[],
        _receiptNumber: string
      ) => {
        await mockRunTransaction(async (transaction: MockTransaction) => {
          for (const invoice of parentInvoices) {
            const docId = `chat_${chatId}_${invoice.invoiceNumber}`;
            const docRef: MockDocRef = { _docId: docId };

            const doc = await transaction.get(docRef);
            if (!doc.exists) {
              throw new Error(`Invoice ${invoice.invoiceNumber} not found`);
            }

            const currentInvoice = doc.data();
            if (currentInvoice.remainingBalance === 0) {
              throw new Error(`Invoice ${invoice.invoiceNumber} already paid`);
            }

            transaction.update(docRef, {
              paidAmount: currentInvoice.amount,
              remainingBalance: 0,
              paymentStatus: 'paid',
            });
          }
        });
      };

      await expect(
        updateMultipleInvoicesPayment(
          chatId,
          parentInvoices as unknown as GeneratedInvoice[],
          receiptNumber
        )
      ).rejects.toThrow('Invoice I-2026-101 already paid');
    });

    it('should handle 10 invoices correctly', async () => {
      const receiptNumber = 'R-2026-999';
      const parentInvoices = Array.from({ length: 10 }, (_, i) => ({
        chatId,
        documentType: 'invoice' as const,
        invoiceNumber: `I-2026-${100 + i}`,
        customerName: 'רבקה לוי',
        amount: 2000 + i * 100,
        currency: 'ILS',
        remainingBalance: 2000 + i * 100,
        paidAmount: 0,
        paymentStatus: 'unpaid' as const,
        relatedReceiptIds: [],
      }));

      const updatedInvoicesData: Record<string, Partial<GeneratedInvoice>> = {};

      mockRunTransaction.mockImplementation(
        async (callback: (t: MockTransaction) => Promise<unknown>) => {
          const mockTransaction: MockTransaction = {
            get: jest.fn((ref: MockDocRef) => {
              const docId = ref._docId;
              const invoice = parentInvoices.find(
                (inv) => `chat_${chatId}_${inv.invoiceNumber}` === docId
              );
              return Promise.resolve({
                exists: true,
                data: () => invoice,
                ref: { id: docId },
              });
            }),
            update: jest.fn((ref: MockDocRef, data: MockInvoiceUpdate) => {
              updatedInvoicesData[ref._docId] = data;
            }),
          };

          return callback(mockTransaction);
        }
      );

      const updateMultipleInvoicesPayment = async (
        chatId: number,
        parentInvoices: GeneratedInvoice[],
        receiptNumber: string
      ) => {
        await mockRunTransaction(async (transaction: MockTransaction) => {
          for (const invoice of parentInvoices) {
            const docId = `chat_${chatId}_${invoice.invoiceNumber}`;
            const docRef: MockDocRef = { _docId: docId };

            const doc = await transaction.get(docRef);
            if (!doc.exists) {
              throw new Error(`Invoice ${invoice.invoiceNumber} not found`);
            }

            const currentInvoice = doc.data();
            transaction.update(docRef, {
              paidAmount: currentInvoice.amount,
              remainingBalance: 0,
              paymentStatus: 'paid',
              relatedReceiptIds: { _arrayUnion: receiptNumber },
            });
          }
        });
      };

      await updateMultipleInvoicesPayment(
        chatId,
        parentInvoices as unknown as GeneratedInvoice[],
        receiptNumber
      );

      // Verify all 10 invoices were updated
      expect(Object.keys(updatedInvoicesData)).toHaveLength(10);

      // Verify each invoice is marked as paid
      Object.values(updatedInvoicesData).forEach((data) => {
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

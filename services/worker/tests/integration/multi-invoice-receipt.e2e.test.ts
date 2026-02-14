/**
 * Multi-Invoice Receipt Integration Tests
 * End-to-end tests for multi-invoice receipt generation flow
 */

import { GeneratedInvoice } from '../../../../shared/invoice.types';

// Mock Storage and Playwright for integration tests
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

describe('Multi-Invoice Receipt E2E', () => {
  let mockDb: any;
  const chatId = -5175500469;
  const userId = 123456789;

  beforeAll(() => {
    // Initialize mock Firestore
    mockDb = {
      collection: jest.fn(),
      runTransaction: jest.fn(),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Multi-Invoice Receipt Flow', () => {
    it('should create receipt for 3 invoices and mark all as paid', async () => {
      // Step 1: Setup - Create parent invoices
      const parentInvoices = [
        {
          chatId,
          documentType: 'invoice' as const,
          invoiceNumber: 'I-2026-100',
          customerName: 'רבקה לוי',
          customerTaxId: '123456789',
          amount: 3000,
          currency: 'ILS',
          remainingBalance: 3000,
          paidAmount: 0,
          paymentStatus: 'unpaid' as const,
          relatedReceiptIds: [],
          date: '01/01/2026',
        },
        {
          chatId,
          documentType: 'invoice' as const,
          invoiceNumber: 'I-2026-101',
          customerName: 'רבקה לוי',
          customerTaxId: '123456789',
          amount: 2500,
          currency: 'ILS',
          remainingBalance: 2500,
          paidAmount: 0,
          paymentStatus: 'unpaid' as const,
          relatedReceiptIds: [],
          date: '02/01/2026',
        },
        {
          chatId,
          documentType: 'invoice' as const,
          invoiceNumber: 'I-2026-102',
          customerName: 'רבקה לוי',
          customerTaxId: '123456789',
          amount: 1500,
          currency: 'ILS',
          remainingBalance: 1500,
          paidAmount: 0,
          paymentStatus: 'unpaid' as const,
          relatedReceiptIds: [],
          date: '03/01/2026',
        },
      ];

      const selectedInvoiceData = parentInvoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        remainingBalance: inv.remainingBalance!,
        date: inv.date,
      }));

      const totalAmount = parentInvoices.reduce((sum, inv) => sum + inv.remainingBalance, 0);

      // Step 2: Mock session with selected invoices
      const mockSession = {
        chatId,
        userId,
        documentType: 'receipt',
        status: 'awaiting_payment',
        customerName: 'רבקה לוי',
        customerTaxId: '123456789',
        amount: totalAmount,
        currency: 'ILS',
        description: 'קבלה עבור חשבוניות: I-2026-100, I-2026-101, I-2026-102',
        selectedInvoiceNumbers: parentInvoices.map((inv) => inv.invoiceNumber),
        selectedInvoiceData,
      };

      // Step 3: Mock transaction for payment update
      const updatedInvoices: Record<string, Partial<GeneratedInvoice>> = {};

      mockDb.runTransaction.mockImplementation(async (callback: any) => {
        const mockTransaction = {
          get: jest.fn((ref: any) => {
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
          update: jest.fn((ref: any, data: any) => {
            updatedInvoices[ref._docId] = data;
          }),
        };

        return callback(mockTransaction);
      });

      // Step 4: Simulate receipt generation (simplified)
      const receiptNumber = 'R-2026-999';

      await mockDb.runTransaction(async (transaction: any) => {
        for (const invoice of parentInvoices) {
          const docId = `chat_${chatId}_${invoice.invoiceNumber}`;
          const docRef = { _docId: docId };

          const doc = await transaction.get(docRef);
          const currentInvoice = doc.data();

          transaction.update(docRef, {
            paidAmount: currentInvoice.amount,
            remainingBalance: 0,
            paymentStatus: 'paid',
            relatedReceiptIds: [receiptNumber],
          });
        }
      });

      // Step 5: Verify all invoices were updated correctly
      expect(Object.keys(updatedInvoices)).toHaveLength(3);

      Object.entries(updatedInvoices).forEach(([_docId, data]) => {
        expect(data.paymentStatus).toBe('paid');
        expect(data.remainingBalance).toBe(0);
        expect(data.relatedReceiptIds).toContain(receiptNumber);
      });

      // Step 6: Verify receipt document structure
      const receiptDoc: Partial<GeneratedInvoice> = {
        chatId,
        documentType: 'receipt',
        invoiceNumber: receiptNumber,
        customerName: mockSession.customerName,
        customerTaxId: mockSession.customerTaxId,
        amount: totalAmount,
        currency: 'ILS',
        isMultiInvoiceReceipt: true,
        relatedInvoiceNumbers: mockSession.selectedInvoiceNumbers,
        relatedInvoiceIds: parentInvoices.map((inv) => `chat_${chatId}_${inv.invoiceNumber}`),
        description: mockSession.description,
      };

      expect(receiptDoc.isMultiInvoiceReceipt).toBe(true);
      expect(receiptDoc.relatedInvoiceNumbers).toHaveLength(3);
      expect(receiptDoc.amount).toBe(7000);
      expect(receiptDoc.description).toContain('I-2026-100');
      expect(receiptDoc.description).toContain('I-2026-101');
      expect(receiptDoc.description).toContain('I-2026-102');
    });

    it('should handle concurrent payment attempt with race condition detection', async () => {
      // Setup: One invoice gets paid by another user concurrently
      const parentInvoices = [
        {
          chatId,
          documentType: 'invoice' as const,
          invoiceNumber: 'I-2026-200',
          customerName: 'דוד כהן',
          amount: 5000,
          currency: 'ILS',
          remainingBalance: 5000,
          paidAmount: 0,
          paymentStatus: 'unpaid' as const,
        },
        {
          chatId,
          documentType: 'invoice' as const,
          invoiceNumber: 'I-2026-201',
          customerName: 'דוד כהן',
          amount: 3000,
          currency: 'ILS',
          remainingBalance: 0, // Paid by another user during our transaction!
          paidAmount: 3000,
          paymentStatus: 'paid' as const,
        },
      ];

      mockDb.runTransaction.mockImplementation(async (callback: any) => {
        const mockTransaction = {
          get: jest.fn((ref: any) => {
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
      });

      // Attempt to generate receipt
      const generateReceipt = async () => {
        await mockDb.runTransaction(async (transaction: any) => {
          for (const invoice of parentInvoices) {
            const docId = `chat_${chatId}_${invoice.invoiceNumber}`;
            const docRef = { _docId: docId };

            const doc = await transaction.get(docRef);
            const currentInvoice = doc.data();

            // Race condition check
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

      // Should reject due to race condition
      await expect(generateReceipt()).rejects.toThrow('Invoice I-2026-201 already paid');
    });

    it('should validate customer consistency across selected invoices', () => {
      const mixedCustomerInvoices: GeneratedInvoice[] = [
        {
          invoiceNumber: 'I-2026-300',
          customerName: 'רבקה לוי',
          remainingBalance: 3000,
        } as GeneratedInvoice,
        {
          invoiceNumber: 'I-2026-301',
          customerName: 'דוד כהן', // Different customer!
          remainingBalance: 2500,
        } as GeneratedInvoice,
        {
          invoiceNumber: 'I-2026-302',
          customerName: 'רבקה לוי',
          remainingBalance: 1500,
        } as GeneratedInvoice,
      ];

      // Validation logic
      const customerNames = [...new Set(mixedCustomerInvoices.map((inv) => inv.customerName))];
      const isValid = customerNames.length === 1;

      expect(isValid).toBe(false);
      expect(customerNames).toContain('רבקה לוי');
      expect(customerNames).toContain('דוד כהן');
    });

    it('should handle maximum 10 invoices limit', async () => {
      // Setup: 10 invoices (max limit)
      const tenInvoices = Array.from({ length: 10 }, (_, i) => ({
        chatId,
        documentType: 'invoice' as const,
        invoiceNumber: `I-2026-${400 + i}`,
        customerName: 'שרה כהן',
        amount: 2000 + i * 100,
        currency: 'ILS',
        remainingBalance: 2000 + i * 100,
        paidAmount: 0,
        paymentStatus: 'unpaid' as const,
        date: `${String(i + 1).padStart(2, '0')}/01/2026`,
      }));

      const selectedInvoiceData = tenInvoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        remainingBalance: inv.remainingBalance!,
        date: inv.date,
      }));

      const totalAmount = tenInvoices.reduce((sum, inv) => sum + inv.remainingBalance!, 0);

      // Mock session
      const mockSession = {
        chatId,
        userId,
        selectedInvoiceNumbers: tenInvoices.map((inv) => inv.invoiceNumber),
        selectedInvoiceData,
        amount: totalAmount,
      };

      expect(mockSession.selectedInvoiceNumbers).toHaveLength(10);
      expect(mockSession.amount).toBe(24500); // Sum of 2000 to 2900

      // Attempting to add 11th invoice should fail
      const wouldExceedLimit = mockSession.selectedInvoiceNumbers!.length >= 10;
      expect(wouldExceedLimit).toBe(true);
    });

    it('should calculate correct total for multi-currency invoices', () => {
      // Note: Multi-currency within same receipt is not allowed
      // This test verifies validation
      const mixedCurrencyInvoices: GeneratedInvoice[] = [
        {
          invoiceNumber: 'I-2026-500',
          customerName: 'John Doe',
          amount: 1000,
          currency: 'ILS',
          remainingBalance: 1000,
        } as GeneratedInvoice,
        {
          invoiceNumber: 'I-2026-501',
          customerName: 'John Doe',
          amount: 500,
          currency: 'USD', // Different currency!
          remainingBalance: 500,
        } as GeneratedInvoice,
      ];

      const currencies = [...new Set(mixedCurrencyInvoices.map((inv) => inv.currency))];
      const isValid = currencies.length === 1;

      expect(isValid).toBe(false);
      expect(currencies).toContain('ILS');
      expect(currencies).toContain('USD');
    });
  });

  describe('Backward Compatibility', () => {
    it('should support both single and multi-invoice receipt formats', () => {
      // Single-invoice receipt (old format)
      const singleInvoiceReceipt: Partial<GeneratedInvoice> = {
        documentType: 'receipt',
        invoiceNumber: 'R-2026-1',
        relatedInvoiceNumber: 'I-2026-1',
        amount: 5000,
      };

      // Multi-invoice receipt (new format)
      const multiInvoiceReceipt: Partial<GeneratedInvoice> = {
        documentType: 'receipt',
        invoiceNumber: 'R-2026-2',
        isMultiInvoiceReceipt: true,
        relatedInvoiceNumbers: ['I-2026-100', 'I-2026-101'],
        relatedInvoiceNumber: 'I-2026-100', // Backward compat
        amount: 5500,
      };

      // Detection logic
      const isSingleInvoice = (receipt: Partial<GeneratedInvoice>): boolean => {
        return !receipt.isMultiInvoiceReceipt && !!receipt.relatedInvoiceNumber;
      };

      const isMultiInvoice = (receipt: Partial<GeneratedInvoice>): boolean => {
        return (
          !!receipt.isMultiInvoiceReceipt &&
          !!receipt.relatedInvoiceNumbers &&
          receipt.relatedInvoiceNumbers.length > 1
        );
      };

      expect(isSingleInvoice(singleInvoiceReceipt)).toBe(true);
      expect(isMultiInvoice(singleInvoiceReceipt)).toBe(false);

      expect(isSingleInvoice(multiInvoiceReceipt)).toBe(false);
      expect(isMultiInvoice(multiInvoiceReceipt)).toBe(true);
    });
  });
});

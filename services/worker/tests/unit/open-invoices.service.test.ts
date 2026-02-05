/**
 * Open Invoices Service Tests
 * Tests for querying unpaid/partially paid invoices
 */

import { Firestore } from '@google-cloud/firestore';
import {
  getOpenInvoices,
  formatInvoiceForButton,
} from '../../src/services/invoice-generator/open-invoices.service';

// Mock Firestore
const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockOrderBy = jest.fn(() => ({ limit: mockLimit }));

// Create whereChain that supports multiple .where() calls
const whereChain = {
  where: jest.fn(),
  orderBy: mockOrderBy,
};
whereChain.where.mockImplementation(() => whereChain);

const mockWhere = jest.fn(() => whereChain);
const mockCollection = jest.fn(() => ({ where: mockWhere }));

const mockFirestore = {
  collection: mockCollection,
} as unknown as Firestore;

jest.mock('@google-cloud/firestore', () => {
  return {
    Firestore: jest.fn(() => mockFirestore),
  };
});

describe('open-invoices.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOpenInvoices', () => {
    it('should return empty array when no open invoices found', async () => {
      mockGet.mockResolvedValue({
        empty: true,
        docs: [],
      });

      const result = await getOpenInvoices(123456);

      expect(result).toEqual([]);
      expect(mockCollection).toHaveBeenCalledWith('generated_invoices');
    });

    it('should return open invoices with remaining balance', async () => {
      const mockDocs = [
        {
          id: 'chat_123_I-2026-1',
          data: () => ({
            invoiceNumber: 'I-2026-1',
            customerName: 'John Doe',
            amount: 1000,
            paidAmount: 0,
            remainingBalance: 1000,
            date: '05/02/2026',
          }),
        },
        {
          id: 'chat_123_I-2026-2',
          data: () => ({
            invoiceNumber: 'I-2026-2',
            customerName: 'Jane Smith',
            amount: 500,
            paidAmount: 200,
            remainingBalance: 300,
            date: '04/02/2026',
          }),
        },
      ];

      mockGet.mockResolvedValue({
        empty: false,
        docs: mockDocs,
      });

      const result = await getOpenInvoices(123456);

      expect(result).toHaveLength(2);
      expect(result[0].invoiceNumber).toBe('I-2026-1');
      expect(result[0].remainingBalance).toBe(1000);
      expect(result[1].invoiceNumber).toBe('I-2026-2');
      expect(result[1].remainingBalance).toBe(300);
    });

    it('should filter out invoices with zero remaining balance', async () => {
      const mockDocs = [
        {
          id: 'chat_123_I-2026-1',
          data: () => ({
            invoiceNumber: 'I-2026-1',
            customerName: 'John Doe',
            amount: 1000,
            paidAmount: 1000,
            remainingBalance: 0, // Fully paid
            date: '05/02/2026',
          }),
        },
        {
          id: 'chat_123_I-2026-2',
          data: () => ({
            invoiceNumber: 'I-2026-2',
            customerName: 'Jane Smith',
            amount: 500,
            paidAmount: 200,
            remainingBalance: 300,
            date: '04/02/2026',
          }),
        },
      ];

      mockGet.mockResolvedValue({
        empty: false,
        docs: mockDocs,
      });

      const result = await getOpenInvoices(123456);

      expect(result).toHaveLength(1);
      expect(result[0].invoiceNumber).toBe('I-2026-2');
    });

    it('should handle missing data gracefully', async () => {
      const mockDocs = [
        {
          id: 'chat_123_I-2026-1',
          data: () => ({
            // Missing invoiceNumber - should fall back to doc.id
            customerName: 'John Doe',
            amount: 1000,
            paidAmount: 0,
            remainingBalance: 1000, // Must have remaining balance to be included
            date: '05/02/2026',
          }),
        },
      ];

      mockGet.mockResolvedValue({
        empty: false,
        docs: mockDocs,
      });

      const result = await getOpenInvoices(123456);

      expect(result).toHaveLength(1);
      expect(result[0].invoiceNumber).toBe('chat_123_I-2026-1'); // Falls back to doc.id
      expect(result[0].remainingBalance).toBe(1000);
    });
  });

  describe('formatInvoiceForButton', () => {
    it('should format invoice for keyboard button', () => {
      const invoice = {
        invoiceNumber: 'I-2026-5',
        customerName: 'John Doe',
        amount: 1000,
        paidAmount: 0,
        remainingBalance: 1000,
        date: '05/02/2026',
      };

      const result = formatInvoiceForButton(invoice);

      expect(result).toBe('I-2026-5 | John Doe | ₪1000');
    });

    it('should handle partial payments', () => {
      const invoice = {
        invoiceNumber: 'I-2026-10',
        customerName: 'Jane Smith',
        amount: 500,
        paidAmount: 200,
        remainingBalance: 300,
        date: '04/02/2026',
      };

      const result = formatInvoiceForButton(invoice);

      expect(result).toBe('I-2026-10 | Jane Smith | ₪300');
    });
  });
});

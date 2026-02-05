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
jest.mock('@google-cloud/firestore');

describe('open-invoices.service', () => {
  let mockFirestore: jest.Mocked<Firestore>;
  let mockCollection: jest.Mock;
  let mockWhere: jest.Mock;
  let mockOrderBy: jest.Mock;
  let mockLimit: jest.Mock;
  let mockGet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Firestore mock chain
    mockGet = jest.fn();
    mockLimit = jest.fn().mockReturnValue({ get: mockGet });
    mockOrderBy = jest.fn().mockReturnValue({ limit: mockLimit });

    // Mock where() to return an object with another where() method for chaining
    const whereChain = {
      where: jest.fn(),
      orderBy: mockOrderBy,
    };
    whereChain.where.mockReturnValue(whereChain);

    mockWhere = jest.fn().mockReturnValue(whereChain);
    mockCollection = jest.fn().mockReturnValue({ where: mockWhere });

    mockFirestore = {
      collection: mockCollection,
    } as unknown as jest.Mocked<Firestore>;

    (Firestore as jest.MockedClass<typeof Firestore>).mockImplementation(() => mockFirestore);
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

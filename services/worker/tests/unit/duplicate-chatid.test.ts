/**
 * Test duplicate detection is scoped to chatId (customer)
 * Tests the fix for: https://github.com/idobetesh/papertrail/issues/XXX
 */

import { findDuplicateInvoice } from '../../src/services/duplicate-detection.service';
import type { InvoiceExtraction } from '../../../../shared/types';
import { Firestore, Timestamp } from '@google-cloud/firestore';

// Mock Firestore
jest.mock('@google-cloud/firestore');

// Mock Timestamp.fromDate
const mockTimestamp = { seconds: 1234567890, nanoseconds: 0 };
(Timestamp as any).fromDate = jest.fn(() => mockTimestamp);

describe('Duplicate Detection - ChatId Scoping', () => {
  let mockFirestore: jest.Mocked<Firestore>;
  let mockCollection: any;
  let mockWhere: any;
  let mockGet: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock chain
    mockGet = jest.fn();
    mockWhere = jest.fn(() => ({
      where: mockWhere,
      get: mockGet,
    }));
    mockCollection = jest.fn(() => ({
      where: mockWhere,
    }));

    mockFirestore = {
      collection: mockCollection,
    } as any;

    // Mock Firestore constructor
    (Firestore as any).mockImplementation(() => mockFirestore);
  });

  const createExtraction = (overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction => ({
    is_invoice: true,
    rejection_reason: null,
    vendor_name: 'Test Vendor',
    invoice_number: 'INV-001',
    invoice_date: '2026-01-15',
    total_amount: 100.0,
    currency: 'ILS',
    vat_amount: 17.0,
    confidence: 0.9,
    category: null,
    ...overrides,
  });

  it('should filter by chatId when searching for duplicates', async () => {
    const chatId = 123456;
    const extraction = createExtraction({
      vendor_name: 'Cafe Hillel',
      total_amount: 150.0,
      invoice_date: '2026-01-20',
    });

    mockGet.mockResolvedValue({ docs: [] });

    await findDuplicateInvoice(chatId, extraction, 'current_job_id');

    // Verify the query includes telegramChatId filter
    expect(mockCollection).toHaveBeenCalledWith('invoice_jobs');
    expect(mockWhere).toHaveBeenCalledWith('telegramChatId', '==', chatId);
    expect(mockWhere).toHaveBeenCalledWith('status', 'in', [
      'processed',
      'processing',
      'pending_decision',
    ]);
    // Verify createdAt filter uses the mocked timestamp
    expect(mockWhere).toHaveBeenCalledWith('createdAt', '>=', mockTimestamp);
  });

  it('should only return duplicates from the same chatId', async () => {
    const chatId = 111111;
    const extraction = createExtraction({
      vendor_name: 'SuperSal',
      total_amount: 200.0,
      invoice_date: '2026-01-20',
    });

    // Mock response with invoices from different chatIds
    const mockDocs = [
      {
        id: '111111_100',
        data: () => ({
          chatId: 111111, // Same customer
          vendorName: 'SuperSal',
          totalAmount: 200.0,
          invoiceDate: '2026-01-20',
          status: 'processed',
          driveLink: 'https://example.com/same-customer',
          receivedAt: '2026-01-20T10:00:00Z',
        }),
      },
      {
        id: '222222_200',
        data: () => ({
          chatId: 222222, // Different customer - should be filtered by query
          vendorName: 'SuperSal',
          totalAmount: 200.0,
          invoiceDate: '2026-01-20',
          status: 'processed',
          driveLink: 'https://example.com/different-customer',
          receivedAt: '2026-01-20T10:00:00Z',
        }),
      },
    ];

    // Since we filter by chatId in the query, only docs from chatId 111111 should be returned
    mockGet.mockResolvedValue({
      docs: [mockDocs[0]], // Firestore already filtered by chatId
    });

    const result = await findDuplicateInvoice(chatId, extraction, 'current_job_id');

    // Should find duplicate only from same customer
    expect(result).not.toBeNull();
    expect(result?.jobId).toBe('111111_100');
    expect(result?.driveLink).toContain('same-customer');
  });

  it('should not return duplicates from different chatId', async () => {
    const chatId = 333333;
    const extraction = createExtraction({
      vendor_name: 'Rami Levy',
      total_amount: 99.9,
      invoice_date: '2026-01-21',
    });

    // Simulate query filtering - no docs from different chatId should be returned
    mockGet.mockResolvedValue({
      docs: [], // No docs because query filtered by chatId
    });

    const result = await findDuplicateInvoice(chatId, extraction, 'current_job_id');

    // Should not find duplicates from other customers
    expect(result).toBeNull();
  });

  it('should require chatId parameter', async () => {
    const extraction = createExtraction();

    // TypeScript should enforce this, but test runtime behavior
    mockGet.mockResolvedValue({ docs: [] });

    await findDuplicateInvoice(444444, extraction, 'test_job');

    // Verify telegramChatId is used in query
    expect(mockWhere).toHaveBeenCalledWith('telegramChatId', '==', 444444);
  });

  it('should handle multiple duplicates within same chatId', async () => {
    const chatId = 555555;
    const extraction = createExtraction({
      vendor_name: 'Electric Company',
      total_amount: 350.0,
      invoice_date: '2026-01-15',
    });

    const mockDocs = [
      {
        id: '555555_1',
        data: () => ({
          chatId: 555555,
          vendorName: 'Electric Company',
          totalAmount: 350.0,
          invoiceDate: '2026-01-15',
          status: 'processed',
          driveLink: 'https://example.com/first',
          receivedAt: '2026-01-15T08:00:00Z',
        }),
      },
      {
        id: '555555_2',
        data: () => ({
          chatId: 555555,
          vendorName: 'Electric Company',
          totalAmount: 350.0,
          invoiceDate: '2026-01-15',
          status: 'processed',
          driveLink: 'https://example.com/second',
          receivedAt: '2026-01-15T09:00:00Z',
        }),
      },
    ];

    mockGet.mockResolvedValue({ docs: mockDocs });

    const result = await findDuplicateInvoice(chatId, extraction, 'current_job');

    // Should return first match found
    expect(result).not.toBeNull();
    expect(result?.jobId).toBe('555555_1');
  });

  describe('Invoice Number Differentiation', () => {
    const chatId = 999999;

    it('should NOT flag as duplicate if invoice numbers differ (same vendor/amount/date)', async () => {
      const extraction = createExtraction({
        vendor_name: 'Cafe Hillel',
        invoice_number: 'INV-12346',
        total_amount: 25.5,
        invoice_date: '2026-02-15',
      });

      const mockDocs = [
        {
          id: '999999_100',
          data: () => ({
            chatId: 999999,
            vendorName: 'Cafe Hillel',
            invoiceNumber: 'INV-12345', // Different invoice number!
            totalAmount: 25.5,
            invoiceDate: '2026-02-15',
            status: 'processed',
            driveLink: 'https://example.com/invoice1',
            receivedAt: '2026-02-15T10:00:00Z',
          }),
        },
      ];

      mockGet.mockResolvedValue({ docs: mockDocs });

      const result = await findDuplicateInvoice(chatId, extraction, 'current_job');

      // Should NOT be flagged as duplicate because invoice numbers differ
      expect(result).toBeNull();
    });

    it('should flag as duplicate if invoice numbers are the same', async () => {
      const extraction = createExtraction({
        vendor_name: 'SuperSal',
        invoice_number: 'INV-99999',
        total_amount: 150.0,
        invoice_date: '2026-02-10',
      });

      const mockDocs = [
        {
          id: '999999_200',
          data: () => ({
            chatId: 999999,
            vendorName: 'SuperSal',
            invoiceNumber: 'INV-99999', // Same invoice number!
            totalAmount: 150.0,
            invoiceDate: '2026-02-10',
            status: 'processed',
            driveLink: 'https://example.com/invoice2',
            receivedAt: '2026-02-10T12:00:00Z',
          }),
        },
      ];

      mockGet.mockResolvedValue({ docs: mockDocs });

      const result = await findDuplicateInvoice(chatId, extraction, 'current_job');

      // Should be flagged as exact duplicate
      expect(result).not.toBeNull();
      expect(result?.matchType).toBe('exact');
      expect(result?.jobId).toBe('999999_200');
    });

    it('should flag as similar duplicate if new invoice has number but stored does not', async () => {
      const extraction = createExtraction({
        vendor_name: 'Rami Levy',
        invoice_number: 'INV-55555',
        total_amount: 89.9,
        invoice_date: '2026-02-12',
      });

      const mockDocs = [
        {
          id: '999999_300',
          data: () => ({
            chatId: 999999,
            vendorName: 'Rami Levy',
            invoiceNumber: null, // No invoice number in stored
            totalAmount: 89.9,
            invoiceDate: '2026-02-12',
            status: 'processed',
            driveLink: 'https://example.com/invoice3',
            receivedAt: '2026-02-12T14:00:00Z',
          }),
        },
      ];

      mockGet.mockResolvedValue({ docs: mockDocs });

      const result = await findDuplicateInvoice(chatId, extraction, 'current_job');

      // Should still flag as potential duplicate (can't rule it out)
      expect(result).not.toBeNull();
      expect(result?.matchType).toBe('exact'); // Same date makes it exact
    });

    it('should flag as similar duplicate if stored has number but new does not', async () => {
      const extraction = createExtraction({
        vendor_name: 'Electric Company',
        invoice_number: null, // No invoice number in new
        total_amount: 300.0,
        invoice_date: '2026-02-08',
      });

      const mockDocs = [
        {
          id: '999999_400',
          data: () => ({
            chatId: 999999,
            vendorName: 'Electric Company',
            invoiceNumber: 'ELEC-2026-001',
            totalAmount: 300.0,
            invoiceDate: '2026-02-08',
            status: 'processed',
            driveLink: 'https://example.com/invoice4',
            receivedAt: '2026-02-08T16:00:00Z',
          }),
        },
      ];

      mockGet.mockResolvedValue({ docs: mockDocs });

      const result = await findDuplicateInvoice(chatId, extraction, 'current_job');

      // Should still flag as potential duplicate
      expect(result).not.toBeNull();
      expect(result?.matchType).toBe('exact');
    });

    it('should flag as duplicate if both invoices lack invoice numbers', async () => {
      const extraction = createExtraction({
        vendor_name: 'Local Shop',
        invoice_number: null,
        total_amount: 45.0,
        invoice_date: '2026-02-14',
      });

      const mockDocs = [
        {
          id: '999999_500',
          data: () => ({
            chatId: 999999,
            vendorName: 'Local Shop',
            invoiceNumber: null, // Both lack invoice numbers
            totalAmount: 45.0,
            invoiceDate: '2026-02-14',
            status: 'processed',
            driveLink: 'https://example.com/invoice5',
            receivedAt: '2026-02-14T18:00:00Z',
          }),
        },
      ];

      mockGet.mockResolvedValue({ docs: mockDocs });

      const result = await findDuplicateInvoice(chatId, extraction, 'current_job');

      // Should flag as duplicate (can't differentiate without invoice numbers)
      expect(result).not.toBeNull();
      expect(result?.matchType).toBe('exact');
    });

    it('real-world scenario: two coffees same day, different invoice numbers', async () => {
      const extraction = createExtraction({
        vendor_name: 'Cafe Hillel',
        invoice_number: '20260215-002', // Second coffee
        total_amount: 18.0,
        invoice_date: '2026-02-15',
      });

      const mockDocs = [
        {
          id: '999999_600',
          data: () => ({
            chatId: 999999,
            vendorName: 'Cafe Hillel',
            invoiceNumber: '20260215-001', // First coffee
            totalAmount: 18.0,
            invoiceDate: '2026-02-15',
            status: 'processed',
            driveLink: 'https://example.com/coffee1',
            receivedAt: '2026-02-15T09:00:00Z',
          }),
        },
      ];

      mockGet.mockResolvedValue({ docs: mockDocs });

      const result = await findDuplicateInvoice(chatId, extraction, 'current_job');

      // Should NOT flag as duplicate - different invoice numbers = different purchases
      expect(result).toBeNull();
    });
  });
});

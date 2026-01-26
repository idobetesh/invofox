/**
 * Test duplicate detection is scoped to chatId (customer)
 * Tests the fix for: https://github.com/idobetesh/papertrail/issues/XXX
 */

import { findDuplicateInvoice } from '../../src/services/store.service';
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

    // Verify the query includes chatId filter
    expect(mockCollection).toHaveBeenCalledWith('invoice_jobs');
    expect(mockWhere).toHaveBeenCalledWith('chatId', '==', chatId);
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'processed');
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

    // Verify chatId is used in query
    expect(mockWhere).toHaveBeenCalledWith('chatId', '==', 444444);
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
});

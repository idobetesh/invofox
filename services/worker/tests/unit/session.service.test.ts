/**
 * Session service tests
 * Tests for invoice generation session management
 */

import * as sessionService from '../../src/services/invoice-generator/session.service';

// Mock Firestore
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
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date()),
    },
    Timestamp: {
      fromDate: jest.fn((date) => createMockTimestamp(date)),
    },
  };
});

describe('Session Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('setDetails', () => {
    const chatId = 123456;
    const userId = 789012;

    it('should successfully set details without customerTaxId', async () => {
      const details = {
        customerName: 'John Doe',
        amount: 1009,
        description: 'Test description',
        // No customerTaxId provided
      };

      // Mock the read-after-write: return the updated session
      const now = new Date();
      const mockSession = {
        status: 'awaiting_payment',
        customerName: 'John Doe',
        description: 'Test description',
        amount: 1009,
        updatedAt: createMockTimestamp(now),
        createdAt: createMockTimestamp(now),
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.setDetails(chatId, userId, details);

      expect(mockCollection).toHaveBeenCalledWith('invoice_sessions');
      expect(mockDoc).toHaveBeenCalledWith(`${chatId}_${userId}`);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'awaiting_payment',
          customerName: 'John Doe',
          description: 'Test description',
          amount: 1009,
          updatedAt: expect.any(Date),
        })
      );

      // Verify customerTaxId is NOT in the update object
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall).not.toHaveProperty('customerTaxId');

      // Verify the function returns the updated session
      expect(result).toEqual(mockSession);
      expect(result).not.toHaveProperty('customerTaxId');
    });

    it('should successfully set details with customerTaxId', async () => {
      const details = {
        customerName: 'Jane Smith',
        amount: 275,
        description: 'Wedding album',
        customerTaxId: '123456789',
      };

      // Mock the read-after-write: return the updated session
      const now = new Date();
      const mockSession = {
        status: 'awaiting_payment',
        customerName: 'Jane Smith',
        description: 'Wedding album',
        amount: 275,
        customerTaxId: '123456789',
        updatedAt: createMockTimestamp(now),
        createdAt: createMockTimestamp(now),
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.setDetails(chatId, userId, details);

      expect(mockCollection).toHaveBeenCalledWith('invoice_sessions');
      expect(mockDoc).toHaveBeenCalledWith(`${chatId}_${userId}`);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'awaiting_payment',
          customerName: 'Jane Smith',
          description: 'Wedding album',
          amount: 275,
          customerTaxId: '123456789',
          updatedAt: expect.any(Date),
        })
      );

      // Verify the function returns the updated session
      expect(result).toEqual(mockSession);
      expect(result.customerTaxId).toBe('123456789');
    });

    it('should handle description with commas correctly', async () => {
      const details = {
        customerName: 'Bob Johnson',
        amount: 500,
        description: 'Photography, editing, and production',
        customerTaxId: '987654321',
      };

      // Mock the read-after-write
      const now = new Date();
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          status: 'awaiting_payment',
          customerName: 'Bob Johnson',
          description: 'Photography, editing, and production',
          amount: 500,
          customerTaxId: '987654321',
          updatedAt: createMockTimestamp(now),
          createdAt: createMockTimestamp(now),
        }),
      });

      const result = await sessionService.setDetails(chatId, userId, details);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Photography, editing, and production',
        })
      );

      expect(result.description).toBe('Photography, editing, and production');
    });

    it('should not include customerTaxId when explicitly undefined', async () => {
      const details = {
        customerName: 'Alice Williams',
        amount: 150,
        description: 'Graphic design',
        customerTaxId: undefined,
      };

      // Mock the read-after-write
      const now = new Date();
      const mockSession = {
        status: 'awaiting_payment',
        customerName: 'Alice Williams',
        description: 'Graphic design',
        amount: 150,
        updatedAt: createMockTimestamp(now),
        createdAt: createMockTimestamp(now),
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockSession,
      });

      const result = await sessionService.setDetails(chatId, userId, details);

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall).not.toHaveProperty('customerTaxId');

      // Verify the returned session also doesn't have customerTaxId
      expect(result).not.toHaveProperty('customerTaxId');
    });
  });
});

/**
 * Unit tests for Report Rate Limiter Service
 */

// Mock Firestore
const mockData: Record<string, any> = {};
const mockGet = jest.fn((docPath: string) => {
  return Promise.resolve({
    exists: !!mockData[docPath],
    data: () => mockData[docPath],
  });
});
const mockSet = jest.fn((docPath: string, data: any) => {
  mockData[docPath] = data;
  return Promise.resolve();
});
const mockUpdate = jest.fn((docPath: string, data: any) => {
  mockData[docPath] = { ...mockData[docPath], ...data };
  return Promise.resolve();
});

jest.mock('@google-cloud/firestore', () => {
  const mockDoc = (docId: string) => {
    const docPath = `rate_limits/${docId}`;
    return {
      get: () => mockGet(docPath),
      set: (data: any) => mockSet(docPath, data),
      update: (data: any) => mockUpdate(docPath, data),
    };
  };

  const mockCollection = () => ({ doc: mockDoc });

  return {
    Firestore: jest.fn(() => ({ collection: mockCollection })),
    Timestamp: {
      now: jest.fn(() => ({ toMillis: () => Date.now() })),
      fromDate: jest.fn((date: Date) => ({
        toMillis: () => date.getTime(),
        toDate: () => date,
      })),
    },
  };
});

import * as rateLimiter from '../../src/services/report/report-rate-limiter.service';

describe('Report Rate Limiter Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockData).forEach((key) => delete mockData[key]);
  });

  describe('checkReportLimit', () => {
    it('should allow first report', async () => {
      const result = await rateLimiter.checkReportLimit(-123456);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 3 per day - 1 = 2
    });

    it('should block when limit exceeded', async () => {
      const today = new Date().toISOString().split('T')[0];
      const resetAt = new Date();
      resetAt.setDate(resetAt.getDate() + 1);
      resetAt.setHours(0, 0, 0, 0);

      mockData['rate_limits/report_-123456'] = {
        chatId: -123456,
        lastReportDate: today,
        reportCount: 3,
        resetAt: { toDate: () => resetAt },
      };

      const result = await rateLimiter.checkReportLimit(-123456);

      expect(result.allowed).toBe(false);
      expect(result.resetAt).toEqual(resetAt);
      expect(result.remaining).toBe(0);
    });

    it('should reset counter on new day', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      mockData['rate_limits/report_-123456'] = {
        chatId: -123456,
        lastReportDate: yesterdayStr,
        reportCount: 1,
        resetAt: { toDate: () => new Date() },
      };

      const result = await rateLimiter.checkReportLimit(-123456);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should handle first report ever', async () => {
      const result = await rateLimiter.checkReportLimit(-999999);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
      expect(result.resetAt).toBeUndefined();
    });
  });

  describe('recordReportGeneration', () => {
    it('should create new record for first report', async () => {
      await rateLimiter.recordReportGeneration(-123456);

      expect(mockSet).toHaveBeenCalled();
      const docPath = mockSet.mock.calls[0][0];
      const data = mockSet.mock.calls[0][1];

      expect(docPath).toBe('rate_limits/report_-123456');
      expect(data.chatId).toBe(-123456);
      expect(data.reportCount).toBe(1);
      expect(data.lastReportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should increment count for subsequent reports', async () => {
      const today = new Date().toISOString().split('T')[0];
      mockData['rate_limits/report_-123456'] = {
        chatId: -123456,
        lastReportDate: today,
        reportCount: 0,
      };

      await rateLimiter.recordReportGeneration(-123456);

      expect(mockUpdate).toHaveBeenCalled();
      const data = mockUpdate.mock.calls[0][1];
      expect(data.reportCount).toBe(1);
    });

    it('should reset count on new day', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      mockData['rate_limits/report_-123456'] = {
        chatId: -123456,
        lastReportDate: yesterdayStr,
        reportCount: 5, // High count from yesterday
      };

      await rateLimiter.recordReportGeneration(-123456);

      // Should create new document (set, not update)
      expect(mockSet).toHaveBeenCalled();
      const data = mockSet.mock.calls[0][1];
      expect(data.reportCount).toBe(1); // Reset to 1
    });
  });
});

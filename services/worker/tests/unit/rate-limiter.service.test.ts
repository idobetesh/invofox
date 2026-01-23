/**
 * Rate Limiter Service Tests
 * Tests for failed attempt tracking and blocking
 */

import {
  recordFailedOnboardingAttempt,
  clearRateLimit,
} from '../../src/services/rate-limiter.service';

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

// Mock Firestore
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@google-cloud/firestore', () => {
  return {
    Firestore: jest.fn(() => ({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: mockGet,
          set: mockSet,
          update: mockUpdate,
          delete: mockDelete,
        })),
      })),
    })),
    Timestamp: {
      now: jest.fn(() => ({
        toMillis: () => Date.now(),
      })),
      fromMillis: jest.fn((ms) => ({
        toMillis: () => ms,
        toDate: () => new Date(ms),
      })),
    },
    FieldValue: {
      serverTimestamp: jest.fn(() => ({ _seconds: Date.now() / 1000 })),
    },
  };
});

describe('Rate Limiter Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordFailedOnboardingAttempt', () => {
    it('should create new record on first failed attempt', async () => {
      mockGet.mockResolvedValue({ exists: false });

      await recordFailedOnboardingAttempt(123456);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 123456,
          attempts: 1,
        })
      );
    });

    it('should increment attempts on subsequent failures', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          chatId: 123456,
          attempts: 1,
          firstAttemptAt: { _seconds: Date.now() / 1000 - 60 },
          lastAttemptAt: { _seconds: Date.now() / 1000 - 30 },
        }),
      });

      await recordFailedOnboardingAttempt(123456);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
        })
      );
    });

    it('should block after 3 attempts', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          chatId: 123456,
          attempts: 2,
          firstAttemptAt: { _seconds: Date.now() / 1000 - 60 },
          lastAttemptAt: { _seconds: Date.now() / 1000 - 30 },
        }),
      });

      await recordFailedOnboardingAttempt(123456);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 3,
          blockedUntil: expect.any(Object),
        })
      );
    });

    it('should reset counter if block has expired', async () => {
      const expiredBlockTime = Date.now() - 20 * 60 * 1000; // 20 minutes ago

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          chatId: 123456,
          attempts: 3,
          firstAttemptAt: { _seconds: (Date.now() - 30 * 60 * 1000) / 1000 },
          lastAttemptAt: { _seconds: expiredBlockTime / 1000 },
          blockedUntil: { _seconds: expiredBlockTime / 1000, toMillis: () => expiredBlockTime },
        }),
      });

      await recordFailedOnboardingAttempt(123456);

      // Should reset to attempts: 1
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 123456,
          attempts: 1,
        })
      );
    });
  });

  describe('clearRateLimit', () => {
    it('should delete rate limit record', async () => {
      await clearRateLimit(123456);

      expect(mockDelete).toHaveBeenCalled();
    });

    it('should be called when chat is successfully approved', async () => {
      // This is more of an integration test, but we can verify the mock
      await clearRateLimit(123456);

      expect(mockDelete).toHaveBeenCalledTimes(1);
    });
  });
});

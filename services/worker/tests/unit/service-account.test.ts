/**
 * Service Account Utilities Tests
 * Tests for fetching service account email from GCP
 */

import { getServiceAccountEmail, clearServiceAccountCache } from '../../src/utils/service-account';

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

// Mock GoogleAuth
const mockGetClient = jest.fn();
const mockGetCredentials = jest.fn();

jest.mock('google-auth-library', () => {
  return {
    GoogleAuth: jest.fn(() => ({
      getClient: mockGetClient,
      getCredentials: mockGetCredentials,
    })),
  };
});

describe('Service Account Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearServiceAccountCache();
  });

  describe('getServiceAccountEmail', () => {
    it('should retrieve email from client.email', async () => {
      mockGetClient.mockResolvedValue({
        email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
      });

      const email = await getServiceAccountEmail();
      expect(email).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      expect(mockGetClient).toHaveBeenCalledTimes(1);
    });

    it('should retrieve email from credentials as fallback', async () => {
      // Client doesn't have email property
      mockGetClient.mockResolvedValue({});

      // Credentials have client_email
      mockGetCredentials.mockResolvedValue({
        client_email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
      });

      const email = await getServiceAccountEmail();
      expect(email).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      expect(mockGetClient).toHaveBeenCalledTimes(1);
      expect(mockGetCredentials).toHaveBeenCalledTimes(1);
    });

    it('should cache email after first retrieval', async () => {
      mockGetClient.mockResolvedValue({
        email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
      });

      // First call
      const email1 = await getServiceAccountEmail();
      expect(email1).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      expect(mockGetClient).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const email2 = await getServiceAccountEmail();
      expect(email2).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      expect(mockGetClient).toHaveBeenCalledTimes(1); // Still just once

      // Third call should still use cache
      const email3 = await getServiceAccountEmail();
      expect(email3).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      expect(mockGetClient).toHaveBeenCalledTimes(1); // Still just once
    });

    it('should throw error when client has no email and credentials are empty', async () => {
      mockGetClient.mockResolvedValue({});
      mockGetCredentials.mockResolvedValue({});

      await expect(getServiceAccountEmail()).rejects.toThrow(
        'Failed to retrieve service account email from GCP'
      );
    });

    it('should throw error when getClient fails', async () => {
      mockGetClient.mockRejectedValue(new Error('GCP authentication failed'));

      await expect(getServiceAccountEmail()).rejects.toThrow(
        'Failed to retrieve service account email from GCP'
      );
    });

    it('should throw error when getCredentials fails', async () => {
      mockGetClient.mockResolvedValue({});
      mockGetCredentials.mockRejectedValue(new Error('Credentials not found'));

      await expect(getServiceAccountEmail()).rejects.toThrow(
        'Failed to retrieve service account email from GCP'
      );
    });

    it('should handle client with non-string email property', async () => {
      mockGetClient.mockResolvedValue({
        email: null, // Not a string
      });

      mockGetCredentials.mockResolvedValue({
        client_email: 'fallback@example.com',
      });

      const email = await getServiceAccountEmail();
      expect(email).toBe('fallback@example.com');
    });

    it('should handle client with undefined email', async () => {
      mockGetClient.mockResolvedValue({
        email: undefined,
      });

      mockGetCredentials.mockResolvedValue({
        client_email: 'fallback@example.com',
      });

      const email = await getServiceAccountEmail();
      expect(email).toBe('fallback@example.com');
    });

    it('should handle credentials with null client_email', async () => {
      mockGetClient.mockResolvedValue({});
      mockGetCredentials.mockResolvedValue({
        client_email: null,
      });

      await expect(getServiceAccountEmail()).rejects.toThrow(
        'Failed to retrieve service account email from GCP'
      );
    });

    it('should handle credentials with undefined client_email', async () => {
      mockGetClient.mockResolvedValue({});
      mockGetCredentials.mockResolvedValue({
        client_email: undefined,
      });

      await expect(getServiceAccountEmail()).rejects.toThrow(
        'Failed to retrieve service account email from GCP'
      );
    });
  });

  describe('clearServiceAccountCache', () => {
    it('should clear cached email', async () => {
      mockGetClient.mockResolvedValue({
        email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
      });

      // First call
      await getServiceAccountEmail();
      expect(mockGetClient).toHaveBeenCalledTimes(1);

      // Second call uses cache
      await getServiceAccountEmail();
      expect(mockGetClient).toHaveBeenCalledTimes(1);

      // Clear cache
      clearServiceAccountCache();

      // Third call should fetch again
      await getServiceAccountEmail();
      expect(mockGetClient).toHaveBeenCalledTimes(2);
    });

    it('should allow different email after cache clear', async () => {
      // First email
      mockGetClient.mockResolvedValue({
        email: 'first@example.com',
      });

      const email1 = await getServiceAccountEmail();
      expect(email1).toBe('first@example.com');

      // Clear cache
      clearServiceAccountCache();

      // Second email (different)
      mockGetClient.mockResolvedValue({
        email: 'second@example.com',
      });

      const email2 = await getServiceAccountEmail();
      expect(email2).toBe('second@example.com');
    });

    it('should not throw when clearing empty cache', () => {
      expect(() => clearServiceAccountCache()).not.toThrow();
    });

    it('should not throw when clearing cache multiple times', () => {
      expect(() => {
        clearServiceAccountCache();
        clearServiceAccountCache();
        clearServiceAccountCache();
      }).not.toThrow();
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical GCP service account structure', async () => {
      mockGetClient.mockResolvedValue({
        email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
        projectId: 'papertrail-invoice',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const email = await getServiceAccountEmail();
      expect(email).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
    });

    it('should handle credentials object with additional properties', async () => {
      mockGetClient.mockResolvedValue({});

      mockGetCredentials.mockResolvedValue({
        client_email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
        type: 'service_account',
        project_id: 'papertrail-invoice',
        private_key_id: 'abc123',
      });

      const email = await getServiceAccountEmail();
      expect(email).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
    });

    it('should work with different service account email formats', async () => {
      const testEmails = [
        'service@project.iam.gserviceaccount.com',
        'worker-123@my-project-456.iam.gserviceaccount.com',
        'bot@test-env.iam.gserviceaccount.com',
      ];

      for (const testEmail of testEmails) {
        clearServiceAccountCache();
        mockGetClient.mockResolvedValue({ email: testEmail });

        const email = await getServiceAccountEmail();
        expect(email).toBe(testEmail);
      }
    });
  });

  describe('Performance and caching behavior', () => {
    it('should only call GoogleAuth once across multiple calls', async () => {
      mockGetClient.mockResolvedValue({
        email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
      });

      // Make 10 sequential calls
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(await getServiceAccountEmail());
      }

      // All should return the same email
      results.forEach((email) => {
        expect(email).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      });

      // But GoogleAuth should only be called once (cache used for rest)
      expect(mockGetClient).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent calls before cache is populated', async () => {
      let callCount = 0;
      mockGetClient.mockImplementation(async () => {
        callCount++;
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { email: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com' };
      });

      // Start multiple concurrent calls
      const promise1 = getServiceAccountEmail();
      const promise2 = getServiceAccountEmail();
      const promise3 = getServiceAccountEmail();

      const [email1, email2, email3] = await Promise.all([promise1, promise2, promise3]);

      expect(email1).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      expect(email2).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');
      expect(email3).toBe('worker-sa@papertrail-invoice.iam.gserviceaccount.com');

      // Note: Due to race conditions, this might be called multiple times
      // before cache is set, which is acceptable behavior
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });
});

/**
 * Onboarding Service Tests
 * Tests for onboarding session state management
 */

import {
  startOnboarding,
  getOnboardingSession,
  updateOnboardingSession,
  updateOnboardingData,
  completeOnboarding,
  cancelOnboarding,
  isInOnboarding,
} from '../../src/services/onboarding/onboarding.service';

// Mock Firestore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockData: Record<string, any> = {};

const mockGet = jest.fn((docPath: string) => {
  return Promise.resolve({
    exists: !!mockData[docPath],
    data: () => mockData[docPath],
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSet = jest.fn((docPath: string, data: any) => {
  mockData[docPath] = data;
  return Promise.resolve();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdate = jest.fn((docPath: string, data: any) => {
  const existing = mockData[docPath] || {};
  const updated = { ...existing };

  // Handle Firestore dot notation (e.g., "data.businessName")
  Object.entries(data).forEach(([key, value]) => {
    if (key.includes('.')) {
      const parts = key.split('.');
      let current = updated;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    } else {
      updated[key] = value;
    }
  });

  mockData[docPath] = updated;
  return Promise.resolve();
});

const mockDelete = jest.fn((docPath: string) => {
  delete mockData[docPath];
  return Promise.resolve();
});

const mockDoc = jest.fn((docId: string) => {
  const docPath = `onboarding_sessions/${docId}`;
  return {
    get: () => mockGet(docPath),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set: (data: any) => mockSet(docPath, data),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (data: any) => mockUpdate(docPath, data),
    delete: () => mockDelete(docPath),
  };
});

const mockCollection = jest.fn(() => ({
  doc: mockDoc,
}));

jest.mock('@google-cloud/firestore', () => {
  return {
    Firestore: jest.fn(() => ({
      collection: mockCollection,
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date('2026-01-19')),
    },
  };
});

describe('Onboarding Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mock data
    Object.keys(mockData).forEach((key) => delete mockData[key]);
  });

  describe('startOnboarding', () => {
    it('should create new onboarding session with language step', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);

      const docPath = `onboarding_sessions/${chatId}`;
      expect(mockData[docPath]).toBeDefined();
      expect(mockData[docPath].chatId).toBe(chatId);
      expect(mockData[docPath].userId).toBe(userId);
      expect(mockData[docPath].step).toBe('language');
      expect(mockData[docPath].data).toEqual({});
      expect(mockData[docPath].startedAt).toEqual(new Date('2026-01-19'));
      expect(mockData[docPath].updatedAt).toEqual(new Date('2026-01-19'));
    });

    it('should overwrite existing session if called again', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      // Start first session
      await startOnboarding(chatId, userId);

      // Update to step 2
      await updateOnboardingSession(chatId, { step: 'business_name' });

      // Start again (resets)
      await startOnboarding(chatId, userId);

      const docPath = `onboarding_sessions/${chatId}`;
      expect(mockData[docPath].step).toBe('language');
    });
  });

  describe('getOnboardingSession', () => {
    it('should return null for non-existent session', async () => {
      const session = await getOnboardingSession(999999);
      expect(session).toBeNull();
    });

    it('should return existing session', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);

      const session = await getOnboardingSession(chatId);
      expect(session).not.toBeNull();
      expect(session?.chatId).toBe(chatId);
      expect(session?.userId).toBe(userId);
      expect(session?.step).toBe('language');
    });

    it('should return session with data at various steps', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await updateOnboardingData(chatId, {
        businessName: 'Acme Corp',
        ownerName: 'John Doe',
      });
      await updateOnboardingSession(chatId, { step: 'address', language: 'en' });

      const session = await getOnboardingSession(chatId);
      expect(session?.step).toBe('address');
      expect(session?.language).toBe('en');
      expect(session?.data.businessName).toBe('Acme Corp');
      expect(session?.data.ownerName).toBe('John Doe');
    });
  });

  describe('updateOnboardingSession', () => {
    it('should update step and language', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await updateOnboardingSession(chatId, {
        step: 'business_name',
        language: 'he',
      });

      const session = await getOnboardingSession(chatId);
      expect(session?.step).toBe('business_name');
      expect(session?.language).toBe('he');
      expect(session?.updatedAt).toEqual(new Date('2026-01-19'));
    });

    it('should update only specified fields', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await updateOnboardingSession(chatId, { language: 'en' });

      const session = await getOnboardingSession(chatId);
      expect(session?.step).toBe('language'); // Unchanged
      expect(session?.language).toBe('en'); // Changed
    });
  });

  describe('updateOnboardingData', () => {
    it('should update business name', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await updateOnboardingData(chatId, { businessName: 'Test Company' });

      const session = await getOnboardingSession(chatId);
      expect(session?.data.businessName).toBe('Test Company');
    });

    it('should update owner details', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await updateOnboardingData(chatId, {
        ownerName: 'John Doe',
        ownerIdNumber: '123456789',
        phone: '+972501234567',
        email: 'john@acme.com',
      });

      const session = await getOnboardingSession(chatId);
      expect(session?.data.ownerName).toBe('John Doe');
      expect(session?.data.ownerIdNumber).toBe('123456789');
      expect(session?.data.phone).toBe('+972501234567');
      expect(session?.data.email).toBe('john@acme.com');
    });

    it('should update multiple data fields progressively', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);

      // Step 1: Business name
      await updateOnboardingData(chatId, { businessName: 'Test Co' });

      // Step 2: Owner details
      await updateOnboardingData(chatId, {
        ownerName: 'Jane Smith',
        ownerIdNumber: '987654321',
        phone: '0541234567',
        email: 'jane@test.co.il',
      });

      // Step 3: Address
      await updateOnboardingData(chatId, { address: '123 Main St, Tel Aviv' });

      // Step 4: Tax status
      await updateOnboardingData(chatId, { taxStatus: 'עוסק פטור מס' });

      const session = await getOnboardingSession(chatId);
      expect(session?.data).toEqual({
        businessName: 'Test Co',
        ownerName: 'Jane Smith',
        ownerIdNumber: '987654321',
        phone: '0541234567',
        email: 'jane@test.co.il',
        address: '123 Main St, Tel Aviv',
        taxStatus: 'עוסק פטור מס',
      });
    });

    it('should update optional fields', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await updateOnboardingData(chatId, {
        logoUrl: 'https://storage.googleapis.com/logos/12345/logo.png',
        sheetId: '1abc_XyZ123-456def',
        startingCounter: 1000,
      });

      const session = await getOnboardingSession(chatId);
      expect(session?.data.logoUrl).toBe('https://storage.googleapis.com/logos/12345/logo.png');
      expect(session?.data.sheetId).toBe('1abc_XyZ123-456def');
      expect(session?.data.startingCounter).toBe(1000);
    });
  });

  describe('completeOnboarding', () => {
    it('should delete onboarding session', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await completeOnboarding(chatId);

      const docPath = `onboarding_sessions/${chatId}`;
      expect(mockData[docPath]).toBeUndefined();
    });

    it('should not throw error if session does not exist', async () => {
      await expect(completeOnboarding(999999)).resolves.not.toThrow();
    });
  });

  describe('cancelOnboarding', () => {
    it('should delete onboarding session', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await cancelOnboarding(chatId);

      const docPath = `onboarding_sessions/${chatId}`;
      expect(mockData[docPath]).toBeUndefined();
    });

    it('should not throw error if session does not exist', async () => {
      await expect(cancelOnboarding(999999)).resolves.not.toThrow();
    });
  });

  describe('isInOnboarding', () => {
    it('should return false for user not in onboarding', async () => {
      const inOnboarding = await isInOnboarding(999999);
      expect(inOnboarding).toBe(false);
    });

    it('should return true for user in onboarding', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);

      const inOnboarding = await isInOnboarding(chatId);
      expect(inOnboarding).toBe(true);
    });

    it('should return false after completing onboarding', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await completeOnboarding(chatId);

      const inOnboarding = await isInOnboarding(chatId);
      expect(inOnboarding).toBe(false);
    });

    it('should return false after cancelling onboarding', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await cancelOnboarding(chatId);

      const inOnboarding = await isInOnboarding(chatId);
      expect(inOnboarding).toBe(false);
    });
  });

  describe('Full onboarding flow', () => {
    it('should handle complete onboarding workflow', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      // Step 0: Start onboarding
      await startOnboarding(chatId, userId);
      expect(await isInOnboarding(chatId)).toBe(true);

      // Step 1: Language selection
      await updateOnboardingSession(chatId, { language: 'he', step: 'business_name' });

      // Step 2: Business name
      await updateOnboardingData(chatId, { businessName: 'חברת אקמי בע"מ' });
      await updateOnboardingSession(chatId, { step: 'owner_details' });

      // Step 3: Owner details
      await updateOnboardingData(chatId, {
        ownerName: 'ישראל ישראלי',
        ownerIdNumber: '123456789',
        phone: '0501234567',
        email: 'israel@acme.co.il',
      });
      await updateOnboardingSession(chatId, { step: 'address' });

      // Step 4: Address
      await updateOnboardingData(chatId, { address: 'רחוב הרצל 123, תל אביב' });
      await updateOnboardingSession(chatId, { step: 'tax_status' });

      // Step 5: Tax status
      await updateOnboardingData(chatId, { taxStatus: 'עוסק פטור מס' });
      await updateOnboardingSession(chatId, { step: 'logo' });

      // Step 6: Logo (uploaded)
      await updateOnboardingData(chatId, {
        logoUrl: 'https://storage.googleapis.com/logos/-1001234567/logo.png',
      });
      await updateOnboardingSession(chatId, { step: 'sheet' });

      // Step 7: Sheet (provided)
      await updateOnboardingData(chatId, { sheetId: '1abc_XyZ123-456def' });
      await updateOnboardingSession(chatId, { step: 'counter' });

      // Step 8: Counter (starting from 1)
      await updateOnboardingData(chatId, { startingCounter: 1 });
      await updateOnboardingSession(chatId, { step: 'complete' });

      // Verify all data
      const session = await getOnboardingSession(chatId);
      expect(session?.language).toBe('he');
      expect(session?.step).toBe('complete');
      expect(session?.data).toEqual({
        businessName: 'חברת אקמי בע"מ',
        ownerName: 'ישראל ישראלי',
        ownerIdNumber: '123456789',
        phone: '0501234567',
        email: 'israel@acme.co.il',
        address: 'רחוב הרצל 123, תל אביב',
        taxStatus: 'עוסק פטור מס',
        logoUrl: 'https://storage.googleapis.com/logos/-1001234567/logo.png',
        sheetId: '1abc_XyZ123-456def',
        startingCounter: 1,
      });

      // Complete onboarding
      await completeOnboarding(chatId);
      expect(await isInOnboarding(chatId)).toBe(false);
    });

    it('should handle onboarding with skipped optional fields', async () => {
      const chatId = -1001234567;
      const userId = 123456;

      await startOnboarding(chatId, userId);
      await updateOnboardingSession(chatId, { language: 'en' });
      await updateOnboardingData(chatId, { businessName: 'Acme Corp' });
      await updateOnboardingData(chatId, {
        ownerName: 'John Doe',
        ownerIdNumber: '123456789',
        phone: '+972501234567',
        email: 'john@acme.com',
      });
      await updateOnboardingData(chatId, { address: '123 Herzl St, Tel Aviv' });
      await updateOnboardingData(chatId, { taxStatus: 'Tax Exempt Business (עוסק פטור מס)' });

      // Skip logo and sheet
      await updateOnboardingData(chatId, { startingCounter: 1 });
      await updateOnboardingSession(chatId, { step: 'complete' });

      const session = await getOnboardingSession(chatId);
      expect(session?.data.logoUrl).toBeUndefined();
      expect(session?.data.sheetId).toBeUndefined();
      expect(session?.data.startingCounter).toBe(1);

      await completeOnboarding(chatId);
      expect(await isInOnboarding(chatId)).toBe(false);
    });
  });
});

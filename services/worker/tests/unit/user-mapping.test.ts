/**
 * User-to-Customer Mapping Service Tests
 * Tests for user access control and customer mapping
 */

import {
  addUserToCustomer,
  getUserCustomers,
  userHasAccessToCustomer,
  removeUserFromCustomer,
  updateUserActivity,
} from '../../src/services/customer/user-mapping.service';

// Mock Firestore
const mockData: Record<string, Record<string, unknown>> = {};

const mockGet = jest.fn((docPath: string) => {
  return Promise.resolve({
    exists: !!mockData[docPath],
    data: () => mockData[docPath],
  });
});

const mockSet = jest.fn((docPath: string, data: Record<string, unknown>) => {
  mockData[docPath] = data;
  return Promise.resolve();
});

const mockUpdate = jest.fn((docPath: string, data: Record<string, unknown>) => {
  const existing = mockData[docPath] || {};

  // Handle arrayUnion
  const customers = data.customers as { arrayUnion?: { chatId: number } } | undefined;
  if (customers?.arrayUnion) {
    const newCustomer = customers.arrayUnion;
    const existingCustomers = (existing.customers as Array<{ chatId: number }>) || [];
    // Add if not already present
    if (!existingCustomers.some((c) => c.chatId === newCustomer.chatId)) {
      existing.customers = [...existingCustomers, newCustomer];
    }
    delete data.customers; // Remove arrayUnion marker
  }

  mockData[docPath] = { ...existing, ...data };
  return Promise.resolve();
});

const mockDelete = jest.fn((docPath: string) => {
  delete mockData[docPath];
  return Promise.resolve();
});

const mockDoc = jest.fn((docId: string) => {
  const docPath = `user_customer_mapping/${docId}`;
  return {
    get: () => mockGet(docPath),
    set: (data: Record<string, unknown>) => mockSet(docPath, data),
    update: (data: Record<string, unknown>) => mockUpdate(docPath, data),
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
      serverTimestamp: jest.fn(() => new Date('2026-01-18')),
      arrayUnion: jest.fn((item) => ({ arrayUnion: item })),
    },
  };
});

describe('User-to-Customer Mapping Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mock data
    Object.keys(mockData).forEach((key) => delete mockData[key]);
  });

  describe('addUserToCustomer', () => {
    it('should create new user mapping when user does not exist', async () => {
      const userId = 123456;
      const username = 'testuser';
      const chatId = -1001234567;
      const chatTitle = 'Test Company';

      await addUserToCustomer(userId, username, chatId, chatTitle);

      const docPath = 'user_customer_mapping/user_123456';
      const data = mockData[docPath] as {
        userId: number;
        username: string;
        customers: Array<{ chatId: number; chatTitle: string }>;
      };
      expect(data).toBeDefined();
      expect(data.userId).toBe(userId);
      expect(data.username).toBe(username);
      expect(data.customers).toHaveLength(1);
      expect(data.customers[0].chatId).toBe(chatId);
      expect(data.customers[0].chatTitle).toBe(chatTitle);
    });

    it('should add customer to existing user', async () => {
      const userId = 123456;
      const username = 'testuser';
      const chatId1 = -1001111111;
      const chatId2 = -1002222222;

      // Add first customer
      await addUserToCustomer(userId, username, chatId1, 'Company A');

      // Add second customer
      await addUserToCustomer(userId, username, chatId2, 'Company B');

      const customers = await getUserCustomers(userId);
      expect(customers).toHaveLength(2);
      expect(customers.some((c) => c.chatId === chatId1)).toBe(true);
      expect(customers.some((c) => c.chatId === chatId2)).toBe(true);
    });

    it('should not duplicate customer if already mapped', async () => {
      const userId = 123456;
      const username = 'testuser';
      const chatId = -1001234567;

      // Add customer twice
      await addUserToCustomer(userId, username, chatId, 'Test Company');
      await addUserToCustomer(userId, username, chatId, 'Test Company');

      const customers = await getUserCustomers(userId);
      expect(customers).toHaveLength(1);
    });

    it('should include addedBy when provided', async () => {
      const userId = 123456;
      const username = 'testuser';
      const chatId = -1001234567;
      const addedBy = 789012;

      await addUserToCustomer(userId, username, chatId, 'Test Company', addedBy);

      const docPath = 'user_customer_mapping/user_123456';
      const data = mockData[docPath] as {
        customers: Array<{ addedBy?: number }>;
      };
      expect(data.customers[0].addedBy).toBe(addedBy);
    });
  });

  describe('getUserCustomers', () => {
    it('should return empty array for user with no mappings', async () => {
      const customers = await getUserCustomers(999999);
      expect(customers).toEqual([]);
    });

    it('should return all customers for a user', async () => {
      const userId = 123456;

      await addUserToCustomer(userId, 'testuser', -1001111111, 'Company A');
      await addUserToCustomer(userId, 'testuser', -1002222222, 'Company B');
      await addUserToCustomer(userId, 'testuser', -1003333333, 'Company C');

      const customers = await getUserCustomers(userId);
      expect(customers).toHaveLength(3);
    });
  });

  describe('userHasAccessToCustomer', () => {
    it('should return true when user has access to customer', async () => {
      const userId = 123456;
      const chatId = -1001234567;

      await addUserToCustomer(userId, 'testuser', chatId, 'Test Company');

      const hasAccess = await userHasAccessToCustomer(userId, chatId);
      expect(hasAccess).toBe(true);
    });

    it('should return false when user does not have access', async () => {
      const userId = 123456;
      const chatId = -1001234567;

      const hasAccess = await userHasAccessToCustomer(userId, chatId);
      expect(hasAccess).toBe(false);
    });

    it('should return false for different customer', async () => {
      const userId = 123456;

      await addUserToCustomer(userId, 'testuser', -1001111111, 'Company A');

      const hasAccess = await userHasAccessToCustomer(userId, -1002222222);
      expect(hasAccess).toBe(false);
    });
  });

  describe('removeUserFromCustomer', () => {
    it('should remove customer from user mapping', async () => {
      const userId = 123456;
      const chatId1 = -1001111111;
      const chatId2 = -1002222222;

      await addUserToCustomer(userId, 'testuser', chatId1, 'Company A');
      await addUserToCustomer(userId, 'testuser', chatId2, 'Company B');

      await removeUserFromCustomer(userId, chatId1);

      const customers = await getUserCustomers(userId);
      expect(customers).toHaveLength(1);
      expect(customers[0].chatId).toBe(chatId2);
    });

    it('should delete user document when removing last customer', async () => {
      const userId = 123456;
      const chatId = -1001234567;

      await addUserToCustomer(userId, 'testuser', chatId, 'Test Company');
      await removeUserFromCustomer(userId, chatId);

      const docPath = 'user_customer_mapping/user_123456';
      expect(mockData[docPath]).toBeUndefined();
    });

    it('should handle removing from non-existent user', async () => {
      await expect(removeUserFromCustomer(999999, -1001234567)).resolves.not.toThrow();
    });
  });

  describe('updateUserActivity', () => {
    it('should update lastActive for existing user', async () => {
      const userId = 123456;

      await addUserToCustomer(userId, 'testuser', -1001234567, 'Test Company');
      await updateUserActivity(userId);

      const docPath = 'user_customer_mapping/user_123456';
      expect(mockUpdate).toHaveBeenCalledWith(
        docPath,
        expect.objectContaining({
          lastActive: expect.any(Date),
        })
      );
    });

    it('should handle updating activity for non-existent user', async () => {
      await expect(updateUserActivity(999999)).resolves.not.toThrow();
    });
  });

  describe('Multi-customer scenarios', () => {
    it('should allow user to be in multiple customer groups independently', async () => {
      const userId = 123456;

      // User joins Company A
      await addUserToCustomer(userId, 'testuser', -1001111111, 'Company A');
      expect(await userHasAccessToCustomer(userId, -1001111111)).toBe(true);
      expect(await userHasAccessToCustomer(userId, -1002222222)).toBe(false);

      // User joins Company B
      await addUserToCustomer(userId, 'testuser', -1002222222, 'Company B');
      expect(await userHasAccessToCustomer(userId, -1001111111)).toBe(true);
      expect(await userHasAccessToCustomer(userId, -1002222222)).toBe(true);

      // User leaves Company A
      await removeUserFromCustomer(userId, -1001111111);
      expect(await userHasAccessToCustomer(userId, -1001111111)).toBe(false);
      expect(await userHasAccessToCustomer(userId, -1002222222)).toBe(true);
    });
  });
});

/**
 * User-to-Customer Mapping Service
 * Tracks which Telegram users belong to which customers (chat groups)
 * Used for access control and audit trails
 */

import { FieldValue } from '@google-cloud/firestore';
import type { CustomerAccess, UserCustomerMapping } from '../../../../../shared/types';
import logger from '../../logger';
import { getFirestore } from '../firestore.service';

import { USER_CUSTOMER_MAPPING_COLLECTION } from '../../../../../shared/collections';

/**
 * Add user to customer
 * Called when a user first interacts with the bot in a customer's chat
 */
export async function addUserToCustomer(
  userId: number,
  username: string,
  chatId: number,
  chatTitle: string,
  addedBy?: number
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(USER_CUSTOMER_MAPPING_COLLECTION).doc(`user_${userId}`);

  const doc = await docRef.get();

  if (doc.exists) {
    // User exists, add new customer if not already present
    const data = doc.data() as UserCustomerMapping;
    const existingCustomer = data.customers.find((c) => c.chatId === chatId);

    if (existingCustomer) {
      logger.debug({ userId, chatId }, 'User already mapped to customer');
      return;
    }

    await docRef.update({
      username, // Update username in case it changed
      customers: FieldValue.arrayUnion({
        chatId,
        chatTitle,
        addedAt: new Date(),
        ...(addedBy && { addedBy }),
      }),
      lastActive: FieldValue.serverTimestamp(),
    });

    logger.info({ userId, chatId, chatTitle }, 'User added to customer');
  } else {
    // New user, create document
    await docRef.set({
      userId,
      username,
      customers: [
        {
          chatId,
          chatTitle,
          addedAt: new Date(),
          ...(addedBy && { addedBy }),
        },
      ],
      lastActive: FieldValue.serverTimestamp(),
    });

    logger.info({ userId, chatId, chatTitle }, 'New user created and mapped to customer');
  }
}

/**
 * Get all customers a user has access to
 */
export async function getUserCustomers(userId: number): Promise<CustomerAccess[]> {
  const db = getFirestore();
  const docRef = db.collection(USER_CUSTOMER_MAPPING_COLLECTION).doc(`user_${userId}`);

  const doc = await docRef.get();

  if (!doc.exists) {
    return [];
  }

  const data = doc.data() as UserCustomerMapping;
  return data.customers;
}

/**
 * Validate if user has access to a customer
 */
export async function userHasAccessToCustomer(userId: number, chatId: number): Promise<boolean> {
  const customers = await getUserCustomers(userId);
  return customers.some((c) => c.chatId === chatId);
}

/**
 * Remove user from customer (e.g., when they leave the group)
 */
export async function removeUserFromCustomer(userId: number, chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(USER_CUSTOMER_MAPPING_COLLECTION).doc(`user_${userId}`);

  const doc = await docRef.get();

  if (!doc.exists) {
    return;
  }

  const data = doc.data() as UserCustomerMapping;
  const updatedCustomers = data.customers.filter((c) => c.chatId !== chatId);

  if (updatedCustomers.length === 0) {
    // User has no more customers, delete document
    await docRef.delete();
    logger.info({ userId, chatId }, 'User removed from last customer, document deleted');
  } else {
    await docRef.update({
      customers: updatedCustomers,
    });
    logger.info({ userId, chatId }, 'User removed from customer');
  }
}

/**
 * Update user's last active timestamp
 * Called on any user interaction
 */
export async function updateUserActivity(userId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(USER_CUSTOMER_MAPPING_COLLECTION).doc(`user_${userId}`);

  const doc = await docRef.get();

  if (doc.exists) {
    await docRef.update({
      lastActive: FieldValue.serverTimestamp(),
    });
  }
}

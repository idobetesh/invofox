/**
 * User Mapping Model
 * Schema for 'user_customer_mapping' collection (user access control)
 */

import { z } from 'zod';
import type { Firestore, Timestamp } from '@google-cloud/firestore';

/**
 * Zod schema for customer access
 */
export const CustomerAccessSchema = z.object({
  chatId: z.number(),
  chatTitle: z.string(),
  businessName: z.string().optional(), // Added for convenience
  addedAt: z.custom<Date | Timestamp>(),
  addedBy: z.number().optional(),
});

export type CustomerAccess = z.infer<typeof CustomerAccessSchema>;

/**
 * Zod schema for user_customer_mapping collection
 */
export const UserCustomerMappingSchema = z.object({
  userId: z.number(),
  username: z.string(),
  customers: z.array(CustomerAccessSchema),
  lastActive: z.custom<Date | Timestamp>(),
});

export type UserCustomerMapping = z.infer<typeof UserCustomerMappingSchema>;

/**
 * Firestore converter for type-safe reads/writes
 */
export const userCustomerMappingConverter = {
  toFirestore: (data: UserCustomerMapping) => data,
  fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot): UserCustomerMapping => {
    const data = snapshot.data();
    return UserCustomerMappingSchema.parse(data);
  },
};

/**
 * Collection reference with type safety
 */
export function getUserCustomerMappingsCollection(db: Firestore) {
  return db.collection('user_customer_mapping').withConverter(userCustomerMappingConverter);
}

/**
 * Get document ID for user mapping
 */
export function getUserMappingDocId(userId: number): string {
  return `user_${userId}`;
}

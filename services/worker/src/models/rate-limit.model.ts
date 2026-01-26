/**
 * Rate Limit Model
 * Schema for 'rate_limits' collection (report generation quota tracking)
 */

import { z } from 'zod';
import type { Firestore, Timestamp } from '@google-cloud/firestore';

/**
 * Zod schema for rate_limits collection
 */
export const RateLimitSchema = z.object({
  // Identifier
  chatId: z.number(),

  // Rate limit tracking
  lastReportDate: z.string(), // YYYY-MM-DD format
  reportCount: z.number().default(0),

  // Reset time
  resetAt: z.custom<Timestamp>(), // Next midnight
});

export type RateLimit = z.infer<typeof RateLimitSchema>;

/**
 * Firestore converter for type-safe reads/writes
 */
export const rateLimitConverter = {
  toFirestore: (data: RateLimit) => data,
  fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot): RateLimit => {
    const data = snapshot.data();
    return RateLimitSchema.parse(data);
  },
};

/**
 * Collection reference with type safety
 */
export function getRateLimitsCollection(db: Firestore) {
  return db.collection('rate_limits').withConverter(rateLimitConverter);
}

/**
 * Get document ID for rate limit tracking
 */
export function getRateLimitDocId(chatId: number): string {
  return `report_${chatId}`;
}

/**
 * Get today's date string (YYYY-MM-DD)
 */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get tomorrow midnight (reset time)
 */
export function getTomorrowMidnight(): Date {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

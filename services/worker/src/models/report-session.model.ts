/**
 * Report Session Model
 * Schema for 'report_sessions' collection (multi-step report generation state)
 */

import { z } from 'zod';
import type { Firestore, Timestamp } from '@google-cloud/firestore';

/**
 * Zod schema for report_sessions collection
 */
export const ReportSessionSchema = z.object({
  // Session identification
  sessionId: z.string(),
  chatId: z.number(),
  userId: z.number(),

  // Session state
  status: z.enum(['active', 'completed', 'expired']),
  currentStep: z.enum(['type', 'date', 'format', 'generating']),

  // User selections (filled as flow progresses)
  reportType: z.enum(['revenue', 'expenses']).optional(),
  datePreset: z
    .enum(['this_month', 'last_month', 'this_quarter', 'last_quarter', 'ytd', 'this_year'])
    .optional(),
  format: z.enum(['pdf', 'excel', 'csv']).optional(),

  // Timestamps
  createdAt: z.custom<Timestamp>(),
  updatedAt: z.custom<Timestamp>(),
  expiresAt: z.custom<Timestamp>(), // 30 minutes TTL
});

export type ReportSession = z.infer<typeof ReportSessionSchema>;

/**
 * Firestore converter for type-safe reads/writes
 */
export const reportSessionConverter = {
  toFirestore: (data: ReportSession) => data,
  fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot): ReportSession => {
    const data = snapshot.data();
    return ReportSessionSchema.parse(data);
  },
};

/**
 * Collection reference with type safety
 */
export function getReportSessionsCollection(db: Firestore) {
  return db.collection('report_sessions').withConverter(reportSessionConverter);
}

/**
 * Generate session TTL (30 minutes from now)
 */
export function getSessionTTL(): Date {
  const ttl = new Date();
  ttl.setMinutes(ttl.getMinutes() + 30);
  return ttl;
}

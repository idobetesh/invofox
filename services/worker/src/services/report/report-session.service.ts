/**
 * Report Session Service
 * Manages conversation state for multi-step report generation flow
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';
import type { DatePreset } from '../../../../../shared/report.types';
import logger from '../../logger';

const COLLECTION_NAME = 'report_sessions';
const SESSION_TTL_MINUTES = 30;

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

export type ReportType = 'revenue' | 'expenses';
export type ReportFormat = 'pdf' | 'excel' | 'csv';
export type ReportStep =
  | 'type'
  | 'date'
  | 'format'
  | 'custom_date_start'
  | 'custom_date_end'
  | 'generating';

export interface ReportSession {
  sessionId: string;
  chatId: number;
  userId: number;
  status: 'active' | 'completed' | 'expired';
  currentStep: ReportStep;

  // User selections
  reportType?: ReportType;
  datePreset?: DatePreset;
  customDateStart?: string; // YYYY-MM-DD
  customDateEnd?: string; // YYYY-MM-DD
  format?: ReportFormat;

  // Metadata
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
}

/**
 * Generate session ID (shortened for Telegram's 64-byte callback_data limit)
 * Format: {timestamp_base36}{random2}
 * Example: ld3k8ma9x (13 chars max)
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36); // Convert to base36 (shorter)
  const random = Math.random().toString(36).substring(2, 4); // 2 random chars
  return `${timestamp}${random}`;
}

/**
 * Calculate expiration time
 */
function getExpirationTime(): Date {
  const now = new Date();
  now.setMinutes(now.getMinutes() + SESSION_TTL_MINUTES);
  return now;
}

/**
 * Create new report session
 */
export async function createReportSession(chatId: number, userId: number): Promise<ReportSession> {
  const db = getFirestore();
  const sessionId = generateSessionId();
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromDate(getExpirationTime());

  const session: ReportSession = {
    sessionId,
    chatId,
    userId,
    status: 'active',
    currentStep: 'type',
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };

  await db.collection(COLLECTION_NAME).doc(sessionId).set(session);

  logger.info({ sessionId, chatId, userId }, 'Created report session');

  return session;
}

/**
 * Get active session for user
 */
export async function getActiveSession(
  chatId: number,
  userId: number
): Promise<ReportSession | null> {
  const db = getFirestore();
  const now = Timestamp.now();

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('chatId', '==', chatId)
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .where('expiresAt', '>', now)
    .orderBy('expiresAt', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return snapshot.docs[0].data() as ReportSession;
}

/**
 * Get report session by ID
 */
export async function getReportSession(sessionId: string): Promise<ReportSession | null> {
  const db = getFirestore();
  const doc = await db.collection(COLLECTION_NAME).doc(sessionId).get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as ReportSession;
}

/**
 * Update session with new data
 */
export async function updateReportSession(
  sessionId: string,
  updates: Partial<Omit<ReportSession, 'sessionId' | 'chatId' | 'userId' | 'createdAt'>>
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(sessionId);

  const updateData = {
    ...updates,
    updatedAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(getExpirationTime()), // Extend TTL
  };

  await docRef.update(updateData);

  logger.info({ sessionId, updates }, 'Updated report session');
}

/**
 * Complete session (mark as done)
 */
export async function completeReportSession(sessionId: string): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION_NAME).doc(sessionId).update({
    status: 'completed',
    updatedAt: Timestamp.now(),
  });

  logger.info({ sessionId }, 'Completed report session');
}

/**
 * Cancel session
 */
export async function cancelReportSession(sessionId: string): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION_NAME).doc(sessionId).delete();

  logger.info({ sessionId }, 'Cancelled report session');
}

/**
 * Clean up expired sessions (can be run periodically)
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getFirestore();
  const now = Timestamp.now();

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('expiresAt', '<=', now)
    .limit(100)
    .get();

  if (snapshot.empty) {
    return 0;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();

  logger.info({ count: snapshot.size }, 'Cleaned up expired report sessions');

  return snapshot.size;
}

/**
 * Report Rate Limiter Service
 * Enforces 3 reports per day per user limit
 */

import { Timestamp } from '@google-cloud/firestore';
import logger from '../../logger';
import { getFirestore } from '../store.service';

import { RATE_LIMITS_COLLECTION } from '../../../../../shared/collections';

// Parse and validate MAX_REPORTS_PER_DAY from environment variable
const parsedMaxReports = parseInt(process.env.REPORT_MAX_PER_DAY || '3', 10);
const MAX_REPORTS_PER_DAY =
  Number.isNaN(parsedMaxReports) || parsedMaxReports <= 0 ? 3 : parsedMaxReports;

export interface ReportRateLimit {
  chatId: number;
  lastReportDate: string; // YYYY-MM-DD
  reportCount: number;
  resetAt: Timestamp;
}

/**
 * Check if user can generate a report
 * Returns { allowed: true } or { allowed: false, resetAt: Date }
 */
export async function checkReportLimit(
  chatId: number
): Promise<{ allowed: boolean; resetAt?: Date; remaining?: number }> {
  const db = getFirestore();
  const docRef = db.collection(RATE_LIMITS_COLLECTION).doc(`report_${chatId}`);
  const doc = await docRef.get();

  const today = getTodayDateString();

  if (!doc.exists) {
    // First report ever
    return { allowed: true, remaining: MAX_REPORTS_PER_DAY - 1 };
  }

  const data = doc.data() as ReportRateLimit;

  // Check if we're on a new day (reset counter)
  if (data.lastReportDate !== today) {
    return { allowed: true, remaining: MAX_REPORTS_PER_DAY - 1 };
  }

  // Same day - check count
  if (data.reportCount >= MAX_REPORTS_PER_DAY) {
    return {
      allowed: false,
      resetAt: data.resetAt.toDate(),
      remaining: 0,
    };
  }

  return {
    allowed: true,
    remaining: MAX_REPORTS_PER_DAY - data.reportCount - 1,
  };
}

/**
 * Record a report generation
 */
export async function recordReportGeneration(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(RATE_LIMITS_COLLECTION).doc(`report_${chatId}`);
  const doc = await docRef.get();

  const today = getTodayDateString();
  const resetAt = getTomorrowMidnight();

  if (!doc.exists || (doc.data() as ReportRateLimit).lastReportDate !== today) {
    // First report today
    await docRef.set({
      chatId,
      lastReportDate: today,
      reportCount: 1,
      resetAt: Timestamp.fromDate(resetAt),
    });
  } else {
    // Increment count
    await docRef.update({
      reportCount: (doc.data() as ReportRateLimit).reportCount + 1,
      resetAt: Timestamp.fromDate(resetAt),
    });
  }

  logger.info({ chatId, today }, 'Recorded report generation');
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTomorrowMidnight(): Date {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

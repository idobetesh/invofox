/**
 * Rate Limiter Service (Worker)
 * Records failed onboarding attempts in Firestore for shared state with webhook-handler
 */

import { Timestamp } from '@google-cloud/firestore';
import { getFirestore } from './store.service';
import logger from '../logger';

import { RATE_LIMITS_COLLECTION } from '../../../../shared/collections';

// Rate limit configuration from environment (with sensible defaults)
const MAX_ATTEMPTS = parseInt(process.env.ONBOARD_MAX_ATTEMPTS || '3', 10);
const BLOCK_DURATION_MS =
  parseInt(process.env.ONBOARD_BLOCK_DURATION_MINUTES || '15', 10) * 60 * 1000;

export interface RateLimitDoc {
  chatId: number;
  attempts: number;
  firstAttemptAt: Timestamp;
  lastAttemptAt: Timestamp;
  blockedUntil?: Timestamp;
}

/**
 * Record a failed onboarding attempt
 */
export async function recordFailedOnboardingAttempt(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(RATE_LIMITS_COLLECTION).doc(`onboard_${chatId}`);
  const doc = await docRef.get();

  const now = Timestamp.now();

  if (!doc.exists) {
    // First attempt
    await docRef.set({
      chatId,
      attempts: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
    });
    logger.info({ chatId }, 'Recorded first failed onboarding attempt');
    return;
  }

  const data = doc.data() as RateLimitDoc;

  // Check if block expired
  if (data.blockedUntil && now.toMillis() >= data.blockedUntil.toMillis()) {
    // Block expired, reset counter
    await docRef.set({
      chatId,
      attempts: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
    });
    logger.info({ chatId }, 'Rate limit block expired, reset counter');
    return;
  }

  // Increment attempts
  const newAttempts = data.attempts + 1;
  const updateData: {
    attempts: number;
    lastAttemptAt: Timestamp;
    blockedUntil?: Timestamp;
  } = {
    attempts: newAttempts,
    lastAttemptAt: now,
  };

  // Block if too many attempts
  if (newAttempts >= MAX_ATTEMPTS) {
    updateData.blockedUntil = Timestamp.fromMillis(now.toMillis() + BLOCK_DURATION_MS);
    logger.warn(
      { chatId, blockedUntil: updateData.blockedUntil.toDate() },
      'Chat blocked due to too many failed onboarding attempts'
    );
  }

  await docRef.update(updateData);
}

/**
 * Clear rate limit for a chat (when successfully approved with valid invite code)
 */
export async function clearRateLimit(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(RATE_LIMITS_COLLECTION).doc(`onboard_${chatId}`);

  await docRef.delete();
  logger.info({ chatId }, 'Cleared rate limit after successful onboarding');
}

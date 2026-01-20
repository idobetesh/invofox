/**
 * Rate Limiter Service (Worker)
 * Records failed onboarding attempts in Firestore for shared state with webhook-handler
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';

const COLLECTION_NAME = 'rate_limits';

// Rate limit configuration from environment (with sensible defaults)
const MAX_ATTEMPTS = parseInt(process.env.ONBOARD_MAX_ATTEMPTS || '3', 10);
const BLOCK_DURATION_MS =
  parseInt(process.env.ONBOARD_BLOCK_DURATION_MINUTES || '15', 10) * 60 * 1000;

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

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
  const docRef = db.collection(COLLECTION_NAME).doc(`onboard_${chatId}`);
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
    console.log(`[RateLimiter] Recorded first failed attempt for chat ${chatId}`);
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
    console.log(`[RateLimiter] Block expired, reset counter for chat ${chatId}`);
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
    console.log(`[RateLimiter] Chat ${chatId} blocked until ${updateData.blockedUntil.toDate()}`);
  }

  await docRef.update(updateData);
}

/**
 * Clear rate limit for a chat (when successfully approved with valid invite code)
 */
export async function clearRateLimit(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(`onboard_${chatId}`);

  await docRef.delete();
  console.log(`[RateLimiter] Cleared rate limit for chat ${chatId}`);
}

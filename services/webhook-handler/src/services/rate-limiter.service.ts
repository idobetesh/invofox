/**
 * Rate Limiter Service (Webhook-Handler)
 * Checks Firestore for rate limits set by worker
 * Uses in-memory cache to avoid repeated Firestore reads for blocked chats
 *
 * Worker records failed attempts, webhook-handler blocks repeat offenders
 */

import logger from '../logger';
import { getFirestore } from './store.service';

const COLLECTION_NAME = 'rate_limits';

interface RateLimitDoc {
  chatId: number;
  attempts: number;
  firstAttemptAt: { _seconds: number };
  lastAttemptAt: { _seconds: number };
  blockedUntil?: { _seconds: number };
}

// In-memory cache of blocked chats (chatId -> blockedUntil timestamp in ms)
const blockedChatsCache = new Map<number, number>();

// Cleanup expired entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    let cleaned = 0;

    for (const [chatId, blockedUntil] of blockedChatsCache.entries()) {
      if (now >= blockedUntil) {
        blockedChatsCache.delete(chatId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned expired rate limit cache entries');
    }
  },
  5 * 60 * 1000
);

/**
 * Check if a chat is rate limited for onboarding attempts
 * Uses in-memory cache to avoid Firestore reads for known blocked chats
 * @returns true if blocked, false if allowed
 */
export async function isRateLimited(chatId: number): Promise<boolean> {
  // 1. Check in-memory cache first (FREE - no Firestore read!)
  const cachedBlockedUntil = blockedChatsCache.get(chatId);
  if (cachedBlockedUntil) {
    const now = Date.now();
    if (now < cachedBlockedUntil) {
      // Still blocked (cached)
      return true;
    } else {
      // Block expired, remove from cache
      blockedChatsCache.delete(chatId);
    }
  }

  // 2. Not in cache - check Firestore
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(`onboard_${chatId}`);
    const doc = await docRef.get();

    if (!doc.exists) {
      return false; // No previous attempts
    }

    const data = doc.data() as RateLimitDoc;

    // Check if blocked
    if (data.blockedUntil) {
      const blockedUntilMs = data.blockedUntil._seconds * 1000;
      const now = Date.now();

      if (now < blockedUntilMs) {
        // Still blocked - add to cache for future requests
        blockedChatsCache.set(chatId, blockedUntilMs);
        return true;
      }

      // Block expired
    }

    return false;
  } catch (error) {
    logger.error({ error, chatId }, 'Error checking rate limit');
    // On error, allow the request (fail open)
    return false;
  }
}

/**
 * Get current rate limit status for a chat (for logging)
 */
export async function getRateLimitStatus(chatId: number): Promise<{
  blocked: boolean;
  attempts: number;
  blockedUntil?: Date;
}> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(`onboard_${chatId}`);
    const doc = await docRef.get();

    if (!doc.exists) {
      return { blocked: false, attempts: 0 };
    }

    const data = doc.data() as RateLimitDoc;
    const blocked = data.blockedUntil ? Date.now() < data.blockedUntil._seconds * 1000 : false;

    return {
      blocked,
      attempts: data.attempts,
      blockedUntil: data.blockedUntil ? new Date(data.blockedUntil._seconds * 1000) : undefined,
    };
  } catch (error) {
    logger.error({ error, chatId }, 'Error getting rate limit status');
    return { blocked: false, attempts: 0 };
  }
}

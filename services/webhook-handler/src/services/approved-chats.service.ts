/**
 * Approved Chats Service (Webhook-Handler)
 * Checks Firestore if a chat has been approved via invite code
 * Uses in-memory cache to avoid repeated Firestore reads
 */

import { Firestore } from '@google-cloud/firestore';
import logger from '../logger';

const COLLECTION_NAME = 'approved_chats';
const ONBOARDING_SESSIONS_COLLECTION = 'onboarding_sessions';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

// In-memory cache of approved chats (chatId -> { approved, expiry })
// Cache for 5 minutes to balance freshness vs performance
const approvedChatsCache = new Map<number, { approved: boolean; expiry: number }>();
const onboardingSessionsCache = new Map<number, { inOnboarding: boolean; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup expired entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    let cleaned = 0;

    for (const [chatId, entry] of approvedChatsCache.entries()) {
      if (now >= entry.expiry) {
        approvedChatsCache.delete(chatId);
        cleaned++;
      }
    }

    for (const [chatId, entry] of onboardingSessionsCache.entries()) {
      if (now >= entry.expiry) {
        onboardingSessionsCache.delete(chatId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned expired cache entries');
    }
  },
  5 * 60 * 1000
);

/**
 * Check if a chat has an active onboarding session
 * Uses in-memory cache to avoid excessive Firestore reads
 * @returns true if in onboarding, false otherwise
 */
export async function isInOnboarding(chatId: number): Promise<boolean> {
  // 1. Check in-memory cache first
  const cached = onboardingSessionsCache.get(chatId);
  if (cached && Date.now() < cached.expiry) {
    return cached.inOnboarding;
  }

  // 2. Not in cache or expired - check Firestore
  try {
    const db = getFirestore();
    const docRef = db.collection(ONBOARDING_SESSIONS_COLLECTION).doc(chatId.toString());
    const doc = await docRef.get();

    if (!doc.exists) {
      // No session
      onboardingSessionsCache.set(chatId, {
        inOnboarding: false,
        expiry: Date.now() + CACHE_TTL_MS,
      });
      return false;
    }

    const data = doc.data();
    const inOnboarding = data?.active === true;

    // Cache the result
    onboardingSessionsCache.set(chatId, {
      inOnboarding,
      expiry: Date.now() + CACHE_TTL_MS,
    });

    return inOnboarding;
  } catch (error) {
    logger.error({ error, chatId }, 'Error checking onboarding session');
    // On error, assume not in onboarding (fail safe - won't disrupt invoice flow)
    return false;
  }
}

/**
 * Check if a chat is approved for using the bot
 * Uses in-memory cache to avoid excessive Firestore reads
 * @returns true if approved, false if not approved or in onboarding
 */
export async function isChatApproved(chatId: number): Promise<boolean> {
  // 1. Check in-memory cache first
  const cached = approvedChatsCache.get(chatId);
  if (cached && Date.now() < cached.expiry) {
    return cached.approved;
  }

  // 2. Not in cache or expired - check Firestore
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(chatId.toString());
    const doc = await docRef.get();

    const approved = doc.exists;

    // Cache the result
    approvedChatsCache.set(chatId, {
      approved,
      expiry: Date.now() + CACHE_TTL_MS,
    });

    return approved;
  } catch (error) {
    logger.error({ error, chatId }, 'Error checking chat approval');
    // On error, assume not approved (fail safe)
    return false;
  }
}

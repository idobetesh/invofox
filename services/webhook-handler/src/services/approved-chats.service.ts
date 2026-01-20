/**
 * Approved Chats Service (Webhook-Handler)
 * Checks Firestore if a chat has been approved via invite code
 * Uses in-memory cache to avoid repeated Firestore reads
 */

import { Firestore } from '@google-cloud/firestore';

const COLLECTION_NAME = 'approved_chats';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

// In-memory cache of approved chats (chatId -> true)
// Cache for 5 minutes to balance freshness vs performance
const approvedChatsCache = new Map<number, { approved: boolean; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
    console.error('[ApprovedChatsService] Error checking chat approval:', error);
    // On error, assume not approved (fail safe)
    return false;
  }
}

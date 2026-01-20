/**
 * Approved Chats Service
 * Tracks which Telegram chats are approved to use the bot
 *
 * Security: Only approved chats can proceed with onboarding
 */

import { Firestore, Timestamp, FieldValue } from '@google-cloud/firestore';
import logger from '../logger';
import { ApprovedChat } from '../../../../shared/types';

const COLLECTION_NAME = 'approved_chats';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Check if a chat is approved
 * @param chatId Telegram chat ID
 * @returns True if approved and active
 */
export async function isChatApproved(chatId: number): Promise<boolean> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(String(chatId));
  const doc = await docRef.get();

  if (!doc.exists) {
    return false;
  }

  const chat = doc.data() as ApprovedChat;
  return chat.status === 'active';
}

/**
 * Approve a chat with invite code
 * @param chatId Telegram chat ID
 * @param chatTitle Chat title
 * @param inviteCode Invite code used
 * @param adminUserId Admin who created the code
 */
export async function approveChatWithInviteCode(
  chatId: number,
  chatTitle: string,
  inviteCode: string,
  adminUserId?: number
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(String(chatId));

  // Check if already approved
  const existing = await docRef.get();
  if (existing.exists) {
    logger.warn({ chatId, chatTitle }, 'Chat already approved, skipping');
    return;
  }

  const approvedChat: ApprovedChat = {
    chatId,
    chatTitle,
    approvedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    approvedBy: {
      method: 'invite_code',
      code: inviteCode,
      adminUserId,
    },
    status: 'active',
  };

  await docRef.set(approvedChat);

  logger.info({ chatId, chatTitle, inviteCode, adminUserId }, 'Chat approved with invite code');
}

/**
 * Manually approve a chat (admin action)
 * @param chatId Telegram chat ID
 * @param chatTitle Chat title
 * @param adminUserId Admin approving the chat
 * @param note Optional note
 */
export async function approveChatManually(
  chatId: number,
  chatTitle: string,
  adminUserId: number,
  note?: string
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(String(chatId));

  const approvedChat: ApprovedChat = {
    chatId,
    chatTitle,
    approvedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    approvedBy: {
      method: 'manual',
      adminUserId,
      note,
    },
    status: 'active',
  };

  await docRef.set(approvedChat);

  logger.info({ chatId, chatTitle, adminUserId, note }, 'Chat approved manually');
}

/**
 * Suspend a chat (temporary)
 * @param chatId Telegram chat ID
 */
export async function suspendChat(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(String(chatId));

  await docRef.update({
    status: 'suspended',
  });

  logger.warn({ chatId }, 'Chat suspended');
}

/**
 * Ban a chat (permanent)
 * @param chatId Telegram chat ID
 */
export async function banChat(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(String(chatId));

  await docRef.update({
    status: 'banned',
  });

  logger.warn({ chatId }, 'Chat banned');
}

/**
 * Reactivate a suspended chat
 * @param chatId Telegram chat ID
 */
export async function reactivateChat(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(String(chatId));

  await docRef.update({
    status: 'active',
  });

  logger.info({ chatId }, 'Chat reactivated');
}

/**
 * Get approved chat details
 * @param chatId Telegram chat ID
 * @returns Approved chat or null
 */
export async function getApprovedChat(chatId: number): Promise<ApprovedChat | null> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(String(chatId));
  const doc = await docRef.get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as ApprovedChat;
}

/**
 * List all approved chats
 * @param status Filter by status (optional)
 * @returns List of approved chats
 */
export async function listApprovedChats(
  status?: 'active' | 'suspended' | 'banned'
): Promise<ApprovedChat[]> {
  const db = getFirestore();
  let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME).orderBy('approvedAt', 'desc');

  if (status) {
    query = query.where('status', '==', status);
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data() as ApprovedChat);
}

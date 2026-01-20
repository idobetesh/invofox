/**
 * Invite Code Service
 * Generates and validates one-time invite codes for customer onboarding
 *
 * Security: Admin-initiated onboarding prevents DDoS attacks
 */

import { Firestore, Timestamp, FieldValue } from '@google-cloud/firestore';
import * as crypto from 'crypto';
import logger from '../logger';
import { InviteCode, ValidationResult } from '../../../../shared/types';

const COLLECTION_NAME = 'invite_codes';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Helper: Convert timestamp to milliseconds
 */
function toMillis(timestamp: Date | { toMillis: () => number }): number {
  if (timestamp instanceof Timestamp) {
    return timestamp.toMillis();
  } else if (typeof timestamp === 'object' && 'toMillis' in timestamp) {
    return timestamp.toMillis();
  } else {
    return new Date(timestamp as Date).getTime();
  }
}

/**
 * Generate a cryptographically secure invite code
 * Format: INV-XXXXXX (6 characters, no confusing chars)
 */
export function generateInviteCode(): string {
  // Character set excludes confusing characters (0/O, 1/I/l)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const length = 6;

  let code = 'INV-';
  const randomBytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    code += chars[randomBytes[i] % chars.length];
  }

  return code;
}

/**
 * Create a new invite code
 * @param createdBy Admin user creating the code
 * @param note Optional note (e.g., "Acme Corp onboarding")
 * @param expiresInDays Days until expiration (default: 7)
 */
export async function createInviteCode(
  createdBy: { userId: number; username: string },
  note: string = '',
  expiresInDays: number = 7
): Promise<InviteCode> {
  const db = getFirestore();

  // Generate unique code
  let code: string;
  let exists: boolean;

  // Retry until we get a unique code (collision is extremely rare with 1B+ combinations)
  do {
    code = generateInviteCode();
    const docRef = db.collection(COLLECTION_NAME).doc(code);
    const doc = await docRef.get();
    exists = doc.exists;
  } while (exists);

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + expiresInDays * 24 * 60 * 60 * 1000);

  const inviteCode: InviteCode = {
    code,
    createdBy,
    createdAt: now,
    expiresAt,
    used: false,
    usedBy: null,
    usedAt: null,
    note,
    revoked: false,
  };

  await db.collection(COLLECTION_NAME).doc(code).set(inviteCode);

  logger.info({ code, createdBy: createdBy.username, expiresInDays, note }, 'Invite code created');

  return inviteCode;
}

/**
 * Validate an invite code
 * @param code Invite code to validate
 * @returns Validation result with detailed reason if invalid
 */
export async function validateInviteCode(code: string): Promise<ValidationResult> {
  // 1. Check format
  if (!code.match(/^INV-[A-Z2-9]{6}$/)) {
    logger.debug({ code }, 'Invalid invite code format');
    return { valid: false, reason: 'invalid_format' };
  }

  // 2. Fetch from database
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(code);
  const doc = await docRef.get();

  if (!doc.exists) {
    logger.warn({ code }, 'Invite code not found');
    return { valid: false, reason: 'not_found' };
  }

  const invite = doc.data() as InviteCode;

  // 3. Check if revoked
  if (invite.revoked) {
    logger.warn({ code }, 'Invite code revoked');
    return { valid: false, reason: 'revoked' };
  }

  // 4. Check if already used
  if (invite.used) {
    logger.warn({ code, usedBy: invite.usedBy }, 'Invite code already used');
    return { valid: false, reason: 'used', usedBy: invite.usedBy || undefined };
  }

  // 5. Check expiration
  if (Timestamp.now().toMillis() > toMillis(invite.expiresAt)) {
    logger.warn({ code, expiresAt: invite.expiresAt }, 'Invite code expired');
    return { valid: false, reason: 'expired' };
  }

  // 6. All checks passed
  logger.info({ code }, 'Invite code validated successfully');
  return { valid: true, invite };
}

/**
 * Mark invite code as used
 * @param code Invite code
 * @param usedBy Chat that used the code
 */
export async function markInviteCodeAsUsed(
  code: string,
  usedBy: { chatId: number; chatTitle: string }
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(code);

  await docRef.update({
    used: true,
    usedBy,
    usedAt: FieldValue.serverTimestamp(),
  });

  logger.info({ code, usedBy }, 'Invite code marked as used');
}

/**
 * Revoke an unused invite code
 * @param code Invite code to revoke
 */
export async function revokeInviteCode(code: string): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(code);

  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error('Invite code not found');
  }

  const invite = doc.data() as InviteCode;
  if (invite.used) {
    throw new Error('Cannot revoke used invite code');
  }

  await docRef.update({
    revoked: true,
  });

  logger.info({ code }, 'Invite code revoked');
}

/**
 * Delete an unused invite code
 * @param code Invite code to delete
 */
export async function deleteInviteCode(code: string): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(code);

  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error('Invite code not found');
  }

  const invite = doc.data() as InviteCode;
  if (invite.used) {
    throw new Error('Cannot delete used invite code');
  }

  await docRef.delete();

  logger.info({ code }, 'Invite code deleted');
}

/**
 * List invite codes by status
 * @param status Filter by status (active, used, expired, all)
 * @returns List of invite codes
 */
export async function listInviteCodes(
  status: 'active' | 'used' | 'expired' | 'all' = 'all'
): Promise<InviteCode[]> {
  const db = getFirestore();
  const collection = db.collection(COLLECTION_NAME);

  let query = collection.orderBy('createdAt', 'desc');

  // Apply filters based on status
  if (status === 'used') {
    query = query.where('used', '==', true);
  } else if (status === 'active') {
    query = query.where('used', '==', false).where('revoked', '==', false);
  }

  const snapshot = await query.get();
  const codes = snapshot.docs.map((doc) => doc.data() as InviteCode);

  // Filter expired codes in-memory (Firestore doesn't support dynamic time comparisons)
  if (status === 'expired') {
    const now = Timestamp.now().toMillis();
    return codes.filter((code) => !code.used && !code.revoked && toMillis(code.expiresAt) < now);
  } else if (status === 'active') {
    const now = Timestamp.now().toMillis();
    return codes.filter((code) => toMillis(code.expiresAt) >= now);
  }

  return codes;
}

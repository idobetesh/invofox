/**
 * Invoice session service
 * Manages conversation state for invoice generation flow
 * Sessions are stored in Firestore and expire after 1 hour
 */

import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import type {
  InvoiceSession,
  InvoiceDocumentType,
  PaymentMethod,
} from '../../../../../shared/types';
import logger from '../../logger';

const COLLECTION_NAME = 'invoice_sessions';
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Generate session document ID from chat and user IDs
 */
export function getSessionId(chatId: number, userId: number): string {
  return `${chatId}_${userId}`;
}

/**
 * Get active session for a user in a chat
 * Returns null if no session exists or session is expired
 */
export async function getSession(chatId: number, userId: number): Promise<InvoiceSession | null> {
  const db = getFirestore();
  const sessionId = getSessionId(chatId, userId);
  const docRef = db.collection(COLLECTION_NAME).doc(sessionId);
  const log = logger.child({ sessionId });

  const doc = await docRef.get();

  if (!doc.exists) {
    log.debug('No session found');
    return null;
  }

  const session = doc.data() as InvoiceSession;

  // Check if session is expired
  const updatedAt = session.updatedAt as Timestamp;
  const age = Date.now() - updatedAt.toMillis();

  if (age > SESSION_TTL_MS) {
    log.info({ ageMinutes: Math.round(age / 60000) }, 'Session expired, deleting');
    await docRef.delete();
    return null;
  }

  log.debug({ status: session.status }, 'Session found');
  return session;
}

/**
 * Create a new invoice session
 * Starts in 'select_type' status
 */
export async function createSession(chatId: number, userId: number): Promise<InvoiceSession> {
  const db = getFirestore();
  const sessionId = getSessionId(chatId, userId);
  const docRef = db.collection(COLLECTION_NAME).doc(sessionId);
  const log = logger.child({ sessionId });

  const session: InvoiceSession = {
    status: 'select_type',
    createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
  };

  await docRef.set(session);

  log.info('Session created');
  return session;
}

/**
 * Update session with new data
 * Returns the updated session (Firestore guarantees read-after-write consistency)
 */
export async function updateSession(
  chatId: number,
  userId: number,
  updates: Partial<Omit<InvoiceSession, 'createdAt' | 'updatedAt'>>
): Promise<InvoiceSession> {
  const db = getFirestore();
  const sessionId = getSessionId(chatId, userId);
  const docRef = db.collection(COLLECTION_NAME).doc(sessionId);
  const log = logger.child({ sessionId });

  await docRef.update({
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Read back the updated document
  // Firestore guarantees read-after-write consistency for single documents
  const doc = await docRef.get();

  if (!doc.exists) {
    log.error('Session not found after update');
    throw new Error('Session not found after update');
  }

  const session = doc.data() as InvoiceSession;

  // Re-validate expiration (since we just read it)
  const updatedAt = session.updatedAt as Timestamp;
  const age = Date.now() - updatedAt.toMillis();

  if (age > SESSION_TTL_MS) {
    log.info({ ageMinutes: Math.round(age / 60000) }, 'Session expired during update, deleting');
    await docRef.delete();
    throw new Error('Session expired during update');
  }

  log.debug({ updates, status: session.status }, 'Session updated and returned');
  return session;
}

/**
 * Set document type and move to awaiting_details status
 * Returns the updated session
 */
export async function setDocumentType(
  chatId: number,
  userId: number,
  documentType: InvoiceDocumentType
): Promise<InvoiceSession> {
  return await updateSession(chatId, userId, {
    status: 'awaiting_details',
    documentType,
  });
}

/**
 * Set customer details and move to awaiting_payment status
 * Returns the updated session
 */
export async function setDetails(
  chatId: number,
  userId: number,
  details: {
    customerName: string;
    customerTaxId?: string;
    description: string;
    amount: number;
  }
): Promise<InvoiceSession> {
  const updates: Partial<Omit<InvoiceSession, 'createdAt' | 'updatedAt'>> = {
    status: 'awaiting_payment',
    customerName: details.customerName,
    description: details.description,
    amount: details.amount,
    ...(details.customerTaxId !== undefined && { customerTaxId: details.customerTaxId }),
  };

  return await updateSession(chatId, userId, updates);
}

/**
 * Set payment method and move to confirming status
 * Returns the updated session
 */
export async function setPaymentMethod(
  chatId: number,
  userId: number,
  paymentMethod: PaymentMethod,
  date?: string
): Promise<InvoiceSession> {
  const today = new Date();
  const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return await updateSession(chatId, userId, {
    status: 'confirming',
    paymentMethod,
    date: date || defaultDate,
  });
}

/**
 * Delete session after completion or cancellation
 */
export async function deleteSession(chatId: number, userId: number): Promise<void> {
  const db = getFirestore();
  const sessionId = getSessionId(chatId, userId);
  const docRef = db.collection(COLLECTION_NAME).doc(sessionId);
  const log = logger.child({ sessionId });

  await docRef.delete();

  log.info('Session deleted');
}

/**
 * Get complete session data for invoice generation
 * Returns null if session is not in 'confirming' status or missing required fields
 */
export async function getConfirmedSession(
  chatId: number,
  userId: number
): Promise<InvoiceSession | null> {
  const session = await getSession(chatId, userId);

  if (!session) {
    return null;
  }

  if (session.status !== 'confirming') {
    logger.warn({ status: session.status }, 'Session not in confirming status');
    return null;
  }

  // Validate all required fields
  if (
    !session.documentType ||
    !session.customerName ||
    !session.description ||
    session.amount === undefined ||
    !session.paymentMethod ||
    !session.date
  ) {
    logger.warn('Session missing required fields');
    return null;
  }

  return session;
}

/**
 * Cleanup stale sessions older than TTL
 * Should be called periodically (e.g., via Cloud Scheduler)
 */
export async function cleanupStaleSessions(): Promise<number> {
  const db = getFirestore();
  const log = logger.child({ function: 'cleanupStaleSessions' });

  const cutoff = new Date(Date.now() - SESSION_TTL_MS);

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('updatedAt', '<', Timestamp.fromDate(cutoff))
    .get();

  if (snapshot.empty) {
    log.debug('No stale sessions to cleanup');
    return 0;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();

  log.info({ count: snapshot.size }, 'Cleaned up stale sessions');
  return snapshot.size;
}

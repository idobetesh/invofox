/**
 * Onboarding state management service
 * Manages conversational onboarding flow for new customers
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import type { Language } from '../i18n/languages';
import logger from '../../logger';

const COLLECTION_NAME = 'onboarding_sessions';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Onboarding steps
 */
export type OnboardingStep =
  | 'language'
  | 'business_name'
  | 'owner_details'
  | 'address'
  | 'tax_status'
  | 'logo'
  | 'sheet'
  | 'counter'
  | 'complete';

/**
 * Onboarding session state
 * Stored in Firestore: onboarding_sessions/{chatId}
 */
export interface OnboardingState {
  chatId: number;
  userId: number;
  language?: Language;
  step: OnboardingStep;
  data: {
    businessName?: string;
    ownerName?: string;
    ownerIdNumber?: string;
    phone?: string;
    email?: string;
    address?: string;
    taxStatus?: string;
    logoUrl?: string;
    sheetId?: string;
    startingCounter?: number;
  };
  startedAt: Date | { toMillis: () => number };
  updatedAt: Date | { toMillis: () => number };
}

/**
 * Start a new onboarding session
 */
export async function startOnboarding(chatId: number, userId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(chatId.toString());

  const session: Omit<OnboardingState, 'startedAt' | 'updatedAt'> = {
    chatId,
    userId,
    step: 'language',
    data: {},
  };

  await docRef.set({
    ...session,
    active: true, // Mark as active so webhook handler can route photos correctly
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info({ chatId, userId }, 'Onboarding session started');
}

/**
 * Get current onboarding session
 * Returns null if no active session
 */
export async function getOnboardingSession(chatId: number): Promise<OnboardingState | null> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(chatId.toString());
  const doc = await docRef.get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as OnboardingState;
}

/**
 * Update onboarding session
 */
export async function updateOnboardingSession(
  chatId: number,
  updates: Partial<OnboardingState>
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(chatId.toString());

  await docRef.update({
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.debug({ chatId, updates }, 'Onboarding session updated');
}

/**
 * Update onboarding data field
 */
export async function updateOnboardingData(
  chatId: number,
  dataUpdates: Partial<OnboardingState['data']>
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(chatId.toString());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateFields: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  // Add data fields with dot notation
  Object.entries(dataUpdates).forEach(([key, value]) => {
    updateFields[`data.${key}`] = value;
  });

  await docRef.update(updateFields);

  logger.debug({ chatId, dataUpdates }, 'Onboarding data updated');
}

/**
 * Complete and delete onboarding session
 */
export async function completeOnboarding(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(chatId.toString());

  // Mark as inactive first (helps with webhook handler cache)
  await docRef.update({ active: false });

  // Then delete the session
  await docRef.delete();

  logger.info({ chatId }, 'Onboarding session completed and deleted');
}

/**
 * Cancel and delete onboarding session
 */
export async function cancelOnboarding(chatId: number): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(chatId.toString());

  await docRef.delete();

  logger.info({ chatId }, 'Onboarding session cancelled');
}

/**
 * Check if user is in onboarding flow
 */
export async function isInOnboarding(chatId: number): Promise<boolean> {
  const session = await getOnboardingSession(chatId);
  return session !== null;
}

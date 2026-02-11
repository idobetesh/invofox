/**
 * Firestore store service
 * Centralized Firestore instance management
 */

import { Firestore } from '@google-cloud/firestore';

let firestore: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Store service
 * Centralized Firestore and Storage instance management
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

let firestore: Firestore | null = null;
let storage: Storage | null = null;

export function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

export function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

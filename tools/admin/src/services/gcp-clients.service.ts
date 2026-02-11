/**
 * GCP Clients Service
 * Centralized Firestore and Storage singleton instances
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

let firestoreInstance: Firestore | null = null;
let storageInstance: Storage | null = null;

export function getFirestoreClient(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = new Firestore();
  }
  return firestoreInstance;
}

export function getStorageClient(): Storage {
  if (!storageInstance) {
    storageInstance = new Storage();
  }
  return storageInstance;
}

import { Firestore, Timestamp } from '@google-cloud/firestore';
import {
  APPROVED_CHATS_COLLECTION,
  BROADCAST_NOTIFICATIONS_COLLECTION,
  BUSINESS_CONFIG_COLLECTION,
  FLAG_AUDIT_LOG_COLLECTION,
  GENERATED_INVOICE_RECEIPTS_COLLECTION,
  GENERATED_INVOICES_COLLECTION,
  GENERATED_RECEIPTS_COLLECTION,
  INVITE_CODES_COLLECTION,
  INVOICE_COUNTERS_COLLECTION,
  INVOICE_JOBS_COLLECTION,
  INVOICE_SESSIONS_COLLECTION,
  ONBOARDING_SESSIONS_COLLECTION,
  PROCESSING_JOBS_COLLECTION,
  RATE_LIMITS_COLLECTION,
  REPORT_SESSIONS_COLLECTION,
  USER_CUSTOMER_MAPPING_COLLECTION,
} from '../../../../shared/collections';

export interface FirestoreDocument {
  id: string;
  data: Record<string, unknown>;
  createdAt?: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
}

export interface ListDocumentsResult {
  documents: FirestoreDocument[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

export class FirestoreService {
  constructor(private firestore: Firestore) {}

  /**
   * Get known collections from the codebase
   */
  getKnownCollections(): string[] {
    return [
      APPROVED_CHATS_COLLECTION,
      BUSINESS_CONFIG_COLLECTION,
      GENERATED_INVOICES_COLLECTION,
      GENERATED_INVOICE_RECEIPTS_COLLECTION,
      GENERATED_RECEIPTS_COLLECTION,
      INVITE_CODES_COLLECTION,
      INVOICE_COUNTERS_COLLECTION,
      INVOICE_JOBS_COLLECTION,
      INVOICE_SESSIONS_COLLECTION,
      ONBOARDING_SESSIONS_COLLECTION,
      PROCESSING_JOBS_COLLECTION,
      RATE_LIMITS_COLLECTION,
      REPORT_SESSIONS_COLLECTION,
      USER_CUSTOMER_MAPPING_COLLECTION,
      FLAG_AUDIT_LOG_COLLECTION,
      BROADCAST_NOTIFICATIONS_COLLECTION,
    ];
  }

  /**
   * List documents in a collection with pagination
   */
  async listDocuments(
    collectionName: string,
    options: {
      limit?: number;
      startAfter?: string;
    } = {}
  ): Promise<ListDocumentsResult> {
    const limit = options.limit || 50;
    const { startAfter } = options;

    const collectionRef = this.firestore.collection(collectionName);
    let query = collectionRef.orderBy('__name__').limit(limit);

    if (startAfter) {
      const startAfterDoc = await collectionRef.doc(startAfter).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    const snapshot = await query.get();
    const documents = snapshot.docs.map((doc) => {
      const docData = doc.data() || {};
      return {
        id: doc.id,
        data: docData as Record<string, unknown>,
        createdAt: docData.createdAt,
        updatedAt: docData.updatedAt,
      };
    });

    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    const hasMore = snapshot.docs.length === limit;

    return {
      documents,
      hasMore,
      nextCursor: hasMore && lastDoc ? lastDoc.id : null,
      total: documents.length,
    };
  }

  /**
   * Get a specific document
   */
  async getDocument(collectionName: string, documentId: string): Promise<FirestoreDocument | null> {
    const docRef = this.firestore.collection(collectionName).doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const docData = doc.data() || {};
    return {
      id: doc.id,
      data: docData as Record<string, unknown>,
    };
  }

  /**
   * Delete a document
   */
  async deleteDocument(collectionName: string, documentId: string): Promise<void> {
    const docRef = this.firestore.collection(collectionName).doc(documentId);
    await docRef.delete();
  }

  /**
   * Delete multiple documents
   */
  async deleteDocuments(collectionName: string, documentIds: string[]): Promise<void> {
    const batch = this.firestore.batch();
    documentIds.forEach((id: string) => {
      const docRef = this.firestore.collection(collectionName).doc(id);
      batch.delete(docRef);
    });

    await batch.commit();
  }

  /**
   * Update a document
   */
  async updateDocument(
    collectionName: string,
    documentId: string,
    data: Record<string, unknown>
  ): Promise<FirestoreDocument> {
    const docRef = this.firestore.collection(collectionName).doc(documentId);
    await docRef.set(data, { merge: false }); // Use set with merge: false to replace entire document

    // Read back the updated document
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Document not found after update');
    }

    const docData = doc.data() || {};
    return {
      id: doc.id,
      data: docData as Record<string, unknown>,
    };
  }

  /**
   * Check onboarding session status for a chatId
   * @returns Status object with session state
   */
  async getOnboardingStatus(chatId: number): Promise<{
    exists: boolean;
    status?: 'in_progress' | 'stuck';
    age?: number; // hours
    step?: string;
  }> {
    const docRef = this.firestore.collection(ONBOARDING_SESSIONS_COLLECTION).doc(chatId.toString());
    const doc = await docRef.get();

    if (!doc.exists) {
      return { exists: false };
    }

    const data = doc.data();
    if (!data) {
      return { exists: false };
    }

    // Calculate age
    const startedAt = data.startedAt;
    let ageHours = 0;

    if (startedAt && typeof startedAt === 'object' && 'toMillis' in startedAt) {
      const ageMs = Date.now() - startedAt.toMillis();
      ageHours = ageMs / (1000 * 60 * 60);
    } else if (startedAt instanceof Date) {
      const ageMs = Date.now() - startedAt.getTime();
      ageHours = ageMs / (1000 * 60 * 60);
    }

    // Consider stuck if older than 24 hours
    const status = ageHours > 24 ? 'stuck' : 'in_progress';

    return {
      exists: true,
      status,
      age: Math.round(ageHours * 10) / 10, // Round to 1 decimal
      step: data.step as string,
    };
  }

  /**
   * Delete onboarding session and optionally the invite code
   * @param chatId Chat ID for the onboarding session
   * @param inviteCode Optional invite code to delete as well
   */
  async cleanupOnboarding(chatId: number, inviteCode?: string): Promise<void> {
    const batch = this.firestore.batch();

    // Delete onboarding session
    const sessionRef = this.firestore
      .collection(ONBOARDING_SESSIONS_COLLECTION)
      .doc(chatId.toString());
    batch.delete(sessionRef);

    // Delete invite code if provided
    if (inviteCode) {
      const codeRef = this.firestore.collection(INVITE_CODES_COLLECTION).doc(inviteCode);
      batch.delete(codeRef);
    }

    await batch.commit();
  }
}

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
import { getCreatedAtMillis } from '../utils/timestamp';

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
   * Primary timestamp field used for "newest first" ordering per collection.
   */
  private getSortFieldForCollection(collectionName: string): string {
    const generatedAtCollections = new Set([
      GENERATED_INVOICES_COLLECTION,
      GENERATED_RECEIPTS_COLLECTION,
      GENERATED_INVOICE_RECEIPTS_COLLECTION,
    ]);

    if (generatedAtCollections.has(collectionName)) {
      return 'generatedAt';
    }

    if (collectionName === ONBOARDING_SESSIONS_COLLECTION) {
      return 'startedAt';
    }

    return 'createdAt';
  }

  /**
   * List documents in a collection with pagination (newest by create date first).
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
    const sortField = this.getSortFieldForCollection(collectionName);

    const collectionRef = this.firestore.collection(collectionName);

    try {
      let query = collectionRef.orderBy(sortField, 'desc').limit(limit);

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
          createdAt: docData.createdAt ?? docData.generatedAt ?? docData.startedAt,
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
    } catch (error) {
      // Fallback when the collection lacks the expected timestamp field / index
      console.warn(
        `orderBy(${sortField}) failed for ${collectionName}, falling back to in-memory sort:`,
        error
      );
      return this.listDocumentsSortedInMemory(collectionName, sortField, limit, startAfter);
    }
  }

  /**
   * Fallback listing: fetch a larger batch and sort by creation time in memory.
   */
  private async listDocumentsSortedInMemory(
    collectionName: string,
    sortField: string,
    limit: number,
    startAfter?: string
  ): Promise<ListDocumentsResult> {
    const collectionRef = this.firestore.collection(collectionName);
    const snapshot = await collectionRef.limit(500).get();

    const sorted = snapshot.docs
      .map((doc) => {
        const docData = doc.data() || {};
        return {
          id: doc.id,
          data: docData as Record<string, unknown>,
          createdAt: docData.createdAt ?? docData.generatedAt ?? docData.startedAt,
          updatedAt: docData.updatedAt,
          sortMs: getCreatedAtMillis(docData as Record<string, unknown>, sortField),
        };
      })
      .sort((a, b) => b.sortMs - a.sortMs);

    let startIndex = 0;
    if (startAfter) {
      const cursorIndex = sorted.findIndex((doc) => doc.id === startAfter);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = sorted.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < sorted.length;
    const lastDoc = page[page.length - 1];

    return {
      documents: page.map(({ id, data, createdAt, updatedAt }) => ({
        id,
        data,
        createdAt,
        updatedAt,
      })),
      hasMore,
      nextCursor: hasMore && lastDoc ? lastDoc.id : null,
      total: page.length,
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

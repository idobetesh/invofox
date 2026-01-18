import { Firestore, Timestamp } from '@google-cloud/firestore';

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
      'invoice_sessions',
      'generated_invoices',
      'invoice_jobs',
      'invoice_counters',
      'business_config',
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
}

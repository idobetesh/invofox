/**
 * Invoice Jobs Service (Admin)
 * List and correct OCR-processed invoice jobs from Firestore
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';

const INVOICE_JOBS_COLLECTION = 'invoice_jobs';

export interface InvoiceJobRecord {
  jobId: string;
  chatId: number;
  messageId: number;
  vendorName: string | null;
  totalAmount: number | null;
  invoiceDate: string | null;
  currency: string | null;
  category: string | null;
  uploaderUsername: string;
  chatTitle: string;
  receivedAt: string;
  driveLink: string | null;
  sheetRowId: number | null;
  status: string;
  createdAt: unknown;
}

export interface InvoiceJobCorrection {
  totalAmount?: number;
  invoiceDate?: string;
  vendorName?: string;
}

export class InvoiceJobsService {
  constructor(private firestore: Firestore) {}

  async listInvoiceJobs(chatId?: number, limit = 50): Promise<InvoiceJobRecord[]> {
    // Use simple queries to avoid requiring composite Firestore indexes.
    // Sort in memory after fetching.
    let baseQuery = this.firestore.collection(INVOICE_JOBS_COLLECTION).limit(limit * 3);

    if (chatId !== undefined) {
      baseQuery = this.firestore
        .collection(INVOICE_JOBS_COLLECTION)
        .where('telegramChatId', '==', chatId)
        .limit(limit * 3) as typeof baseQuery;
    }

    const snapshot = await baseQuery.get();

    const records = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        jobId: doc.id,
        chatId: d.telegramChatId,
        messageId: d.telegramMessageId,
        vendorName: d.vendorName ?? null,
        totalAmount: d.totalAmount ?? null,
        invoiceDate: d.invoiceDate ?? null,
        currency: d.currency ?? null,
        category: d.category ?? null,
        uploaderUsername: d.uploaderUsername || '',
        chatTitle: d.chatTitle || '',
        receivedAt: d.receivedAt || '',
        driveLink: d.driveLink ?? null,
        sheetRowId: d.sheetRowId ?? null,
        status: d.status || '',
        createdAt: d.createdAt,
      };
    });

    // Sort by receivedAt descending (most recent first), then trim to limit
    records.sort((a, b) => {
      const ta = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const tb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return tb - ta;
    });

    return records.slice(0, limit);
  }

  async correctInvoiceJob(
    jobId: string,
    updates: InvoiceJobCorrection
  ): Promise<{ firestoreUpdated: boolean }> {
    const docRef = this.firestore.collection(INVOICE_JOBS_COLLECTION).doc(jobId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error(`Job ${jobId} not found`);
    }

    const firestoreUpdates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (updates.totalAmount !== undefined) {
      firestoreUpdates.totalAmount = updates.totalAmount;
    }
    if (updates.invoiceDate !== undefined) {
      firestoreUpdates.invoiceDate = updates.invoiceDate;
    }
    if (updates.vendorName !== undefined) {
      firestoreUpdates.vendorName = updates.vendorName;
    }

    await docRef.update(firestoreUpdates);

    return { firestoreUpdated: true };
  }
}

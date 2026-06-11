/**
 * Invoice Jobs Service (Admin)
 * List and correct OCR-processed invoice jobs from Firestore
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { INVOICE_JOBS_COLLECTION } from '../../../../shared/collections';
import { toMillis } from '../utils/timestamp';

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
    const collection = this.firestore.collection(INVOICE_JOBS_COLLECTION);

    // Prefer server-side ordering when no chat filter (single-field index).
    // With chat filter, fetch matching docs and sort by createdAt in memory.
    const snapshot =
      chatId === undefined
        ? await collection.orderBy('createdAt', 'desc').limit(limit).get()
        : await collection.where('telegramChatId', '==', chatId).get();

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

    records.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

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

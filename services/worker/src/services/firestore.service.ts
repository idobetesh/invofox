/**
 * Firestore store service for job state and idempotency
 */

import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import type {
  InvoiceJob,
  JobStatus,
  PipelineStep,
  InvoiceExtraction,
} from '../../../../shared/types';
import logger from '../logger';

import { INVOICE_JOBS_COLLECTION } from '../../../../shared/collections';

// Dedicated index collection: one doc per chatId → { jobId }
// Provides O(1) lookup without requiring a composite Firestore index
const CORRECTION_PENDING_INDEX_COLLECTION = 'invoice_correction_pending_index';
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

let firestore: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

/**
 * Generate document ID from chat and message IDs
 */
export function getJobId(chatId: number, messageId: number): string {
  return `${chatId}_${messageId}`;
}

/**
 * Claim a job for processing using Firestore transaction
 * Returns true if job was claimed, false if already processed or being processed
 */
export async function claimJob(
  chatId: number,
  messageId: number,
  payload: {
    telegramFileId: string;
    uploaderUsername: string;
    uploaderFirstName: string;
    chatTitle: string;
    receivedAt: string;
  }
): Promise<{ claimed: boolean; job: InvoiceJob | null }> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);
  const log = logger.child({ jobId: docId });

  return db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    if (doc.exists) {
      const existingJob = doc.data() as InvoiceJob;

      // Already processed - dedupe
      if (existingJob.status === 'processed') {
        log.debug('Job already processed, skipping');
        return { claimed: false, job: existingJob };
      }

      // Failed after max retries - don't retry
      if (existingJob.status === 'failed') {
        log.debug('Job already failed, skipping');
        return { claimed: false, job: existingJob };
      }

      // Pending retry - always allow reclaim (Cloud Tasks is retrying)
      if (existingJob.status === 'pending_retry') {
        log.info({ attempts: existingJob.attempts }, 'Job pending retry, reclaiming');
      }
      // Check if stale (processing for too long)
      else if (existingJob.status === 'processing') {
        const updatedAt = existingJob.updatedAt as Timestamp;
        const timeSinceUpdate = Date.now() - updatedAt.toMillis();

        if (timeSinceUpdate < STALE_THRESHOLD_MS) {
          log.debug('Job is being processed, skipping');
          return { claimed: false, job: existingJob };
        }

        log.info('Job is stale, reclaiming');
      }

      // Reclaim job
      const updatedJob: Partial<InvoiceJob> = {
        status: 'processing',
        attempts: (existingJob.attempts || 0) + 1,
        updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
      };

      transaction.update(docRef, updatedJob);

      return {
        claimed: true,
        job: { ...existingJob, ...updatedJob, updatedAt: new Date() } as InvoiceJob,
      };
    }

    // Create new job
    const newJob: InvoiceJob = {
      status: 'processing',
      attempts: 1,
      createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
      updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
      telegramChatId: chatId,
      telegramMessageId: messageId,
      telegramFileId: payload.telegramFileId,
      uploaderUsername: payload.uploaderUsername,
      uploaderFirstName: payload.uploaderFirstName,
      chatTitle: payload.chatTitle,
      receivedAt: payload.receivedAt,
    };

    transaction.set(docRef, newJob);

    return { claimed: true, job: newJob };
  });
}

/**
 * Update job step progress
 */
export async function updateJobStep(
  chatId: number,
  messageId: number,
  step: PipelineStep,
  data?: Partial<InvoiceJob>
): Promise<void> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  await docRef.update({
    lastStep: step,
    updatedAt: FieldValue.serverTimestamp(),
    ...data,
  });
}

/**
 * Mark job as completed successfully
 */
export async function markJobCompleted(
  chatId: number,
  messageId: number,
  data: {
    driveFileId: string;
    driveLink: string;
    sheetRowId?: number;
  }
): Promise<void> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  const updateData: Record<string, unknown> = {
    status: 'processed' as JobStatus,
    updatedAt: FieldValue.serverTimestamp(),
    driveFileId: data.driveFileId,
    driveLink: data.driveLink,
    lastError: FieldValue.delete(),
  };

  // Only include sheetRowId if defined (not set for deleted duplicates)
  if (data.sheetRowId !== undefined) {
    updateData.sheetRowId = data.sheetRowId;
  }

  await docRef.update(updateData);
}

/**
 * Mark job as failed (final - no more retries)
 */
export async function markJobFailed(
  chatId: number,
  messageId: number,
  step: PipelineStep,
  error: string
): Promise<void> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  await docRef.update({
    status: 'failed' as JobStatus,
    updatedAt: FieldValue.serverTimestamp(),
    lastStep: step,
    lastError: error,
  });
}

/**
 * Mark job as pending retry (transient failure, will be retried)
 * Keeps job in a state that allows reclaiming on next retry
 */
export async function markJobPendingRetry(
  chatId: number,
  messageId: number,
  step: PipelineStep,
  error: string
): Promise<void> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  await docRef.update({
    status: 'pending_retry' as JobStatus,
    updatedAt: FieldValue.serverTimestamp(),
    lastStep: step,
    lastError: error,
  });
}

/**
 * Get job by chat and message IDs
 */
export async function getJob(chatId: number, messageId: number): Promise<InvoiceJob | null> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  const doc = await docRef.get();
  return doc.exists ? (doc.data() as InvoiceJob) : null;
}

// ============================================================================
// Duplicate Detection - Moved to duplicate-detection.service.ts
// ============================================================================

// ============================================================================
// Correction Flow Helpers
// ============================================================================

/**
 * Find the job with correctionPending for this chatId.
 * Uses a dedicated index document for O(1) lookup (no composite index required).
 */
export async function getCorrectionPendingJob(
  chatId: number
): Promise<(InvoiceJob & { jobId: string }) | null> {
  const db = getFirestore();

  // Read the index doc to get the jobId directly
  const indexDoc = await db
    .collection(CORRECTION_PENDING_INDEX_COLLECTION)
    .doc(String(chatId))
    .get();

  if (!indexDoc.exists) {
    return null;
  }

  const { jobId } = indexDoc.data() as { jobId: string };
  const jobDoc = await db.collection(INVOICE_JOBS_COLLECTION).doc(jobId).get();

  if (!jobDoc.exists) {
    // Index is stale — clean it up silently
    await db
      .collection(CORRECTION_PENDING_INDEX_COLLECTION)
      .doc(String(chatId))
      .delete()
      .catch(() => {});
    return null;
  }

  const job = jobDoc.data() as InvoiceJob;
  if (!job.correctionPending) {
    // Job no longer has correctionPending — clean up stale index
    await db
      .collection(CORRECTION_PENDING_INDEX_COLLECTION)
      .doc(String(chatId))
      .delete()
      .catch(() => {});
    return null;
  }

  return { ...job, jobId: jobDoc.id };
}

/**
 * Set correctionPending on a job document and update the chatId index.
 */
export async function setCorrectionPending(
  jobId: string,
  field: 'totalAmount' | 'invoiceDate' | 'vendorName',
  promptMessageId: number,
  successMessageId: number
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(jobId);

  await docRef.update({
    correctionPending: { field, promptMessageId, successMessageId },
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Write index: chatId → jobId for fast lookup
  const chatId = parseInt(jobId.split('_')[0], 10);
  if (!isNaN(chatId)) {
    await db.collection(CORRECTION_PENDING_INDEX_COLLECTION).doc(String(chatId)).set({ jobId });
  }
}

/**
 * Remove correctionPending from a job document and delete the chatId index entry.
 */
export async function clearCorrectionPending(jobId: string): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(jobId);

  await docRef.update({
    correctionPending: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Remove index entry (fire-and-forget — non-critical)
  const chatId = parseInt(jobId.split('_')[0], 10);
  if (!isNaN(chatId)) {
    db.collection(CORRECTION_PENDING_INDEX_COLLECTION)
      .doc(String(chatId))
      .delete()
      .catch(() => {});
  }
}

/**
 * Apply a correction to extracted fields in a job document
 */
export async function applyJobCorrection(
  jobId: string,
  updates: { totalAmount?: number; invoiceDate?: string; vendorName?: string }
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(jobId);

  const data: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (updates.totalAmount !== undefined) {
    data.totalAmount = updates.totalAmount;
  }
  if (updates.invoiceDate !== undefined) {
    data.invoiceDate = updates.invoiceDate;
  }
  if (updates.vendorName !== undefined) {
    data.vendorName = updates.vendorName;
  }

  await docRef.update(data);
}

/**
 * Store extraction data for duplicate detection
 * Called after successful LLM extraction
 */
export async function storeExtraction(
  chatId: number,
  messageId: number,
  extraction: InvoiceExtraction
): Promise<void> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  await docRef.update({
    vendorName: extraction.vendor_name,
    invoiceNumber: extraction.invoice_number,
    totalAmount: extraction.total_amount,
    invoiceDate: extraction.invoice_date,
    currency: extraction.currency,
    vatAmount: extraction.vat_amount,
    confidence: extraction.confidence,
    category: extraction.category,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

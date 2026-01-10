/**
 * Firestore store service for job state and idempotency
 */

import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import type { InvoiceJob, JobStatus, PipelineStep } from '../../../../shared/types';
import logger from '../logger';

const COLLECTION_NAME = 'invoice_jobs';
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
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
  const docRef = db.collection(COLLECTION_NAME).doc(docId);
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

      // Check if stale (processing for too long)
      if (existingJob.status === 'processing') {
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
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

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
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  await docRef.update({
    status: 'processed' as JobStatus,
    updatedAt: FieldValue.serverTimestamp(),
    driveFileId: data.driveFileId,
    driveLink: data.driveLink,
    sheetRowId: data.sheetRowId,
    lastError: FieldValue.delete(),
  });
}

/**
 * Mark job as failed
 */
export async function markJobFailed(
  chatId: number,
  messageId: number,
  step: PipelineStep,
  error: string
): Promise<void> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  await docRef.update({
    status: 'failed' as JobStatus,
    updatedAt: FieldValue.serverTimestamp(),
    lastStep: step,
    lastError: error,
  });
}

/**
 * Get job by chat and message IDs
 */
export async function getJob(
  chatId: number,
  messageId: number
): Promise<InvoiceJob | null> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  const doc = await docRef.get();
  return doc.exists ? (doc.data() as InvoiceJob) : null;
}

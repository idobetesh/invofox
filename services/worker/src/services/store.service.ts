/**
 * Firestore store service for job state and idempotency
 */

import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import type { InvoiceJob, JobStatus, PipelineStep, DuplicateMatch, InvoiceExtraction } from '../../../../shared/types';
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

// ============================================================================
// Duplicate Detection
// ============================================================================

interface StoredExtraction {
  vendorName?: string | null;
  totalAmount?: number | null;
  invoiceDate?: string | null;
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
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  await docRef.update({
    vendorName: extraction.vendor_name,
    totalAmount: extraction.total_amount,
    invoiceDate: extraction.invoice_date,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Mark job as pending user decision for duplicate handling
 * Stores all data needed to resume processing after user decides
 */
export async function markJobPendingDecision(
  chatId: number,
  messageId: number,
  data: {
    duplicateOfJobId: string;
    llmProvider: 'gemini' | 'openai';
    totalTokens: number;
    costUSD: number;
    currency: string | null;
  }
): Promise<void> {
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  await docRef.update({
    status: 'pending_decision' as JobStatus,
    duplicateOfJobId: data.duplicateOfJobId,
    llmProvider: data.llmProvider,
    totalTokens: data.totalTokens,
    costUSD: data.costUSD,
    currency: data.currency,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Get a pending decision job for resuming after user callback
 */
export async function getPendingDecisionJob(
  chatId: number,
  messageId: number
): Promise<InvoiceJob | null> {
  const job = await getJob(chatId, messageId);
  
  if (!job || job.status !== 'pending_decision') {
    return null;
  }
  
  return job;
}

/**
 * Find potential duplicate invoices by vendor + amount + date
 * Returns matches from the last 90 days
 */
export async function findDuplicateInvoice(
  extraction: InvoiceExtraction,
  currentJobId: string
): Promise<DuplicateMatch | null> {
  const db = getFirestore();
  const log = logger.child({ currentJobId });

  // Need at least vendor and amount to detect duplicates
  if (!extraction.vendor_name || extraction.total_amount === null) {
    log.debug('Insufficient data for duplicate detection');
    return null;
  }

  try {
    // Query for processed invoices with same vendor (case-insensitive via lowercase)
    const vendorLower = extraction.vendor_name.toLowerCase().trim();
    
    // Get all processed jobs from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('status', '==', 'processed')
      .where('createdAt', '>=', Timestamp.fromDate(ninetyDaysAgo))
      .get();

    for (const doc of snapshot.docs) {
      // Skip current job
      if (doc.id === currentJobId) {
        continue;
      }

      const job = doc.data() as InvoiceJob & StoredExtraction;
      
      // Skip if no extraction data
      if (!job.vendorName || job.totalAmount === null) {
        continue;
      }

      // Check vendor match (case-insensitive)
      const storedVendorLower = job.vendorName.toLowerCase().trim();
      if (storedVendorLower !== vendorLower) {
        continue;
      }

      // Check amount match (exact)
      if (job.totalAmount !== extraction.total_amount) {
        continue;
      }

      // Check date match (if both have dates)
      let matchType: 'exact' | 'similar' = 'similar';
      if (extraction.invoice_date && job.invoiceDate) {
        if (extraction.invoice_date === job.invoiceDate) {
          matchType = 'exact';
        } else {
          // Different dates with same vendor/amount - not a duplicate
          continue;
        }
      }

      log.info(
        { 
          duplicateJobId: doc.id, 
          vendor: job.vendorName, 
          amount: job.totalAmount,
          matchType 
        },
        'Potential duplicate found'
      );

      return {
        jobId: doc.id,
        vendorName: job.vendorName,
        totalAmount: job.totalAmount,
        invoiceDate: job.invoiceDate || null,
        driveLink: job.driveLink || '',
        receivedAt: job.receivedAt,
        matchType,
      };
    }

    return null;
  } catch (error) {
    log.error({ error }, 'Error checking for duplicates');
    // Don't block processing on duplicate check failure
    return null;
  }
}

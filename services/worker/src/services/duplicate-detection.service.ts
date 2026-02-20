/**
 * Duplicate Detection Service
 *
 * Centralizes all duplicate invoice detection logic including:
 * - Querying Firestore for potential duplicates
 * - Comparing invoice fields (vendor, amount, date, invoice number)
 * - Formatting duplicate warning messages
 * - Formatting duplicate resolution messages
 */

import { Timestamp, FieldValue } from '@google-cloud/firestore';
import type {
  InvoiceExtraction,
  DuplicateMatch,
  TelegramInlineKeyboardMarkup,
} from '../../../../shared/types';
import type { InvoiceJob } from '../models/invoice-job.model';
import { MESSAGES } from '../constants/messages';
import { formatDateForDisplay } from './telegram.service';
import { getFirestore } from './firestore.service';
import logger from '../logger';
import { INVOICE_JOBS_COLLECTION } from '../../../../shared/collections';

// Helper function to get job ID
function getJobId(chatId: number, messageId: number): string {
  return `${chatId}_${messageId}`;
}

// ============================================================================
// Types
// ============================================================================

interface StoredExtraction {
  vendorName?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  invoiceDate?: string | null;
  category?: string | null;
}

// ============================================================================
// Core Duplicate Detection Logic
// ============================================================================

/**
 * Find potential duplicate invoices by vendor + amount + date + invoice number
 *
 * Detection Logic:
 * 1. Must have same vendor (case-insensitive)
 * 2. Must have same amount (exact match)
 * 3. If both have invoice numbers AND they differ → NOT a duplicate
 * 4. If both have dates AND they differ → NOT a duplicate
 * 5. Otherwise → Potential duplicate
 *
 * Returns matches from current calendar year within the same customer (chatId)
 *
 * @param chatId - Telegram chat ID (customer identifier)
 * @param extraction - Extracted invoice data from LLM
 * @param currentJobId - Current job ID to exclude from results
 * @returns DuplicateMatch if found, null otherwise
 */
export async function findDuplicateInvoice(
  chatId: number,
  extraction: InvoiceExtraction,
  currentJobId: string
): Promise<DuplicateMatch | null> {
  const db = getFirestore();
  const log = logger.child({ currentJobId, chatId });

  // Need at least vendor and amount to detect duplicates
  if (!extraction.vendor_name || extraction.total_amount === null) {
    log.debug('Insufficient data for duplicate detection');
    return null;
  }

  try {
    // Query for processed invoices with same vendor (case-insensitive via lowercase)
    const vendorLower = extraction.vendor_name.toLowerCase().trim();

    // Get all processed jobs from start of current calendar year for this customer only
    const startOfYear = new Date();
    startOfYear.setMonth(0); // January
    startOfYear.setDate(1); // 1st
    startOfYear.setHours(0, 0, 0, 0); // Midnight

    log.info(
      { vendorLower, amount: extraction.total_amount, date: extraction.invoice_date },
      'Querying for duplicates'
    );

    const snapshot = await db
      .collection(INVOICE_JOBS_COLLECTION)
      .where('telegramChatId', '==', chatId)
      .where('status', 'in', ['processed', 'processing', 'pending_decision'])
      .where('createdAt', '>=', Timestamp.fromDate(startOfYear))
      .limit(200)
      .get();

    log.info({ jobsFound: snapshot.docs.length }, 'Query completed');

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

      // Check invoice number (if both have invoice numbers and they differ, NOT a duplicate)
      if (extraction.invoice_number && job.invoiceNumber) {
        if (extraction.invoice_number !== job.invoiceNumber) {
          // Different invoice numbers - definitely not a duplicate
          continue;
        }
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
          matchType,
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

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Format duplicate warning message with inline buttons
 *
 * Creates a Hebrew message warning about a potential duplicate with:
 * - Invoice details (date, amount, vendor)
 * - Link to existing invoice
 * - Inline buttons for user decision (keep both / delete new)
 *
 * @param duplicate - Duplicate match information
 * @param newDriveLink - Google Drive link to the new invoice
 * @param chatId - Telegram chat ID
 * @param messageId - Telegram message ID
 * @returns Formatted message text and inline keyboard
 */
export function formatDuplicateWarning(
  duplicate: DuplicateMatch,
  newDriveLink: string,
  chatId: number,
  messageId: number
): { text: string; keyboard: TelegramInlineKeyboardMarkup } {
  const date = formatDateForDisplay(duplicate.invoiceDate);
  const amount = duplicate.totalAmount !== null ? duplicate.totalAmount.toString() : '?';
  const vendor = duplicate.vendorName || MESSAGES.VENDOR_UNKNOWN;

  const text = `⚠️ ${MESSAGES.DUPLICATE_DETECTED}
📅 ${date} | 💰 ${amount} | 🏢 ${vendor}
📎 [${MESSAGES.LINK_EXISTING_LABEL}](${duplicate.driveLink})

${MESSAGES.DUPLICATE_PENDING_ACTION}`;

  // Encode callback data as compact JSON to stay within Telegram's 64-byte limit.
  // { a: action, c: chatId, m: messageId } — process.controller decodes with fallbacks.
  const keyboard: TelegramInlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: MESSAGES.BUTTON_KEEP_BOTH,
          callback_data: JSON.stringify({ a: 'keep_both', c: chatId, m: messageId }),
        },
        {
          text: MESSAGES.BUTTON_DELETE_NEW,
          callback_data: JSON.stringify({ a: 'delete_new', c: chatId, m: messageId }),
        },
      ],
    ],
  };

  return { text, keyboard };
}

/**
 * Format message after user decides on duplicate
 *
 * Creates a Hebrew message confirming the user's decision:
 * - "keep_both": Shows links to both invoices
 * - "delete_new": Shows link to kept invoice
 *
 * @param action - User's decision (keep_both or delete_new)
 * @param driveLink - Google Drive link to the new invoice
 * @param existingLink - Google Drive link to the existing invoice
 * @returns Formatted resolution message
 */
export function formatDuplicateResolved(
  action: 'keep_both' | 'delete_new',
  driveLink: string,
  existingLink: string
): string {
  if (action === 'keep_both') {
    return `✅ ${MESSAGES.RESOLUTION_BOTH_KEPT}
📎 [${MESSAGES.LINK_NEW}](${driveLink}) | [${MESSAGES.LINK_EXISTING}](${existingLink})`;
  } else {
    return `🗑️ ${MESSAGES.RESOLUTION_DUPLICATE_DELETED}
📎 [${MESSAGES.LINK_EXISTING}](${existingLink}) ${MESSAGES.RESOLUTION_KEPT}`;
  }
}

// ============================================================================
// Job Management (Duplicate-Related)
// ============================================================================

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
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  await docRef.update({
    status: 'pending_decision',
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
  const db = getFirestore();
  const docId = getJobId(chatId, messageId);
  const docRef = db.collection(INVOICE_JOBS_COLLECTION).doc(docId);

  const doc = await docRef.get();
  if (!doc.exists) {
    return null;
  }

  const job = doc.data() as InvoiceJob;
  if (job.status !== 'pending_decision') {
    return null;
  }

  return job;
}

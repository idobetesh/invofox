/**
 * Invoice processing service - main pipeline orchestrator
 *
 * Pipeline: Telegram → Cloud Storage → LLM Vision → Sheets → ACK
 */

import type {
  TaskPayload,
  PipelineStep,
  DuplicateAction,
  InvoiceJob,
} from '../../../../shared/types';
import * as storeService from './store.service';
import * as telegramService from './telegram.service';
import * as storageService from './storage.service';
import * as llmService from './llm.service';
import * as sheetsService from './sheets.service';
import * as pdfService from './pdf.service';
import * as heicService from './heic.service';
import logger from '../logger';

/**
 * Escape Markdown special characters to prevent injection in Telegram messages
 */
function escapeMarkdown(text: string | null): string {
  if (!text) {
    return '';
  }
  // Escape Markdown special characters: * _ [ ] ( ) ` ~
  return text
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/`/g, '\\`')
    .replace(/~/g, '\\~');
}

export interface ProcessingResult {
  success: boolean;
  alreadyProcessed: boolean;
  step?: PipelineStep;
  error?: string;
  driveLink?: string;
  isDuplicate?: boolean;
}

/**
 * Process an invoice image through the full pipeline
 * Uses atomic transactions - if Sheets fails, Drive upload is rolled back
 */
export async function processInvoice(payload: TaskPayload): Promise<ProcessingResult> {
  const { chatId, messageId, fileId, uploaderUsername, chatTitle, receivedAt } = payload;
  let currentStep: PipelineStep = 'download';
  const driveFileIds: string[] = []; // Track files for rollback
  let driveLink: string | undefined;

  const log = logger.child({ chatId, messageId });
  log.info('Starting invoice processing');

  try {
    // Step 0: Claim job (idempotency check)
    const { claimed, job } = await storeService.claimJob(chatId, messageId, {
      telegramFileId: fileId,
      uploaderUsername,
      uploaderFirstName: payload.uploaderFirstName,
      chatTitle,
      receivedAt,
    });

    if (!claimed) {
      log.info('Job already processed or in progress');
      return {
        success: true,
        alreadyProcessed: true,
      };
    }

    log.info({ attempt: job?.attempts || 1 }, 'Job claimed');

    // Step 1: Download file from Telegram
    currentStep = 'download';
    log.info('Step 1: Downloading from Telegram');
    await storeService.updateJobStep(chatId, messageId, currentStep);

    const { buffer, filePath } = await telegramService.downloadFileById(fileId);
    const fileExtension = telegramService.getFileExtension(filePath);
    log.info({ bytes: buffer.length, extension: fileExtension }, 'File downloaded');

    // Check file size (re-validate)
    const MAX_SIZE_MB = 5;
    const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
    if (buffer.length > MAX_SIZE_BYTES) {
      throw new Error(
        `File size ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_SIZE_MB}MB limit`
      );
    }

    // Detect file type and process accordingly
    const isPDF = fileExtension.toLowerCase() === 'pdf';
    const isHEIC = ['heic', 'heif'].includes(fileExtension.toLowerCase());
    let imageBuffers: Buffer[];
    let imageExtension: string;
    const originalFileExtension = fileExtension; // Store original extension for upload

    if (isPDF) {
      // PDF Processing Path
      log.info('Processing as PDF document');

      // Check if encrypted
      const pdfInfo = await pdfService.getPDFInfo(buffer);

      if (pdfInfo.isEncrypted) {
        log.warn('PDF is password-protected');
        await telegramService.sendMessage(
          chatId,
          '🔒 PDF is password-protected. Please unlock the PDF and resend it.',
          { replyToMessageId: messageId }
        );
        await storeService.markJobFailed(chatId, messageId, currentStep, 'PDF is encrypted');
        return { success: false, alreadyProcessed: false };
      }

      if (pdfInfo.pageCount === 0) {
        throw new Error('PDF has no pages');
      }

      if (pdfInfo.pageCount > 5) {
        log.warn({ pageCount: pdfInfo.pageCount }, 'PDF exceeds page limit');
        await telegramService.sendMessage(
          chatId,
          `📄 PDF has ${pdfInfo.pageCount} pages. Maximum is 5 pages. Please split the document.`,
          { replyToMessageId: messageId }
        );
        await storeService.markJobFailed(
          chatId,
          messageId,
          currentStep,
          'PDF exceeds 5 page limit'
        );
        return { success: false, alreadyProcessed: false };
      }

      log.info({ pageCount: pdfInfo.pageCount }, 'Converting PDF pages to images');

      // Convert all pages to images
      const convertedPages = await pdfService.convertPDFToImages(buffer, pdfInfo.pageCount);
      imageBuffers = convertedPages.map((p) => p.buffer);
      imageExtension = 'png';

      log.info({ pagesConverted: imageBuffers.length }, 'PDF converted to images');
    } else if (isHEIC) {
      // HEIC/HEIF Processing Path
      log.info('Processing as HEIC/HEIF image');

      // Convert HEIC to JPEG for LLM compatibility
      const converted = await heicService.convertHEICToJPEG(buffer);
      imageBuffers = [converted.buffer];
      imageExtension = converted.extension;

      log.info('HEIC image converted to JPEG for processing');
    } else {
      // Image Processing Path (JPEG, PNG, WebP, etc.)
      log.info('Processing as image');
      imageBuffers = [buffer];
      imageExtension = fileExtension;
    }

    // Step 2: Upload to Cloud Storage
    currentStep = 'drive'; // Keep as 'drive' for compatibility with existing jobs
    log.info('Step 2: Uploading to Cloud Storage');
    await storeService.updateJobStep(chatId, messageId, currentStep);

    if (isPDF) {
      // For PDFs: upload only the original PDF (images are just for LLM extraction)
      const pdfUpload = await storageService.uploadInvoiceImage(
        buffer, // Use raw PDF buffer (not converted images)
        'pdf',
        chatId,
        messageId,
        receivedAt
      );
      driveFileIds.push(pdfUpload.fileId);
      driveLink = pdfUpload.webViewLink;
      log.info({ driveLink }, 'Original PDF uploaded');
    } else if (isHEIC) {
      // For HEIC: upload original HEIC file (converted JPEG is just for LLM extraction)
      const heicUpload = await storageService.uploadInvoiceImage(
        buffer, // Use raw HEIC buffer (not converted JPEG)
        originalFileExtension,
        chatId,
        messageId,
        receivedAt
      );
      driveFileIds.push(heicUpload.fileId);
      driveLink = heicUpload.webViewLink;
      log.info({ driveLink }, 'Original HEIC image uploaded');
    } else {
      // For images: upload directly since no conversion is needed
      const imageUpload = await storageService.uploadInvoiceImage(
        imageBuffers[0],
        imageExtension,
        chatId,
        messageId,
        receivedAt
      );
      driveFileIds.push(imageUpload.fileId);
      driveLink = imageUpload.webViewLink;
      log.info({ driveLink }, 'Image uploaded');
    }

    // Step 3: Extract data with LLM Vision (multi-image for PDFs)
    currentStep = 'llm';
    log.info('Step 3: Extracting with LLM Vision');
    await storeService.updateJobStep(chatId, messageId, currentStep, {
      driveFileId: driveFileIds[0],
      driveLink,
    });

    // Use multi-image extraction if PDF, single-image for photos
    const { extraction, usage } = isPDF
      ? await llmService.extractInvoiceDataMulti(imageBuffers, imageExtension)
      : await llmService.extractInvoiceData(imageBuffers[0], imageExtension);
    const status = llmService.needsReview(extraction) ? 'needs_review' : 'processed';

    log.info(
      {
        isInvoice: extraction.is_invoice,
        vendor: extraction.vendor_name,
        total: extraction.total_amount,
        date: extraction.invoice_date,
        confidence: extraction.confidence,
        status,
        tokens: usage.totalTokens,
        cost: usage.costUSD.toFixed(6),
      },
      'LLM Vision extraction completed'
    );

    // Check if document was rejected (not a valid invoice)
    if (!extraction.is_invoice) {
      log.info(
        { rejectionReason: extraction.rejection_reason },
        'Document rejected - not an invoice'
      );

      // Delete uploaded file since it's not an invoice
      if (driveFileIds.length > 0) {
        try {
          await Promise.all(driveFileIds.map((id) => storageService.deleteFile(id)));
          log.info({ fileCount: driveFileIds.length }, 'Deleted non-invoice files from storage');
        } catch (deleteError) {
          log.warn({ error: deleteError }, 'Failed to delete non-invoice files');
        }
      }

      // Send rejection message to user
      // Sanitize rejection_reason to prevent Markdown injection
      const sanitizedReason = escapeMarkdown(
        extraction.rejection_reason || 'The document does not contain invoice information'
      );
      const rejectionMessage = `❌ *Not an invoice*\n\n${sanitizedReason}\n\nPlease upload a valid invoice, receipt, or bill.`;
      await telegramService.sendMessage(chatId, rejectionMessage, {
        parseMode: 'Markdown',
        replyToMessageId: messageId,
      });

      // Mark job as processed (not an error, just not an invoice)
      await storeService.updateJobStep(chatId, messageId, 'rejected', {
        rejectionReason: extraction.rejection_reason,
      });

      return { success: true, alreadyProcessed: false };
    }

    // Check for duplicate invoices
    const jobId = storeService.getJobId(chatId, messageId);
    log.info(
      { jobId, vendor: extraction.vendor_name, amount: extraction.total_amount },
      'Checking for duplicate invoices'
    );

    const [, duplicate] = await Promise.all([
      storeService.storeExtraction(chatId, messageId, extraction),
      storeService.findDuplicateInvoice(chatId, extraction, jobId),
    ]);

    log.info({ isDuplicate: !!duplicate }, 'Duplicate check completed');

    // If duplicate found, pause for user decision
    if (duplicate) {
      log.info(
        { duplicateJobId: duplicate.jobId },
        'Duplicate detected, waiting for user decision'
      );

      // Store pending decision state with all data needed to resume
      await storeService.markJobPendingDecision(chatId, messageId, {
        duplicateOfJobId: duplicate.jobId,
        llmProvider: usage.provider,
        totalTokens: usage.totalTokens,
        costUSD: usage.costUSD,
        currency: extraction.currency,
      });

      // Send message with inline buttons
      const { text, keyboard } = telegramService.formatDuplicateWarning(
        duplicate,
        driveLink,
        chatId,
        messageId
      );

      await telegramService.sendMessage(chatId, text, {
        parseMode: 'Markdown',
        replyToMessageId: messageId,
        disableWebPagePreview: true,
        replyMarkup: keyboard,
      });

      log.info('Duplicate warning sent with buttons, awaiting user decision');

      return {
        success: true,
        alreadyProcessed: false,
        driveLink,
        isDuplicate: true,
      };
    }

    // Step 4: Append to Google Sheets (ATOMIC - rollback Drive on failure)
    currentStep = 'sheets';
    log.info('Step 4: Appending to Google Sheets');
    await storeService.updateJobStep(chatId, messageId, currentStep);

    let sheetRowId: number | undefined;
    try {
      const sheetRow = sheetsService.buildSheetRow({
        receivedAt,
        uploaderUsername,
        chatTitle,
        driveLink,
        extraction,
        status,
        llmProvider: usage.provider,
        totalTokens: usage.totalTokens,
        costUSD: usage.costUSD,
      });

      sheetRowId = await sheetsService.appendRow(chatId, sheetRow);
      log.info({ sheetRowId }, 'Appended to customer Google Sheet');
    } catch (sheetsError) {
      // Sheets failed - ROLLBACK: delete all uploaded files
      log.error({ error: sheetsError }, 'Sheets append failed, rolling back uploads');

      if (driveFileIds.length > 0) {
        await Promise.all(driveFileIds.map((id) => storageService.deleteFile(id)));
      }

      // Re-throw to trigger retry
      throw sheetsError;
    }

    // Step 5: Send ACK message to Telegram
    currentStep = 'ack';
    log.info('Step 5: Sending ACK message');

    const ackMessage = telegramService.formatSuccessMessage(
      extraction.invoice_date,
      extraction.total_amount,
      extraction.currency,
      driveLink
    );

    // CRITICAL: Mark job as completed BEFORE sending message
    // This prevents duplicate messages if message send fails or takes long
    await Promise.all([
      storeService.markJobCompleted(chatId, messageId, {
        driveFileId: driveFileIds[0],
        driveLink,
        sheetRowId,
      }),
      storeService.updateJobStep(chatId, messageId, currentStep, { sheetRowId }),
    ]);
    log.info('Job marked as completed');

    // NOW send the success message (after job is marked complete)
    // If this fails, job won't retry because it's already marked complete
    await telegramService.sendMessage(chatId, ackMessage, {
      parseMode: 'Markdown',
      replyToMessageId: messageId,
      disableWebPagePreview: true,
    });
    log.info('ACK message sent');

    log.info({ isDuplicate: !!duplicate }, 'Invoice processing completed successfully');

    return {
      success: true,
      alreadyProcessed: false,
      driveLink,
      isDuplicate: !!duplicate,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ step: currentStep, error: errorMessage }, 'Processing failed');

    // Mark job as pending retry (NOT failed - that's only after max retries)
    // This allows Cloud Tasks retries to reclaim the job
    await storeService.markJobPendingRetry(chatId, messageId, currentStep, errorMessage);

    // Throw to trigger Cloud Tasks retry
    throw error;
  }
}

/**
 * Send failure notification after max retries exhausted
 */
export async function sendFailureNotification(
  chatId: number,
  messageId: number,
  lastStep: PipelineStep,
  error: string
): Promise<void> {
  const log = logger.child({ chatId, messageId });

  try {
    const failureMessage = telegramService.formatFailureMessage(messageId, lastStep, error);
    await telegramService.sendMessage(chatId, failureMessage, { replyToMessageId: messageId });
    log.info({ lastStep }, 'Failure notification sent');
  } catch (notifyError) {
    log.error({ notifyError }, 'Failed to send failure notification');
  }
}

/**
 * Handle user decision on duplicate invoice
 * Called when user clicks "Keep Both" or "Delete New" button
 */
export async function handleDuplicateDecision(
  chatId: number,
  messageId: number,
  action: DuplicateAction,
  botMessageId: number // The message with buttons, to edit it
): Promise<{ success: boolean; error?: string }> {
  const log = logger.child({ chatId, messageId, action });
  log.info('Processing duplicate decision');

  try {
    // Get the pending decision job
    const job = await storeService.getPendingDecisionJob(chatId, messageId);

    if (!job) {
      log.warn('No pending decision job found');
      return { success: false, error: 'Decision already processed or expired' };
    }

    // Get the duplicate job for its drive link
    const duplicateJob = job.duplicateOfJobId
      ? await storeService.getJob(
          parseInt(job.duplicateOfJobId.split('_')[0]),
          parseInt(job.duplicateOfJobId.split('_')[1])
        )
      : null;

    const existingLink = duplicateJob?.driveLink || '';

    if (action === 'delete_new') {
      // User chose to delete the new upload
      log.info('User chose to delete new upload');

      // Delete from Cloud Storage
      if (job.driveFileId) {
        await storageService.deleteFile(job.driveFileId);
        log.info({ fileId: job.driveFileId }, 'Deleted from Cloud Storage');
      }

      // Mark job as processed (duplicate deleted)
      await storeService.markJobCompleted(chatId, messageId, {
        driveFileId: job.driveFileId || '',
        driveLink: job.driveLink || '',
      });

      // Edit the button message to show result
      const resultMessage = telegramService.formatDuplicateResolved(
        action,
        job.driveLink || '',
        existingLink
      );

      await telegramService.editMessageText(chatId, botMessageId, resultMessage, {
        parseMode: 'Markdown',
        disableWebPagePreview: true,
      });

      return { success: true };
    }

    // User chose to keep both - continue with sheets append
    log.info('User chose to keep both, appending to sheets');

    const status = 'processed'; // Already checked confidence earlier
    // Cast job to include all stored extraction fields
    const jobWithExtraction = job as InvoiceJob & {
      invoiceNumber?: string;
      currency?: string;
      vatAmount?: number;
      confidence?: number;
      category?: string;
      llmProvider?: 'gemini' | 'openai';
      totalTokens?: number;
      costUSD?: number;
    };

    const sheetRow = sheetsService.buildSheetRow({
      receivedAt: job.receivedAt,
      uploaderUsername: job.uploaderUsername,
      chatTitle: job.chatTitle,
      driveLink: job.driveLink || '',
      extraction: {
        is_invoice: true,
        rejection_reason: null,
        vendor_name: job.vendorName || null,
        invoice_number: jobWithExtraction.invoiceNumber || null,
        invoice_date: job.invoiceDate || null,
        total_amount: job.totalAmount || null,
        currency: jobWithExtraction.currency || null,
        vat_amount: jobWithExtraction.vatAmount || null,
        confidence: jobWithExtraction.confidence || 0.8,
        category: jobWithExtraction.category || null,
      },
      status,
      llmProvider: jobWithExtraction.llmProvider || 'openai',
      totalTokens: jobWithExtraction.totalTokens || 0,
      costUSD: jobWithExtraction.costUSD || 0,
    });

    const sheetRowId = await sheetsService.appendRow(chatId, sheetRow);
    log.info({ sheetRowId }, 'Appended to customer Google Sheet after user decision');

    // Mark job as completed
    await storeService.markJobCompleted(chatId, messageId, {
      driveFileId: job.driveFileId || '',
      driveLink: job.driveLink || '',
      sheetRowId,
    });

    // Edit the button message to show result
    const resultMessage = telegramService.formatDuplicateResolved(
      action,
      job.driveLink || '',
      existingLink
    );

    await telegramService.editMessageText(chatId, botMessageId, resultMessage, {
      parseMode: 'Markdown',
      disableWebPagePreview: true,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Failed to process duplicate decision');
    return { success: false, error: errorMessage };
  }
}

/**
 * Invoice processing service - main pipeline orchestrator
 * 
 * Pipeline: Telegram → Cloud Storage → LLM Vision → Sheets → ACK
 */

import type { TaskPayload, PipelineStep, DuplicateAction, InvoiceJob } from '../../../../shared/types';
import * as storeService from './store.service';
import * as telegramService from './telegram.service';
import * as storageService from './storage.service';
import * as llmService from './llm.service';
import * as sheetsService from './sheets.service';
import logger from '../logger';

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
  let driveFileId: string | undefined;
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

    // Step 1: Download image from Telegram
    currentStep = 'download';
    log.info('Step 1: Downloading from Telegram');
    await storeService.updateJobStep(chatId, messageId, currentStep);

    const { buffer: imageBuffer, filePath } = await telegramService.downloadFileById(fileId);
    const fileExtension = telegramService.getFileExtension(filePath);
    log.info({ bytes: imageBuffer.length, extension: fileExtension }, 'Image downloaded');

    // Step 2: Upload to Cloud Storage
    currentStep = 'drive'; // Keep as 'drive' for compatibility with existing jobs
    log.info('Step 2: Uploading to Cloud Storage');
    await storeService.updateJobStep(chatId, messageId, currentStep);

    const storageResult = await storageService.uploadInvoiceImage(
      imageBuffer,
      fileExtension,
      chatId,
      messageId,
      receivedAt
    );
    driveFileId = storageResult.fileId;
    driveLink = storageResult.webViewLink;
    log.info({ fileId: driveFileId, url: driveLink }, 'Uploaded to Cloud Storage');

    // Step 3: Extract data with LLM Vision
    currentStep = 'llm';
    log.info('Step 3: Extracting with LLM Vision');
    await storeService.updateJobStep(chatId, messageId, currentStep, { driveFileId, driveLink });

    const { extraction, usage } = await llmService.extractInvoiceData(imageBuffer, fileExtension);
    const status = llmService.needsReview(extraction) ? 'needs_review' : 'processed';
    
    log.info(
      { 
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

    // Store extraction data for future duplicate checks
    await storeService.storeExtraction(chatId, messageId, extraction);

    // Check for duplicate invoices
    const jobId = storeService.getJobId(chatId, messageId);
    const duplicate = await storeService.findDuplicateInvoice(extraction, jobId);

    // If duplicate found, pause for user decision
    if (duplicate) {
      log.info({ duplicateJobId: duplicate.jobId }, 'Duplicate detected, waiting for user decision');
      
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

      sheetRowId = await sheetsService.appendRow(sheetRow);
      log.info({ sheetRowId }, 'Appended to sheet');
    } catch (sheetsError) {
      // Sheets failed - ROLLBACK: delete uploaded file
      log.error({ error: sheetsError }, 'Sheets append failed, rolling back upload');
      
      if (driveFileId) {
        await storageService.deleteFile(driveFileId);
      }
      
      // Re-throw to trigger retry
      throw sheetsError;
    }

    // Step 5: Send ACK message to Telegram
    currentStep = 'ack';
    log.info('Step 5: Sending ACK message');
    await storeService.updateJobStep(chatId, messageId, currentStep, { sheetRowId });

    const ackMessage = telegramService.formatSuccessMessage(
      extraction.invoice_date,
      extraction.total_amount,
      extraction.currency,
      driveLink
    );

    await telegramService.sendMessage(chatId, ackMessage, { 
      parseMode: 'Markdown',
      replyToMessageId: messageId,
      disableWebPagePreview: true,
    });
    log.info('ACK message sent');

    // Mark job as completed
    await storeService.markJobCompleted(chatId, messageId, {
      driveFileId,
      driveLink,
      sheetRowId,
    });

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

    // Mark job as failed
    await storeService.markJobFailed(chatId, messageId, currentStep, errorMessage);

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

    const sheetRowId = await sheetsService.appendRow(sheetRow);
    log.info({ sheetRowId }, 'Appended to sheet after user decision');

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

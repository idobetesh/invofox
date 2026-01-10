/**
 * Invoice processing service - main pipeline orchestrator
 * 
 * Pipeline: Telegram → Cloud Storage → LLM Vision → Sheets → ACK
 */

import type { TaskPayload, PipelineStep } from '../../../../shared/types';
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

    log.info('Invoice processing completed successfully');

    return {
      success: true,
      alreadyProcessed: false,
      driveLink,
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

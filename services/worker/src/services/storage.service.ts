/**
 * Google Cloud Storage service for uploading invoice images
 * Uses Google Cloud Storage for invoice image storage
 */

import { Storage } from '@google-cloud/storage';
import { getConfig } from '../config';
import logger from '../logger';

let storageClient: Storage | null = null;

function getStorage(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

/**
 * Get MIME type from file extension
 * HEIC files are stored as-is but converted to JPEG for LLM processing
 */
export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
  };

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * Upload invoice image to Cloud Storage
 * Returns public URL for viewing
 */
export async function uploadInvoiceImage(
  buffer: Buffer,
  fileExtension: string,
  chatId: number,
  messageId: number,
  receivedAt: string,
  filenameSuffix?: string
): Promise<{ fileId: string; webViewLink: string }> {
  const config = getConfig();
  const storage = getStorage();
  const bucket = storage.bucket(config.storageBucket);

  const date = new Date(receivedAt);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  // Create path with per-customer isolation: invoices/{chatId}/2026/01/invoice_chatId_msgId_timestamp_page_1_of_3.jpg
  const baseName = `invoice_${chatId}_${messageId}_${date.getTime()}`;
  const fullName = filenameSuffix ? `${baseName}_${filenameSuffix}` : baseName;
  const fileName = `invoices/${chatId}/${year}/${month}/${fullName}.${fileExtension}`;
  const mimeType = getMimeType(fileExtension);

  const file = bucket.file(fileName);

  // Upload the file
  await file.save(buffer, {
    metadata: {
      contentType: mimeType,
      metadata: {
        telegram_chat_id: chatId.toString(),
        telegram_message_id: messageId.toString(),
        received_at: receivedAt,
      },
    },
  });

  logger.info({ fileName, bucket: config.storageBucket }, 'File uploaded to Cloud Storage');

  // Generate public URL (bucket is configured for public read)
  const publicUrl = `https://storage.googleapis.com/${config.storageBucket}/${fileName}`;

  return {
    fileId: fileName, // Use path as fileId for Cloud Storage
    webViewLink: publicUrl,
  };
}

/**
 * Delete a file from Cloud Storage (for rollback on failure)
 */
export async function deleteFile(fileId: string): Promise<void> {
  const config = getConfig();
  const storage = getStorage();
  const bucket = storage.bucket(config.storageBucket);

  try {
    await bucket.file(fileId).delete();
    logger.info({ fileId }, 'Deleted file from Cloud Storage (rollback)');
  } catch (error) {
    // Log but don't throw - best effort cleanup
    logger.warn({ fileId, error }, 'Failed to delete file from Cloud Storage during rollback');
  }
}

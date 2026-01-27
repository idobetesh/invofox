/**
 * Telegram Processing Extractors
 * Extract payloads for photo/document processing and callback queries
 */

import type { TaskPayload } from '../../../../../shared/types';
import type { TelegramUpdate, TelegramMessage } from './telegram-types';
import { getBestPhoto } from './telegram-file-utils';

/**
 * Extract task payload from a photo message update
 *
 * Note: Telegram sends multiple resolutions of the same photo in message.photo array.
 * This function selects the best quality version.
 *
 * Batch processing: When users send multiple photos as an album, each photo arrives
 * as a separate webhook call with unique message_id. Each creates its own Cloud Task
 * and is processed in parallel by workers. No special handling needed.
 */
export function extractTaskPayload(update: TelegramUpdate): TaskPayload | null {
  const message: TelegramMessage | undefined = update.message || update.channel_post;

  if (!message || !message.photo || message.photo.length === 0) {
    return null;
  }

  // Select the best quality photo from available resolutions
  const bestPhoto = getBestPhoto(message.photo);

  // Build uploader display name: prefer username, fallback to full name
  const uploaderName =
    message.from?.username ||
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') ||
    'unknown';

  return {
    chatId: message.chat.id,
    messageId: message.message_id,
    fileId: bestPhoto.file_id,
    uploaderUsername: uploaderName,
    uploaderFirstName: message.from?.first_name || 'Unknown',
    chatTitle: message.chat.title || message.chat.first_name || 'Private Chat',
    receivedAt: new Date(message.date * 1000).toISOString(),
  };
}

/**
 * Extract task payload from a document message update (PDF files)
 *
 * Note: PDF documents arrive as a single file object with metadata.
 * Batch processing: When users send multiple PDFs as an album, each PDF arrives
 * as a separate webhook call with unique message_id. Each creates its own Cloud Task
 * and is processed in parallel by workers. No special handling needed.
 */
export function extractDocumentTaskPayload(update: TelegramUpdate): TaskPayload | null {
  const message: TelegramMessage | undefined = update.message || update.channel_post;

  if (!message || !message.document) {
    return null;
  }

  const document = message.document;

  // Build uploader display name: prefer username, fallback to full name
  const uploaderName =
    message.from?.username ||
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') ||
    'unknown';

  return {
    chatId: message.chat.id,
    messageId: message.message_id,
    fileId: document.file_id,
    uploaderUsername: uploaderName,
    uploaderFirstName: message.from?.first_name || 'Unknown',
    chatTitle: message.chat.title || message.chat.first_name || 'Private Chat',
    receivedAt: new Date(message.date * 1000).toISOString(),
  };
}

/**
 * Extract callback query payload for forwarding to worker
 */
export function extractCallbackPayload(update: TelegramUpdate): {
  callbackQueryId: string;
  data: string;
  botMessageChatId: number;
  botMessageId: number;
} | null {
  const callback = update.callback_query;
  if (!callback || !callback.data || !callback.message) {
    return null;
  }

  return {
    callbackQueryId: callback.id,
    data: callback.data,
    botMessageChatId: callback.message.chat.id,
    botMessageId: callback.message.message_id,
  };
}

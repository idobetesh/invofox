/**
 * Telegram update parsing service
 * Uses Zod for runtime validation of incoming webhook payloads
 */

import { z } from 'zod';
import type {
  TaskPayload,
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
} from '../../../../shared/types';

/**
 * Zod schemas for Telegram types
 */
const TelegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

const TelegramChatSchema = z.object({
  id: z.number(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

const TelegramPhotoSizeSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  width: z.number(),
  height: z.number(),
  file_size: z.number().optional(),
});

const TelegramDocumentSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  file_name: z.string(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

const TelegramMessageSchema = z.object({
  message_id: z.number(),
  from: TelegramUserSchema.optional(),
  chat: TelegramChatSchema,
  date: z.number(),
  text: z.string().optional(),
  photo: z.array(TelegramPhotoSizeSchema).optional(),
  document: TelegramDocumentSchema.optional(),
  caption: z.string().optional(),
});

const TelegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: TelegramUserSchema,
  message: TelegramMessageSchema.optional(),
  chat_instance: z.string(),
  data: z.string().optional(),
});

const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: TelegramMessageSchema.optional(),
  edited_message: TelegramMessageSchema.optional(),
  channel_post: TelegramMessageSchema.optional(),
  edited_channel_post: TelegramMessageSchema.optional(),
  callback_query: TelegramCallbackQuerySchema.optional(),
});

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof TelegramMessageSchema>;
export type TelegramPhotoSize = z.infer<typeof TelegramPhotoSizeSchema>;
export type TelegramDocument = z.infer<typeof TelegramDocumentSchema>;
export type TelegramCallbackQuery = z.infer<typeof TelegramCallbackQuerySchema>;

/**
 * Validate and parse a Telegram update
 * Returns the validated update or null if invalid
 */
export function parseUpdate(data: unknown): TelegramUpdate | null {
  const result = TelegramUpdateSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Check if the update contains a photo message
 */
export function isPhotoMessage(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post;
  return Boolean(message?.photo && message.photo.length > 0);
}

/**
 * Check if the update is a command (starts with /)
 */
export function isCommand(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post;
  return Boolean(message?.text?.startsWith('/'));
}

/**
 * Check if the update is an /invoice command
 */
export function isInvoiceCommand(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post;
  return Boolean(message?.text?.toLowerCase().startsWith('/invoice'));
}

/**
 * Check if the update is a text message (not a command)
 */
export function isTextMessage(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post;
  return Boolean(message?.text && !message.text.startsWith('/'));
}

/**
 * Check if the update contains a document message
 */
export function isDocumentMessage(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post;
  return Boolean(message?.document);
}

/**
 * Check if the document is a PDF file
 */
export function isPdfDocument(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post;
  const document = message?.document;
  if (!document) {
    return false;
  }

  // Check MIME type
  if (document.mime_type === 'application/pdf') {
    return true;
  }

  // Fallback: check file extension
  if (document.file_name) {
    const lowerName = document.file_name.toLowerCase();
    return lowerName.endsWith('.pdf');
  }

  return false;
}

/**
 * Check if the document is a supported image format
 * Supports: JPEG, PNG, WebP (natively supported), HEIC/HEIF (converted to JPEG)
 * Excludes: GIF (should be sent as photo)
 */
export function isSupportedImageDocument(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post;
  const document = message?.document;
  if (!document) {
    return false;
  }

  // Supported image MIME types (HEIC will be converted to JPEG before LLM processing)
  const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

  // Check MIME type
  if (document.mime_type && supportedMimeTypes.includes(document.mime_type)) {
    return true;
  }

  // Fallback: check file extension
  if (document.file_name) {
    const lowerName = document.file_name.toLowerCase();
    const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
    return supportedExtensions.some((ext) => lowerName.endsWith(ext));
  }

  return false;
}

/**
 * Check if the document is either PDF or a supported image format
 */
export function isSupportedDocument(update: TelegramUpdate): boolean {
  return isPdfDocument(update) || isSupportedImageDocument(update);
}

/**
 * Validate if document file size is within limits
 * Maximum: 5 MB
 */
export function isFileSizeValid(document: TelegramDocument): boolean {
  const MAX_FILE_SIZE_MB = 5;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  if (!document.file_size) {
    // If size not available, allow (will be checked after download)
    return true;
  }
  return document.file_size <= MAX_FILE_SIZE_BYTES;
}

/**
 * Get the best quality photo from the array
 * Telegram sends multiple sizes, we want the largest one
 */
export function getBestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  if (photos.length === 0) {
    throw new Error('No photos provided');
  }

  // Sort by file_size descending (largest first), fallback to dimensions
  return photos.reduce((best, current) => {
    const bestSize = best.file_size || best.width * best.height;
    const currentSize = current.file_size || current.width * current.height;
    return currentSize > bestSize ? current : best;
  });
}

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
 * Validate that the update is a valid Telegram update object
 * @deprecated Use parseUpdate() for proper Zod validation
 */
export function isValidUpdate(update: unknown): update is TelegramUpdate {
  return parseUpdate(update) !== null;
}

/**
 * Check if the update is a callback query (button press)
 */
export function isCallbackQuery(update: TelegramUpdate): boolean {
  return Boolean(update.callback_query);
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

// ============================================================================
// Invoice Generation Payloads
// ============================================================================

/**
 * Extract invoice command payload for /invoice command
 */
export function extractInvoiceCommandPayload(update: TelegramUpdate): InvoiceCommandPayload | null {
  const message = update.message || update.channel_post;

  if (!message || !message.text || !message.from) {
    return null;
  }

  // Build username: prefer username, fallback to full name
  const username =
    message.from.username ||
    [message.from.first_name, message.from.last_name].filter(Boolean).join(' ') ||
    'unknown';

  return {
    type: 'command',
    chatId: message.chat.id,
    messageId: message.message_id,
    userId: message.from.id,
    username,
    firstName: message.from.first_name || 'Unknown',
    text: message.text,
    receivedAt: new Date(message.date * 1000).toISOString(),
  };
}

/**
 * Extract invoice message payload for conversation messages
 */
export function extractInvoiceMessagePayload(update: TelegramUpdate): InvoiceMessagePayload | null {
  const message = update.message || update.channel_post;

  if (!message || !message.text || !message.from) {
    return null;
  }

  // Build username: prefer username, fallback to full name
  const username =
    message.from.username ||
    [message.from.first_name, message.from.last_name].filter(Boolean).join(' ') ||
    'unknown';

  return {
    type: 'message',
    chatId: message.chat.id,
    messageId: message.message_id,
    userId: message.from.id,
    username,
    firstName: message.from.first_name || 'Unknown',
    text: message.text,
    receivedAt: new Date(message.date * 1000).toISOString(),
  };
}

/**
 * Extract invoice callback payload for button presses during invoice flow
 */
export function extractInvoiceCallbackPayload(
  update: TelegramUpdate
): InvoiceCallbackPayload | null {
  const callback = update.callback_query;
  if (!callback || !callback.data || !callback.message) {
    return null;
  }

  // Build username: prefer username, fallback to full name
  const username =
    callback.from.username ||
    [callback.from.first_name, callback.from.last_name].filter(Boolean).join(' ') ||
    'unknown';

  return {
    type: 'callback',
    callbackQueryId: callback.id,
    chatId: callback.message.chat.id,
    messageId: callback.message.message_id,
    userId: callback.from.id,
    username,
    data: callback.data,
  };
}

/**
 * Check if callback is for invoice generation (not duplicate handling)
 */
export function isInvoiceCallback(data: string): boolean {
  try {
    const parsed = JSON.parse(data);
    // Invoice callbacks have action like 'select_type', 'select_payment', 'confirm', 'cancel'
    return ['select_type', 'select_payment', 'confirm', 'cancel'].includes(parsed.action);
  } catch {
    return false;
  }
}

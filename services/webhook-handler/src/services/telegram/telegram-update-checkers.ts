/**
 * Telegram Update Checkers
 * Boolean functions to determine update types for routing
 */

import type { TelegramUpdate } from './telegram-types';

/**
 * Check if a message is from a bot (to avoid responding to our own messages)
 */
export function isFromBot(update: TelegramUpdate): boolean {
  const message = update.message || update.channel_post || update.edited_message;
  return Boolean(message?.from?.is_bot);
}

/**
 * Check if the update contains a photo message
 */
export function isPhotoMessage(update: TelegramUpdate): boolean {
  if (isFromBot(update)) {
    return false;
  }
  const message = update.message || update.channel_post;
  return Boolean(message?.photo && message.photo.length > 0);
}

/**
 * Check if the update is a command (starts with /)
 */
export function isCommand(update: TelegramUpdate): boolean {
  if (isFromBot(update)) {
    return false;
  }
  const message = update.message || update.channel_post;
  return Boolean(message?.text?.startsWith('/'));
}

/**
 * Check if the update is an /invoice command
 */
export function isInvoiceCommand(update: TelegramUpdate): boolean {
  if (isFromBot(update)) {
    return false;
  }
  const message = update.message || update.channel_post;
  return Boolean(message?.text?.toLowerCase().startsWith('/invoice'));
}

/**
 * Check if the update is an /onboard command
 */
export function isOnboardCommand(update: TelegramUpdate): boolean {
  if (isFromBot(update)) {
    return false;
  }
  const message = update.message || update.channel_post;
  return Boolean(message?.text?.toLowerCase().startsWith('/onboard'));
}

/**
 * Check if the update is a /report command
 */
export function isReportCommand(update: TelegramUpdate): boolean {
  if (isFromBot(update)) {
    return false;
  }
  const message = update.message || update.channel_post;
  return Boolean(message?.text?.toLowerCase().startsWith('/report'));
}

/**
 * Check if the update is a text message (not a command)
 */
export function isTextMessage(update: TelegramUpdate): boolean {
  if (isFromBot(update)) {
    return false;
  }
  const message = update.message || update.channel_post;
  return Boolean(message?.text && !message.text.startsWith('/'));
}

/**
 * Check if the update contains a document message
 */
export function isDocumentMessage(update: TelegramUpdate): boolean {
  if (isFromBot(update)) {
    return false;
  }
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
 * Check if the update is a callback query (button press)
 */
export function isCallbackQuery(update: TelegramUpdate): boolean {
  return Boolean(update.callback_query);
}

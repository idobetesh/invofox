/**
 * Telegram Invoice Extractors
 * Extract payloads for invoice generation flow (command, message, callback)
 */

import type {
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
} from '../../../../../shared/types';
import type { TelegramUpdate } from './telegram-types';

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
    chatTitle: message.chat.title, // Group/channel title (undefined for private chats)
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
    updateId: update.update_id,
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
    // Invoice callbacks have action like 'select_type', 'select_invoice', 'select_payment', 'confirm', 'cancel'
    // Multi-invoice actions: 'toggle_invoice', 'confirm_selection', 'show_more'
    return [
      'select_type',
      'select_invoice',
      'toggle_invoice',
      'confirm_selection',
      'show_more',
      'select_payment',
      'confirm',
      'cancel',
    ].includes(parsed.action);
  } catch {
    return false;
  }
}

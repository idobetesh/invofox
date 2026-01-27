/**
 * Telegram Report Extractors
 * Extract payloads for report generation flow
 */

import type { ReportCommandPayload } from '../../../../../shared/types';
import type { TelegramUpdate } from './telegram-types';

/**
 * Extract report command payload for /report command
 */
export function extractReportCommandPayload(update: TelegramUpdate): ReportCommandPayload | null {
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

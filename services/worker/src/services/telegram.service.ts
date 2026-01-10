/**
 * Telegram API service for downloading files and sending messages
 */

import type { 
  TelegramFile, 
  TelegramApiResponse, 
  DuplicateMatch,
  TelegramInlineKeyboardMarkup,
  CallbackPayload,
} from '../../../../shared/types';
import { getConfig } from '../config';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Get file info from Telegram
 */
export async function getFile(fileId: string): Promise<TelegramFile> {
  const config = getConfig();
  const url = `${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/getFile?file_id=${encodeURIComponent(fileId)}`;

  const response = await fetch(url);
  const data = (await response.json()) as TelegramApiResponse<TelegramFile>;

  if (!data.ok || !data.result) {
    throw new Error(`Failed to get file: ${data.description || 'Unknown error'}`);
  }

  return data.result;
}

/**
 * Download file from Telegram servers
 */
export async function downloadFile(filePath: string): Promise<Buffer> {
  const config = getConfig();
  const url = `${TELEGRAM_API_BASE}/file/bot${config.telegramBotToken}/${filePath}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download file by file_id (combines getFile and downloadFile)
 */
export async function downloadFileById(fileId: string): Promise<{
  buffer: Buffer;
  filePath: string;
}> {
  const fileInfo = await getFile(fileId);

  if (!fileInfo.file_path) {
    throw new Error('File path not available');
  }

  const buffer = await downloadFile(fileInfo.file_path);

  return {
    buffer,
    filePath: fileInfo.file_path,
  };
}

/**
 * Get file extension from Telegram file path
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'jpg';
}

/**
 * Send a message to a chat
 */
export async function sendMessage(
  chatId: number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    replyToMessageId?: number;
    disableWebPagePreview?: boolean;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }
): Promise<void> {
  const config = getConfig();
  const url = `${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };

  if (options?.parseMode) {
    body.parse_mode = options.parseMode;
  }

  if (options?.replyToMessageId) {
    body.reply_to_message_id = options.replyToMessageId;
  }

  if (options?.disableWebPagePreview) {
    body.disable_web_page_preview = options.disableWebPagePreview;
  }

  if (options?.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramApiResponse<unknown>;

  if (!data.ok) {
    throw new Error(`Failed to send message: ${data.description || 'Unknown error'}`);
  }
}

/**
 * Answer a callback query (required to stop loading indicator on button)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  options?: {
    text?: string;
    showAlert?: boolean;
  }
): Promise<void> {
  const config = getConfig();
  const url = `${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/answerCallbackQuery`;

  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
  };

  if (options?.text) {
    body.text = options.text;
  }

  if (options?.showAlert) {
    body.show_alert = options.showAlert;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramApiResponse<unknown>;

  if (!data.ok) {
    throw new Error(`Failed to answer callback: ${data.description || 'Unknown error'}`);
  }
}

/**
 * Edit a message (to remove buttons after user decision)
 */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableWebPagePreview?: boolean;
  }
): Promise<void> {
  const config = getConfig();
  const url = `${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/editMessageText`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };

  if (options?.parseMode) {
    body.parse_mode = options.parseMode;
  }

  if (options?.disableWebPagePreview) {
    body.disable_web_page_preview = options.disableWebPagePreview;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramApiResponse<unknown>;

  if (!data.ok) {
    throw new Error(`Failed to edit message: ${data.description || 'Unknown error'}`);
  }
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDateForDisplay(isoString: string | null): string {
  if (!isoString) {return '?';}
  
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {return '?';}
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '?';
  }
}

/**
 * Format success message with emojis and embedded link
 */
export function formatSuccessMessage(
  invoiceDate: string | null,
  totalAmount: number | null,
  currency: string | null,
  driveLink: string
): string {
  const date = formatDateForDisplay(invoiceDate);
  const amount = totalAmount !== null ? totalAmount.toString() : '?';
  const curr = currency || '';
  const amountDisplay = amount === '?' ? '?' : `${amount} ${curr}`.trim();

  return `✅ Invoice processed
📅 ${date}
💰 ${amountDisplay}
📎 [View](${driveLink})`;
}

/**
 * Format failure message
 */
export function formatFailureMessage(
  messageId: number,
  lastStep: string,
  error: string
): string {
  // Truncate error to 100 chars
  const shortError = error.length > 100 ? error.substring(0, 100) + '...' : error;

  return `❌ Failed to process invoice
Msg: ${messageId}
Last step: ${lastStep}
Error: ${shortError}
(Try sending a clearer screenshot)`;
}

/**
 * Format duplicate warning message with inline buttons
 */
export function formatDuplicateWarning(
  duplicate: DuplicateMatch,
  newDriveLink: string,
  chatId: number,
  messageId: number
): { text: string; keyboard: TelegramInlineKeyboardMarkup } {
  const date = formatDateForDisplay(duplicate.invoiceDate);
  const amount = duplicate.totalAmount !== null ? duplicate.totalAmount.toString() : '?';
  const vendor = duplicate.vendorName || 'Unknown';
  const matchLabel = duplicate.matchType === 'exact' ? 'Exact duplicate' : 'Similar invoice';

  const text = `⚠️ ${matchLabel} detected!
📅 ${date} | 💰 ${amount}
🏢 ${vendor}
📎 [Existing](${duplicate.driveLink})

New upload pending - choose action:`;

  // Encode callback data as JSON
  const keepBothData: CallbackPayload = { action: 'keep_both', chatId, messageId };
  const deleteNewData: CallbackPayload = { action: 'delete_new', chatId, messageId };

  const keyboard: TelegramInlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Keep Both', callback_data: JSON.stringify(keepBothData) },
        { text: '🗑️ Delete New', callback_data: JSON.stringify(deleteNewData) },
      ],
    ],
  };

  return { text, keyboard };
}

/**
 * Format message after user decides on duplicate
 */
export function formatDuplicateResolved(
  action: 'keep_both' | 'delete_new',
  driveLink: string,
  existingLink: string
): string {
  if (action === 'keep_both') {
    return `✅ Both invoices kept
📎 [New](${driveLink}) | [Existing](${existingLink})`;
  } else {
    return `🗑️ Duplicate deleted
📎 [Existing](${existingLink}) kept`;
  }
}

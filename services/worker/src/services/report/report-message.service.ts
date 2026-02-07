/**
 * Report Message Service
 * Handles Telegram message formatting and keyboard building for report flow
 */

import type { DatePreset } from '../../../../../shared/report.types';
import * as telegramService from '../telegram.service';

/**
 * Send type selection message (Revenue or Expenses)
 * Returns the message ID for later deletion
 */
export async function sendTypeSelectionMessage(chatId: number, sessionId: string): Promise<number> {
  const message = '\u200F📊 איזה סוג דוח תרצה ליצור?';
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '📈 הכנסות',
          callback_data: JSON.stringify({
            a: 'type',
            s: sessionId,
            v: 'rev',
          }),
        },
        {
          text: '💸 הוצאות',
          callback_data: JSON.stringify({
            a: 'type',
            s: sessionId,
            v: 'exp',
          }),
        },
      ],
      [
        {
          text: '❌ ביטול',
          callback_data: JSON.stringify({
            a: 'cancel',
            s: sessionId,
          }),
        },
      ],
    ],
  };

  const result = await telegramService.sendMessage(chatId, message, {
    replyMarkup: keyboard,
  });
  return result.message_id;
}

/**
 * Send date range selection message
 * Returns the message ID for later deletion
 */
export async function sendDateSelectionMessage(chatId: number, sessionId: string): Promise<number> {
  const message = '\u200F📅 באיזו תקופה תרצה לראות את הדוח?';
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: 'החודש',
          callback_data: JSON.stringify({
            a: 'date',
            s: sessionId,
            v: 'tm',
          }),
        },
        {
          text: 'חודש שעבר',
          callback_data: JSON.stringify({
            a: 'date',
            s: sessionId,
            v: 'lm',
          }),
        },
      ],
      [
        {
          text: 'מתחילת השנה',
          callback_data: JSON.stringify({
            a: 'date',
            s: sessionId,
            v: 'ytd',
          }),
        },
      ],
      [
        {
          text: '❌ ביטול',
          callback_data: JSON.stringify({
            a: 'cancel',
            s: sessionId,
          }),
        },
      ],
    ],
  };

  const result = await telegramService.sendMessage(chatId, message, {
    replyMarkup: keyboard,
  });
  return result.message_id;
}

/**
 * Send format selection message (PDF, Excel, CSV)
 * Returns the message ID for later deletion
 */
export async function sendFormatSelectionMessage(
  chatId: number,
  sessionId: string,
  invoiceCount: number
): Promise<number> {
  const message = `\u200F✅ מצאנו ${invoiceCount} חשבוניות!\n\n\u200F📄 באיזה פורמט תרצה את הדוח?`;
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '📄 PDF',
          callback_data: JSON.stringify({
            a: 'fmt',
            s: sessionId,
            v: 'pdf',
          }),
        },
        {
          text: '📊 Excel',
          callback_data: JSON.stringify({
            a: 'fmt',
            s: sessionId,
            v: 'xls',
          }),
        },
        {
          text: '📝 CSV',
          callback_data: JSON.stringify({
            a: 'fmt',
            s: sessionId,
            v: 'csv',
          }),
        },
      ],
      [
        {
          text: '❌ ביטול',
          callback_data: JSON.stringify({
            a: 'cancel',
            s: sessionId,
          }),
        },
      ],
    ],
  };

  const result = await telegramService.sendMessage(chatId, message, {
    replyMarkup: keyboard,
  });
  return result.message_id;
}

/**
 * Get Hebrew label for date preset
 */
export function getDateLabel(preset: DatePreset): string {
  const labels: Record<DatePreset, string> = {
    this_month: 'החודש',
    last_month: 'חודש שעבר',
    ytd: 'מתחילת השנה',
  };
  return labels[preset] || preset;
}

/**
 * Send report generated message with file
 * Deletes the "generating" message before sending the file
 */
export async function sendReportGeneratedMessage(
  chatId: number,
  fileBuffer: Buffer,
  filename: string,
  reportType: 'revenue' | 'expenses',
  datePreset: DatePreset,
  dateRange: { start: string; end: string },
  metrics: { totalRevenue: number; invoiceCount: number; avgInvoice: number },
  generatingMessageId?: number
): Promise<void> {
  const reportTypeName = reportType === 'revenue' ? 'הכנסות' : 'הוצאות';
  const dateLabel = getDateLabel(datePreset);
  const caption =
    `\u200F✅ דוח ${reportTypeName} נוצר!\n\n` +
    `\u200F📊 תקופה: ${dateLabel}\n` +
    `\u200F📅 תאריכים: ${dateRange.start} עד ${dateRange.end}\n` +
    `\u200F💰 סה"כ: ₪${metrics.totalRevenue.toLocaleString('he-IL')}\n` +
    `\u200F📄 חשבוניות: ${metrics.invoiceCount}\n` +
    `\u200F📈 ממוצע: ₪${Math.round(metrics.avgInvoice).toLocaleString('he-IL')}\n\n`;

  // Delete generating message first (for clean UI)
  if (generatingMessageId) {
    try {
      await telegramService.deleteMessage(chatId, generatingMessageId);
    } catch (error) {
      // Ignore error if message already deleted or not found
    }
  }

  await telegramService.sendDocument(chatId, fileBuffer, filename, {
    caption,
    parseMode: 'Markdown',
  });
}

/**
 * Send no invoices found message
 */
export async function sendNoInvoicesMessage(
  chatId: number,
  datePreset: DatePreset,
  dateRange: { start: string; end: string }
): Promise<void> {
  const dateLabel = getDateLabel(datePreset);
  const message =
    `\u200F📊 אין חשבוניות לתקופה הנבחרת\n\n` +
    `תקופה: ${dateLabel}\n` +
    `תאריכים: ${dateRange.start} עד ${dateRange.end}\n\n` +
    `\u200F💡 העלה חשבוניות לצ'אט זה כדי שנוכל ליצור דוחות!\n\n` +
    `רוצה לנסות תקופה אחרת? שלח /report`;

  await telegramService.sendMessage(chatId, message);
}

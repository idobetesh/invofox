/**
 * Report Message Service
 * Handles Telegram message formatting and keyboard building for report flow
 */

import type { DatePreset } from '../../../../../shared/report.types';
import * as telegramService from '../telegram.service';

/**
 * Send type selection message (Revenue or Expenses)
 */
export async function sendTypeSelectionMessage(chatId: number, sessionId: string): Promise<void> {
  const message = '📊 איזה סוג דוח תרצה ליצור?';
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

  await telegramService.sendMessage(chatId, message, {
    replyMarkup: keyboard,
  });
}

/**
 * Send date range selection message
 */
export async function sendDateSelectionMessage(chatId: number, sessionId: string): Promise<void> {
  const message = '📅 באיזו תקופה תרצה לראות את הדוח?';
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '📆 החודש',
          callback_data: JSON.stringify({
            a: 'date',
            s: sessionId,
            v: 'tm',
          }),
        },
        {
          text: '📆 חודש שעבר',
          callback_data: JSON.stringify({
            a: 'date',
            s: sessionId,
            v: 'lm',
          }),
        },
      ],
      [
        {
          text: '📆 שנה עד היום (YTD)',
          callback_data: JSON.stringify({
            a: 'date',
            s: sessionId,
            v: 'ytd',
          }),
        },
        {
          text: '📆 שנה זו',
          callback_data: JSON.stringify({
            a: 'date',
            s: sessionId,
            v: 'ty',
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

  await telegramService.sendMessage(chatId, message, {
    replyMarkup: keyboard,
  });
}

/**
 * Send format selection message (PDF, Excel, CSV)
 */
export async function sendFormatSelectionMessage(
  chatId: number,
  sessionId: string,
  invoiceCount: number
): Promise<void> {
  const message = `✅ מצאנו ${invoiceCount} חשבוניות!\n\n📄 באיזה פורמט תרצה את הדוח?`;
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

  await telegramService.sendMessage(chatId, message, {
    replyMarkup: keyboard,
  });
}

/**
 * Get Hebrew label for date preset
 */
export function getDateLabel(preset: DatePreset): string {
  const labels: Record<DatePreset, string> = {
    this_month: 'החודש',
    last_month: 'חודש שעבר',
    ytd: 'שנה עד היום (YTD)',
    this_year: 'שנה זו',
  };
  return labels[preset] || preset;
}

/**
 * Send report generated message with file
 */
export async function sendReportGeneratedMessage(
  chatId: number,
  fileBuffer: Buffer,
  filename: string,
  reportType: 'revenue' | 'expenses',
  datePreset: DatePreset,
  dateRange: { start: string; end: string },
  metrics: { totalRevenue: number; invoiceCount: number; avgInvoice: number }
): Promise<void> {
  const reportTypeName = reportType === 'revenue' ? 'הכנסות' : 'הוצאות';
  const dateLabel = getDateLabel(datePreset);
  const caption =
    `✅ דוח ${reportTypeName} נוצר!\n\n` +
    `📊 תקופה: ${dateLabel}\n` +
    `📅 תאריכים: ${dateRange.start} עד ${dateRange.end}\n` +
    `💰 סה"כ: ₪${metrics.totalRevenue.toLocaleString('he-IL')}\n` +
    `📄 חשבוניות: ${metrics.invoiceCount}\n` +
    `📈 ממוצע: ₪${Math.round(metrics.avgInvoice).toLocaleString('he-IL')}\n\n` +
    `רוצה עוד דוח? שלח /report`;

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
    `📊 אין חשבוניות לתקופה הנבחרת\n\n` +
    `תקופה: ${dateLabel}\n` +
    `תאריכים: ${dateRange.start} עד ${dateRange.end}\n\n` +
    `💡 העלה חשבוניות לצ'אט זה כדי שנוכל ליצור דוחות!\n\n` +
    `רוצה לנסות תקופה אחרת? שלח /report`;

  await telegramService.sendMessage(chatId, message);
}

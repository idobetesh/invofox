/**
 * Correction service
 * Handles user-initiated field corrections on processed invoices
 */

import * as storeService from './firestore.service';
import * as sheetsService from './sheets.service';
import * as telegramService from './telegram.service';
import { t } from './i18n/languages';
import logger from '../logger';

/**
 * Process a correction input message from the user.
 * Called when a pending correction is detected for the chat.
 * Validates the input, updates Firestore + Sheets, and edits the original success message.
 */
export async function handleCorrectionInput(
  pendingJob: Awaited<ReturnType<typeof storeService.getCorrectionPendingJob>>,
  text: string,
  chatId: number
): Promise<void> {
  if (!pendingJob?.correctionPending) {
    return;
  }

  const { field, successMessageId } = pendingJob.correctionPending;
  const jobId = pendingJob.jobId as string;
  const log = logger.child({ jobId, field, chatId });

  if (field === 'totalAmount') {
    const normalizedText = text.trim();
    if (!/^\d+(\.\d+)?$/.test(normalizedText)) {
      await telegramService.sendMessage(chatId, t('he', 'correction.invalidAmount'));
      return;
    }
    const amount = parseFloat(normalizedText);
    if (amount <= 0) {
      await telegramService.sendMessage(chatId, t('he', 'correction.invalidAmount'));
      return;
    }
    const oldAmount = pendingJob.totalAmount ?? null;
    await storeService.applyJobCorrection(jobId, { totalAmount: amount });
    try {
      if (pendingJob.sheetRowId) {
        try {
          await sheetsService.updateRow(chatId, pendingJob.sheetRowId, { amount: String(amount) });
        } catch (err) {
          log.warn({ err }, 'Sheets update failed after amount correction (Firestore updated)');
        }
      }
      const updatedMessage = telegramService.formatSuccessMessage(
        pendingJob.invoiceDate || null,
        amount,
        pendingJob.currency || null,
        pendingJob.driveLink || ''
      );
      await telegramService.editMessageText(
        chatId,
        successMessageId,
        `${updatedMessage}\n\n${t('he', 'correction.amountCorrected')}`,
        {
          parseMode: 'Markdown',
          disableWebPagePreview: true,
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: t('he', 'correction.editButton'),
                  callback_data: JSON.stringify({ a: 'ei', j: jobId }),
                },
              ],
            ],
          },
        }
      );
      const oldDisplay =
        oldAmount !== null ? `${oldAmount} ${pendingJob.currency || ''}`.trim() : '?';
      await telegramService.sendMessage(
        chatId,
        t('he', 'correction.amountUpdated', {
          old: oldDisplay,
          new: `${amount} ${pendingJob.currency || ''}`.trim(),
        })
      );
    } finally {
      await storeService.clearCorrectionPending(jobId);
    }
    return;
  }

  if (field === 'invoiceDate') {
    const dateMatch = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dateMatch) {
      await telegramService.sendMessage(chatId, t('he', 'correction.invalidDate'));
      return;
    }
    const [, day, month, year] = dateMatch;
    const dayNum = parseInt(day, 10);
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    const dateObj = new Date(yearNum, monthNum - 1, dayNum);
    if (
      dateObj.getFullYear() !== yearNum ||
      dateObj.getMonth() !== monthNum - 1 ||
      dateObj.getDate() !== dayNum
    ) {
      await telegramService.sendMessage(chatId, t('he', 'correction.invalidDate'));
      return;
    }
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const oldDate = pendingJob.invoiceDate || null;
    await storeService.applyJobCorrection(jobId, { invoiceDate: isoDate });
    try {
      if (pendingJob.sheetRowId) {
        try {
          await sheetsService.updateRow(chatId, pendingJob.sheetRowId, {
            invoiceDate: `'${text.trim()}`,
          });
        } catch (err) {
          log.warn({ err }, 'Sheets update failed after date correction (Firestore updated)');
        }
      }
      const updatedMessage = telegramService.formatSuccessMessage(
        isoDate,
        pendingJob.totalAmount ?? null,
        pendingJob.currency || null,
        pendingJob.driveLink || ''
      );
      await telegramService.editMessageText(
        chatId,
        successMessageId,
        `${updatedMessage}\n\n${t('he', 'correction.dateCorrected')}`,
        {
          parseMode: 'Markdown',
          disableWebPagePreview: true,
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: t('he', 'correction.editButton'),
                  callback_data: JSON.stringify({ a: 'ei', j: jobId }),
                },
              ],
            ],
          },
        }
      );
      const oldDisplay = oldDate ? oldDate.split('T')[0] : '?';
      await telegramService.sendMessage(
        chatId,
        t('he', 'correction.dateUpdated', { old: oldDisplay, new: text.trim() })
      );
    } finally {
      await storeService.clearCorrectionPending(jobId);
    }
    return;
  }

  if (field === 'vendorName') {
    const name = text.trim();
    if (!name) {
      await telegramService.sendMessage(chatId, t('he', 'correction.invalidVendor'));
      return;
    }
    const oldName = pendingJob.vendorName || null;
    await storeService.applyJobCorrection(jobId, { vendorName: name });
    try {
      if (pendingJob.sheetRowId) {
        try {
          await sheetsService.updateRow(chatId, pendingJob.sheetRowId, { vendorName: name });
        } catch (err) {
          log.warn({ err }, 'Sheets update failed after vendor correction (Firestore updated)');
        }
      }
      const updatedMessage = telegramService.formatSuccessMessage(
        pendingJob.invoiceDate || null,
        pendingJob.totalAmount ?? null,
        pendingJob.currency || null,
        pendingJob.driveLink || ''
      );
      await telegramService.editMessageText(
        chatId,
        successMessageId,
        `${updatedMessage}\n\n${t('he', 'correction.vendorCorrected')}`,
        {
          parseMode: 'Markdown',
          disableWebPagePreview: true,
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: t('he', 'correction.editButton'),
                  callback_data: JSON.stringify({ a: 'ei', j: jobId }),
                },
              ],
            ],
          },
        }
      );
      await telegramService.sendMessage(
        chatId,
        t('he', 'correction.vendorUpdated', { old: oldName || '?', new: name })
      );
    } finally {
      await storeService.clearCorrectionPending(jobId);
    }
    return;
  }
}

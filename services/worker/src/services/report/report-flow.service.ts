/**
 * Report Flow Service
 * Business logic for multi-step report generation flow
 */

import type { ReportType, ReportFormat, DatePreset } from '../../../../../shared/report.types';
import * as reportService from './report.service';
import * as reportGeneratorService from './report-generator.service';
import * as reportSessionService from './report-session.service';
import * as reportMessageService from './report-message.service';
import * as businessConfigService from '../business-config/config.service';
import * as telegramService from '../telegram.service';
import logger from '../../logger';

/**
 * Handle type selection (Revenue or Expenses)
 */
export async function handleTypeSelection(
  sessionId: string,
  reportType: ReportType,
  chatId: number,
  callbackQueryId: string
): Promise<void> {
  const log = logger.child({ sessionId, reportType, chatId });
  log.info('Processing type selection');

  try {
    // Get and validate session
    const session = await reportSessionService.getReportSession(sessionId);
    if (!session || session.status !== 'active' || session.currentStep !== 'type') {
      await telegramService.answerCallbackQuery(callbackQueryId, {
        text: '❌ פג תוקף ההפעלה. אנא שלח /report שוב',
        showAlert: true,
      });
      return;
    }

    // Update session with report type
    await reportSessionService.updateReportSession(sessionId, {
      reportType,
      currentStep: 'date',
    });

    // Answer callback query
    const typeName = reportType === 'revenue' ? 'הכנסות' : 'הוצאות';
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: `✅ נבחר: דוח ${typeName}`,
    });

    // Send date selection message
    await reportMessageService.sendDateSelectionMessage(chatId, sessionId);

    log.info('Type selection completed, sent date selection');
  } catch (error) {
    log.error({ error }, 'Failed to handle type selection');
    throw error;
  }
}

/**
 * Handle date selection
 */
export async function handleDateSelection(
  sessionId: string,
  datePreset: DatePreset,
  chatId: number,
  callbackQueryId: string
): Promise<void> {
  const log = logger.child({ sessionId, datePreset, chatId });
  log.info('Processing date selection');

  try {
    // Get and validate session
    const session = await reportSessionService.getReportSession(sessionId);
    if (!session || session.status !== 'active' || session.currentStep !== 'date') {
      await telegramService.answerCallbackQuery(callbackQueryId, {
        text: '❌ פג תוקף ההפעלה. אנא שלח /report שוב',
        showAlert: true,
      });
      return;
    }

    if (!session.reportType) {
      throw new Error('Report type not set');
    }

    // Get business config
    const config = await businessConfigService.getBusinessConfig(chatId);
    const businessName = config?.business?.name || 'העסק שלי';
    const logoUrl = config?.business?.logoUrl;

    // Get date range for preset
    const dateRange = reportService.getDateRangeForPreset(datePreset);

    // Check if there are invoices for this period
    const reportData = await reportService.generateReportData(
      chatId,
      dateRange,
      businessName,
      session.reportType,
      logoUrl
    );

    if (reportData.invoices.length === 0) {
      await telegramService.answerCallbackQuery(callbackQueryId, {
        text: '❌ אין חשבוניות בתקופה זו',
        showAlert: true,
      });
      await reportMessageService.sendNoInvoicesMessage(chatId, datePreset, dateRange);

      // Cancel session
      await reportSessionService.cancelReportSession(sessionId);
      return;
    }

    // Update session with date preset
    await reportSessionService.updateReportSession(sessionId, {
      datePreset,
      currentStep: 'format',
    });

    // Answer callback query
    const dateLabel = reportMessageService.getDateLabel(datePreset);
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: `✅ נבחר: ${dateLabel}`,
    });

    // Send format selection message
    await reportMessageService.sendFormatSelectionMessage(
      chatId,
      sessionId,
      reportData.invoices.length
    );

    log.info(
      { invoiceCount: reportData.invoices.length },
      'Date selection completed, sent format selection'
    );
  } catch (error) {
    log.error({ error }, 'Failed to handle date selection');
    throw error;
  }
}

/**
 * Handle format selection and generate report
 */
export async function handleFormatSelection(
  sessionId: string,
  format: ReportFormat,
  chatId: number,
  callbackQueryId: string
): Promise<void> {
  const log = logger.child({ sessionId, format, chatId });
  log.info('Processing format selection');

  try {
    // Get and validate session
    const session = await reportSessionService.getReportSession(sessionId);
    if (!session || session.status !== 'active' || session.currentStep !== 'format') {
      await telegramService.answerCallbackQuery(callbackQueryId, {
        text: '❌ פג תוקף ההפעלה. אנא שלח /report שוב',
        showAlert: true,
      });
      return;
    }

    if (!session.reportType || !session.datePreset) {
      throw new Error('Missing report type or date preset');
    }

    // Update session with format
    await reportSessionService.updateReportSession(sessionId, {
      format,
      currentStep: 'generating',
    });

    // Answer callback query
    const formatName = format === 'pdf' ? 'PDF' : format === 'excel' ? 'Excel' : 'CSV';
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: `✅ מייצר דוח ${formatName}...`,
    });

    // Send generating message
    await telegramService.sendMessage(chatId, '⏳ מייצר דוח...\nזה עשוי לקחת מספר שניות.');

    // Get business config
    const config = await businessConfigService.getBusinessConfig(chatId);
    const businessName = config?.business?.name || 'העסק שלי';
    const logoUrl = config?.business?.logoUrl;

    // Get date range for preset
    const dateRange = reportService.getDateRangeForPreset(session.datePreset);

    // Generate report data
    const reportData = await reportService.generateReportData(
      chatId,
      dateRange,
      businessName,
      session.reportType,
      logoUrl
    );

    // Generate file based on format
    let fileBuffer: Buffer;
    let filename: string;

    if (format === 'pdf') {
      fileBuffer = await reportGeneratorService.generatePDFReport(reportData);
      filename = `report_${session.reportType}_${dateRange.start}_${dateRange.end}.pdf`;
    } else if (format === 'excel') {
      fileBuffer = await reportGeneratorService.generateExcelReport(reportData);
      filename = `report_${session.reportType}_${dateRange.start}_${dateRange.end}.xlsx`;
    } else {
      fileBuffer = await reportGeneratorService.generateCSVReport(reportData);
      filename = `report_${session.reportType}_${dateRange.start}_${dateRange.end}.csv`;
    }

    // Send report to user
    await reportMessageService.sendReportGeneratedMessage(
      chatId,
      fileBuffer,
      filename,
      session.reportType,
      session.datePreset,
      dateRange,
      reportData.metrics
    );

    // Mark session as completed
    await reportSessionService.completeReportSession(sessionId);

    log.info(
      {
        format,
        invoiceCount: reportData.metrics.invoiceCount,
        totalRevenue: reportData.metrics.totalRevenue,
        fileSizeKb: Math.round(fileBuffer.length / 1024),
      },
      'Report generated and sent successfully'
    );
  } catch (error) {
    log.error({ error }, 'Failed to handle format selection');
    throw error;
  }
}

/**
 * Handle cancel action
 */
export async function handleCancelAction(
  sessionId: string,
  chatId: number,
  callbackQueryId: string
): Promise<void> {
  const log = logger.child({ sessionId, chatId });
  log.info('Processing cancel action');

  try {
    // Cancel session
    await reportSessionService.cancelReportSession(sessionId);

    // Answer callback query
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: '✅ פעולה בוטלה',
    });

    // Send cancellation message
    await telegramService.sendMessage(
      chatId,
      '❌ יצירת הדוח בוטלה\n\nרוצה להתחיל שוב? שלח /report'
    );

    log.info('Report session cancelled');
  } catch (error) {
    log.error({ error }, 'Failed to handle cancel action');
    throw error;
  }
}

/**
 * Invoice callback service
 * Business logic for each Telegram inline-button callback action in the invoice generation flow.
 * Returns the action name so the controller can respond over HTTP.
 */

import * as sessionService from './session.service';
import { generateInvoice, getGeneratedInvoice } from '.';
import * as telegramService from '../telegram.service';
import { buildConfirmationKeyboard, buildInvoiceSelectionKeyboard } from './keyboards.service';
import { getOpenInvoices, countOpenInvoices } from './open-invoices.service';
import {
  buildConfirmationMessage,
  buildSuccessMessage,
  getDocumentTypeLabel,
} from './messages.service';
import { t } from '../i18n/languages';
import logger from '../../logger';
import type {
  InvoiceDocumentType,
  InvoiceSession,
  PaymentMethod,
} from '../../../../../shared/types';

const log = logger.child({ service: 'invoice-callback' });

export async function handleSelectType(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string,
  documentType: InvoiceDocumentType
): Promise<string> {
  await sessionService.setDocumentType(chatId, userId, documentType);
  const typeLabel = getDocumentTypeLabel(documentType);
  await telegramService.answerCallbackQuery(callbackQueryId);

  if (documentType === 'receipt') {
    const [openInvoices, totalCount] = await Promise.all([
      getOpenInvoices(chatId, 0, 10),
      countOpenInvoices(chatId),
    ]);

    if (totalCount === 0) {
      await telegramService.editMessageText(chatId, messageId, t('he', 'invoice.noOpenInvoicesHe'));
      await sessionService.deleteSession(chatId, userId);
      log.info({ chatId }, 'No open invoices found for receipt creation');
      return 'no_open_invoices';
    }

    await telegramService.editMessageText(
      chatId,
      messageId,
      t('he', 'invoice.typeSelected', { type: typeLabel })
    );

    const showing = Math.min(10, totalCount);
    const invoiceListMsg = `${t('he', 'invoice.selectInvoiceHe')}\n\n📋 מציג ${showing} מתוך ${totalCount} חשבוניות\n💡 ניתן לבחור מספר חשבוניות ליצירת קבלה אחת`;
    await telegramService.sendMessage(chatId, invoiceListMsg, {
      replyMarkup: buildInvoiceSelectionKeyboard(openInvoices, [], [], 0, totalCount),
    });

    log.info(
      { chatId, count: showing, total: totalCount },
      'Showed open invoices for receipt creation'
    );
    return 'showing_open_invoices';
  }

  await telegramService.editMessageText(
    chatId,
    messageId,
    t('he', 'invoice.typeSelected', { type: typeLabel })
  );
  log.info({ chatId, documentType }, 'Document type selected');
  return 'type_selected';
}

export async function handleSelectInvoice(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string,
  invoiceNumber: string
): Promise<string> {
  const invoice = await getGeneratedInvoice(chatId, invoiceNumber);

  if (!invoice) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'invoice.invoiceNotFound'),
      showAlert: true,
    });
    return 'invoice_not_found';
  }

  await sessionService.updateSession(chatId, userId, {
    status: 'awaiting_payment',
    relatedInvoiceNumber: invoiceNumber,
    customerName: invoice.customerName,
    description: t('he', 'invoice.receiptDescription', { invoiceNumber }),
  });

  const remainingBalance = invoice.remainingBalance ?? invoice.amount;
  const paidAmount = invoice.paidAmount || 0;

  await telegramService.answerCallbackQuery(callbackQueryId);
  await telegramService.editMessageText(
    chatId,
    messageId,
    t('he', 'invoice.invoiceSelected', { invoiceNumber })
  );

  const promptMsg = t('he', 'invoice.invoiceDetails', {
    customerName: invoice.customerName,
    amount: invoice.amount.toLocaleString(),
    paidAmount: paidAmount.toLocaleString(),
    remainingBalance: remainingBalance.toLocaleString(),
    exampleAmount: Math.floor(remainingBalance / 2).toLocaleString(),
  });
  await telegramService.sendMessage(chatId, promptMsg);

  log.info({ chatId, invoiceNumber, remainingBalance }, 'Invoice selected for receipt');
  return 'invoice_selected';
}

export async function handleToggleInvoice(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string,
  invoiceNumber: string,
  session: InvoiceSession
): Promise<string> {
  const invoice = await getGeneratedInvoice(chatId, invoiceNumber);

  if (!invoice) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'invoice.invoiceNotFound'),
      showAlert: true,
    });
    return 'invoice_not_found';
  }

  const selectedNumbers = session.selectedInvoiceNumbers || [];
  const selectedData = session.selectedInvoiceData || [];
  const isCurrentlySelected = selectedNumbers.includes(invoiceNumber);

  if (!isCurrentlySelected && selectedNumbers.length >= 10) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'invoice.multiInvoiceMaxError'),
      showAlert: true,
    });
    return 'max_limit_reached';
  }

  if (!isCurrentlySelected && selectedData.length > 0) {
    const firstCustomer = selectedData[0].customerName;
    if (invoice.customerName !== firstCustomer) {
      await telegramService.answerCallbackQuery(callbackQueryId, {
        text: t('he', 'invoice.multiInvoiceCustomerError'),
        showAlert: true,
      });
      return 'customer_mismatch';
    }

    const firstCurrency = selectedData[0].currency;
    const invoiceCurrency = invoice.currency || 'ILS';
    if (invoiceCurrency !== firstCurrency) {
      await telegramService.answerCallbackQuery(callbackQueryId, {
        text: 'כל החשבוניות חייבות להיות באותו מטבע',
        showAlert: true,
      });
      return 'currency_mismatch';
    }
  }

  const remainingBalance = invoice.remainingBalance ?? invoice.amount;
  const updatedSession = await sessionService.toggleInvoiceSelection(
    chatId,
    userId,
    invoiceNumber,
    {
      customerName: invoice.customerName,
      remainingBalance,
      date: invoice.date,
      currency: invoice.currency || 'ILS',
    }
  );

  const feedbackText = isCurrentlySelected ? `הוסר: ${invoiceNumber}` : `נבחר: ${invoiceNumber}`;
  await telegramService.answerCallbackQuery(callbackQueryId, { text: feedbackText });

  const [openInvoices, totalCount] = await Promise.all([
    getOpenInvoices(chatId, 0, 10),
    countOpenInvoices(chatId),
  ]);

  await telegramService.editMessageReplyMarkup(chatId, messageId, {
    inline_keyboard: buildInvoiceSelectionKeyboard(
      openInvoices,
      updatedSession.selectedInvoiceNumbers || [],
      updatedSession.selectedInvoiceData || [],
      0,
      totalCount
    ).inline_keyboard,
  });

  log.info(
    { chatId, invoiceNumber, selectedCount: updatedSession.selectedInvoiceNumbers?.length || 0 },
    'Invoice selection toggled'
  );
  return 'invoice_toggled';
}

export async function handleConfirmSelection(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string
): Promise<string> {
  const validationResult = await sessionService.validateAndConfirmSelection(chatId, userId);

  if (!validationResult.success) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: validationResult.error,
      showAlert: true,
    });
    return 'validation_failed';
  }

  const confirmedSession = validationResult.session;
  const selectedCount = confirmedSession.selectedInvoiceNumbers?.length || 0;
  // Derive the total from cached selectedInvoiceData so session.amount stays
  // reserved exclusively for the user-entered payment amount.
  const totalAmount = (confirmedSession.selectedInvoiceData || []).reduce(
    (sum, d) => sum + d.remainingBalance,
    0
  );
  const currency = confirmedSession.currency || 'ILS';
  const currencySymbol = currency === 'ILS' ? '₪' : currency;

  await telegramService.answerCallbackQuery(callbackQueryId);

  const summaryText = `✅ נבחרו ${selectedCount} חשבוניות\nסה״כ לתשלום: ${currencySymbol}${totalAmount.toFixed(2)}\n\nעבור לקוח: ${confirmedSession.customerName}`;
  await telegramService.editMessageText(chatId, messageId, summaryText);

  const exampleAmount = Math.max(1, Math.floor(totalAmount / 2));
  await telegramService.sendMessage(
    chatId,
    t('he', 'invoice.selectAmountPrompt', { example: exampleAmount.toLocaleString() })
  );

  log.info(
    { chatId, selectedCount, totalAmount, customerName: confirmedSession.customerName },
    'Invoice selection confirmed, awaiting amount'
  );
  return 'awaiting_amount';
}

export async function handleShowMore(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string,
  offset: number,
  session: InvoiceSession
): Promise<string> {
  const selectedInvoiceNumbers = session.selectedInvoiceNumbers || [];
  const selectedInvoiceData = session.selectedInvoiceData || [];

  const [openInvoices, totalCount] = await Promise.all([
    getOpenInvoices(chatId, offset, 10),
    countOpenInvoices(chatId),
  ]);

  if (openInvoices.length === 0) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: 'אין עוד חשבוניות להצגה',
      showAlert: true,
    });
    return 'no_more_invoices';
  }

  await telegramService.answerCallbackQuery(callbackQueryId);

  const endIndex = Math.min(offset + openInvoices.length, totalCount);
  const invoiceListMsg = `${t('he', 'invoice.selectInvoiceHe')}\n\n📋 מציג ${offset + 1}-${endIndex} מתוך ${totalCount} חשבוניות\n💡 ניתן לבחור מספר חשבוניות ליצירת קבלה אחת`;
  await telegramService.editMessageText(chatId, messageId, invoiceListMsg);

  await telegramService.editMessageReplyMarkup(chatId, messageId, {
    inline_keyboard: buildInvoiceSelectionKeyboard(
      openInvoices,
      selectedInvoiceNumbers,
      selectedInvoiceData,
      offset,
      totalCount
    ).inline_keyboard,
  });

  log.info(
    {
      chatId,
      offset,
      count: openInvoices.length,
      total: totalCount,
      selectedCount: selectedInvoiceNumbers.length,
    },
    'Showed more invoices with preserved selection'
  );
  return 'showed_more_invoices';
}

export async function handleSelectPayment(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string,
  paymentMethod: PaymentMethod
): Promise<string> {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const updatedSession = await sessionService.setPaymentMethod(
    chatId,
    userId,
    paymentMethod,
    dateStr
  );

  if (
    !updatedSession.documentType ||
    !updatedSession.customerName ||
    !updatedSession.description ||
    !updatedSession.amount
  ) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'invoice.missingDetails'),
      showAlert: true,
    });
    return 'missing_data';
  }

  const confirmText = buildConfirmationMessage({
    documentType: updatedSession.documentType,
    customerName: updatedSession.customerName,
    description: updatedSession.description,
    amount: updatedSession.amount,
    paymentMethod,
    date: dateStr,
  });

  await telegramService.answerCallbackQuery(callbackQueryId);
  await telegramService.editMessageText(chatId, messageId, confirmText);
  await telegramService.sendMessage(chatId, t('he', 'invoice.selectAction'), {
    replyMarkup: buildConfirmationKeyboard(),
  });

  log.info({ chatId, paymentMethod }, 'Payment method selected');
  return 'payment_selected';
}

export async function handleConfirm(
  chatId: number,
  userId: number,
  username: string,
  messageId: number,
  callbackQueryId: string
): Promise<{ action: string; invoiceNumber: string }> {
  const confirmedSession = await sessionService.getConfirmedSession(chatId, userId);

  if (!confirmedSession) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'invoice.missingDetails'),
      showAlert: true,
    });
    return { action: 'incomplete_session', invoiceNumber: '' };
  }

  await telegramService.answerCallbackQuery(callbackQueryId, {
    text: t('he', 'invoice.creating'),
  });

  const docType = confirmedSession.documentType as InvoiceDocumentType;
  const typeLabel = getDocumentTypeLabel(docType);
  const currencySymbol =
    confirmedSession.currency === 'USD' ? '$' : confirmedSession.currency === 'EUR' ? '€' : '₪';
  const summaryText = `⏳ מייצר ${typeLabel} עבור ${confirmedSession.customerName} - ${currencySymbol}${confirmedSession.amount?.toLocaleString('he-IL')}...`;

  await telegramService.editMessageText(chatId, messageId, summaryText);

  try {
    const result = await generateInvoice(confirmedSession, userId, username, chatId);
    await sessionService.deleteSession(chatId, userId);

    try {
      await telegramService.deleteMessage(chatId, messageId);
    } catch (err) {
      log.debug({ err }, 'Failed to delete generating message (may already be deleted)');
    }

    await telegramService.sendDocument(
      chatId,
      result.pdfBuffer,
      `${typeLabel}_${result.invoiceNumber}.pdf`,
      { caption: buildSuccessMessage(docType, result.invoiceNumber) }
    );

    log.info({ chatId, invoiceNumber: result.invoiceNumber }, 'Invoice generated and sent');
    return { action: 'invoice_generated', invoiceNumber: result.invoiceNumber };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ chatId, error: errorMessage }, 'Invoice generation failed');

    await sessionService.deleteSession(chatId, userId);
    await telegramService.editMessageText(chatId, messageId, t('he', 'invoice.error'));
    await telegramService.sendMessage(chatId, t('he', 'invoice.errorDetails'));

    // Re-throw so the controller returns HTTP 500
    throw error;
  }
}

export async function handleCancel(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string
): Promise<string> {
  await sessionService.deleteSession(chatId, userId);
  await telegramService.answerCallbackQuery(callbackQueryId);
  await telegramService.editMessageText(chatId, messageId, t('he', 'invoice.cancelled'));
  log.info({ chatId }, 'Invoice creation cancelled');
  return 'cancelled';
}

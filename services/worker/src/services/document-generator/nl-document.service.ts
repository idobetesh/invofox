/**
 * Natural-language document creation flow
 */

import { FieldValue } from '@google-cloud/firestore';
import type { InvoiceSession, PaymentMethod } from '../../../../../shared/types';
import type {
  DocumentIntentMissingField,
  NlDocumentEditField,
} from '../../../../../shared/document-intent.types';
import * as sessionService from './session.service';
import * as telegramService from '../telegram.service';
import {
  parseDocumentIntentFromAudio,
  parseDocumentIntentFromText,
  computeMissingFields,
  hasBlockingMissingFields,
  parseFieldEdit,
} from './document-intent';
import {
  buildReviewKeyboard,
  buildConfirmationKeyboard,
  buildPaymentMethodKeyboard,
} from './keyboards.service';
import { buildConfirmationMessage, buildReviewMessage } from './messages.service';
import { t } from '../i18n/languages';
import logger from '../../logger';

const log = logger.child({ service: 'nl-document' });

export const NL_DOCUMENT_CREATION_FLAG = 'nl-document-creation';

function todayDateStr(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function sessionToIntent(session: InvoiceSession) {
  return {
    documentType: session.documentType ?? null,
    customerName: session.customerName ?? null,
    amount: session.amount ?? null,
    description: session.description ?? null,
    paymentMethod: session.paymentMethod ?? null,
    currency: (session.currency as 'ILS' | 'USD' | 'EUR' | undefined) ?? 'ILS',
  };
}

function missingFieldMessage(field: DocumentIntentMissingField): string {
  const keyMap: Record<DocumentIntentMissingField, string> = {
    documentType: 'nl.missingDocumentType',
    customerName: 'nl.missingCustomerName',
    amount: 'nl.missingAmount',
    description: 'nl.missingDescription',
    paymentMethod: 'nl.missingPaymentMethod',
    relatedInvoiceNumber: 'nl.missingRelatedInvoice',
    currency: 'nl.missingCurrency',
    unsupported_type_v1: 'nl.unsupportedReceipt',
  };
  return t('he', keyMap[field]);
}

function editFieldPrompt(field: NlDocumentEditField): string {
  const keyMap: Record<NlDocumentEditField, string> = {
    customerName: 'nl.promptCustomerName',
    description: 'nl.promptDescription',
    amount: 'nl.promptAmount',
    documentType: 'nl.promptDocumentType',
    paymentMethod: 'nl.promptPaymentMethod',
  };
  return t('he', keyMap[field]);
}

export async function startNlSession(chatId: number, userId: number): Promise<void> {
  await sessionService.createNlSession(chatId, userId);
  await telegramService.sendMessage(chatId, t('he', 'nl.awaitingIntent'));
}

export async function handleIntentInput(
  chatId: number,
  userId: number,
  input: { text?: string; audioBuffer?: Buffer }
): Promise<string> {
  await telegramService.sendMessage(chatId, t('he', 'nl.parsing'));

  let parseResult;
  try {
    if (input.audioBuffer) {
      parseResult = await parseDocumentIntentFromAudio(input.audioBuffer);
    } else if (input.text?.trim()) {
      parseResult = await parseDocumentIntentFromText(input.text.trim());
    } else {
      await telegramService.sendMessage(chatId, t('he', 'nl.emptyInput'));
      return 'empty_input';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ chatId, error: message }, 'Document intent parse failed');
    await telegramService.sendMessage(chatId, t('he', 'nl.parseError'));
    return 'parse_error';
  }

  const { intent } = parseResult;

  if (intent.missingFields.includes('unsupported_type_v1')) {
    await sessionService.deleteSession(chatId, userId);
    await telegramService.sendMessage(chatId, t('he', 'nl.unsupportedReceipt'));
    return 'unsupported_receipt';
  }

  await sessionService.updateSession(chatId, userId, {
    status: 'reviewing',
    currency: intent.currency,
    sourceTranscript: intent.transcript || input.text || t('he', 'nl.voiceTranscript'),
    parseConfidence: intent.confidence,
    ...(intent.documentType ? { documentType: intent.documentType } : {}),
    ...(intent.customerName ? { customerName: intent.customerName } : {}),
    ...(intent.description ? { description: intent.description } : {}),
    ...(typeof intent.amount === 'number' ? { amount: intent.amount } : {}),
    ...(intent.customerTaxId ? { customerTaxId: intent.customerTaxId } : {}),
    ...(intent.paymentMethod ? { paymentMethod: intent.paymentMethod } : {}),
  });

  const session = await sessionService.getSession(chatId, userId);
  if (!session) {
    return 'session_lost';
  }

  return await routeAfterIntent(chatId, userId, session);
}

async function routeAfterIntent(
  chatId: number,
  userId: number,
  session: InvoiceSession
): Promise<string> {
  const missing = computeMissingFields(sessionToIntent(session));

  if (missing.includes('unsupported_type_v1')) {
    await sessionService.deleteSession(chatId, userId);
    await telegramService.sendMessage(chatId, t('he', 'nl.unsupportedReceipt'));
    return 'unsupported_receipt';
  }

  if (hasBlockingMissingFields(missing)) {
    const nextField = missing.find((f) => f !== 'unsupported_type_v1');
    if (nextField) {
      await promptForMissingField(chatId, userId, nextField, session);
      return 'awaiting_missing_field';
    }
  }

  await showReviewScreen(chatId, session);
  return 'reviewing';
}

export async function promptForMissingField(
  chatId: number,
  userId: number,
  field: DocumentIntentMissingField,
  session?: InvoiceSession
): Promise<void> {
  const current = session ?? (await sessionService.getSession(chatId, userId));
  if (!current) {
    return;
  }

  if (field === 'paymentMethod') {
    await sessionService.updateSession(chatId, userId, { status: 'reviewing' });
    await telegramService.sendMessage(chatId, missingFieldMessage(field), {
      replyMarkup: buildPaymentMethodKeyboard(),
    });
    return;
  }

  const editField = field as NlDocumentEditField;
  if (['customerName', 'description', 'amount', 'documentType'].includes(field)) {
    await sessionService.updateSession(chatId, userId, {
      status: 'editing_field',
      editingField: editField,
    });
    await telegramService.sendMessage(chatId, missingFieldMessage(field));
    await telegramService.sendMessage(chatId, editFieldPrompt(editField));
    return;
  }

  await telegramService.sendMessage(chatId, missingFieldMessage(field));
}

export async function showReviewScreen(chatId: number, session: InvoiceSession): Promise<void> {
  const reviewText = buildReviewMessage(session);
  await telegramService.sendMessage(chatId, reviewText, {
    replyMarkup: buildReviewKeyboard(session),
  });
}

export async function handleFieldEditInput(
  chatId: number,
  userId: number,
  text: string,
  session: InvoiceSession
): Promise<string> {
  const field = session.editingField;
  if (!field) {
    return 'no_editing_field';
  }

  const parsed = parseFieldEdit(field, text);
  if (!parsed.ok) {
    await telegramService.sendMessage(chatId, t('he', parsed.errorKey));
    await telegramService.sendMessage(chatId, editFieldPrompt(field));
    return 'invalid_field';
  }

  const updates: Partial<InvoiceSession> = {
    status: 'reviewing',
    editingField: FieldValue.delete() as unknown as InvoiceSession['editingField'],
  };

  switch (field) {
    case 'customerName':
      updates.customerName = parsed.value as string;
      break;
    case 'description':
      updates.description = parsed.value as string;
      break;
    case 'amount':
      updates.amount = parsed.value as number;
      break;
    case 'documentType':
      updates.documentType = parsed.value as InvoiceSession['documentType'];
      break;
    case 'paymentMethod':
      updates.paymentMethod = parsed.value as PaymentMethod;
      break;
  }

  const updated = await sessionService.updateSession(chatId, userId, updates);
  const missing = computeMissingFields(sessionToIntent(updated));

  if (hasBlockingMissingFields(missing)) {
    const nextField = missing.find((f) => f !== 'unsupported_type_v1');
    if (nextField) {
      await promptForMissingField(chatId, userId, nextField, updated);
      return 'awaiting_missing_field';
    }
  }

  await showReviewScreen(chatId, updated);
  return 'reviewing';
}

export async function handleEditFieldCallback(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string,
  field: NlDocumentEditField
): Promise<string> {
  await sessionService.updateSession(chatId, userId, {
    status: 'editing_field',
    editingField: field,
  });

  await telegramService.answerCallbackQuery(callbackQueryId);

  if (field === 'paymentMethod') {
    await telegramService.editMessageText(chatId, messageId, editFieldPrompt(field));
    await telegramService.sendMessage(chatId, t('he', 'invoice.selectPaymentMethod'), {
      replyMarkup: buildPaymentMethodKeyboard(),
    });
    return 'editing_payment';
  }

  await telegramService.editMessageText(chatId, messageId, editFieldPrompt(field));
  return 'editing_field';
}

export async function handleSelectPaymentDuringReview(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string,
  paymentMethod: PaymentMethod
): Promise<string> {
  const updated = await sessionService.updateSession(chatId, userId, {
    paymentMethod,
    status: 'reviewing',
    editingField: FieldValue.delete() as unknown as InvoiceSession['editingField'],
  });

  await telegramService.answerCallbackQuery(callbackQueryId, { text: paymentMethod });
  await telegramService.editMessageText(
    chatId,
    messageId,
    t('he', 'nl.paymentSelected', { payment: paymentMethod })
  );

  const missing = computeMissingFields(sessionToIntent(updated));
  if (hasBlockingMissingFields(missing)) {
    const nextField = missing.find((f) => f !== 'unsupported_type_v1');
    if (nextField) {
      await promptForMissingField(chatId, userId, nextField, updated);
      return 'awaiting_missing_field';
    }
  }

  await showReviewScreen(chatId, updated);
  return 'reviewing';
}

export async function handleProceedToConfirm(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string
): Promise<string> {
  const session = await sessionService.getSession(chatId, userId);
  if (!session) {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'invoice.sessionExpired'),
      showAlert: true,
    });
    return 'session_expired';
  }

  const missing = computeMissingFields(sessionToIntent(session));
  if (hasBlockingMissingFields(missing)) {
    const nextField = missing.find((f) => f !== 'unsupported_type_v1');
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'nl.incompleteFields'),
      showAlert: true,
    });
    if (nextField) {
      await promptForMissingField(chatId, userId, nextField, session);
    }
    return 'incomplete';
  }

  const dateStr = todayDateStr();
  const updated = await sessionService.updateSession(chatId, userId, {
    status: 'confirming',
    date: dateStr,
  });

  const { documentType, customerName, description, amount } = updated;
  if (!documentType || !customerName || !description || typeof amount !== 'number') {
    await telegramService.answerCallbackQuery(callbackQueryId, {
      text: t('he', 'nl.incompleteFields'),
      showAlert: true,
    });
    return 'incomplete';
  }

  const confirmText = buildConfirmationMessage({
    documentType,
    customerName,
    description,
    amount,
    paymentMethod: documentType === 'invoice' ? '' : updated.paymentMethod || '',
    date: dateStr,
  });

  await telegramService.answerCallbackQuery(callbackQueryId);
  await telegramService.editMessageText(chatId, messageId, confirmText);
  await telegramService.sendMessage(chatId, t('he', 'invoice.selectAction'), {
    replyMarkup: buildConfirmationKeyboard(),
  });

  return 'confirming';
}

export async function handleBackToReview(
  chatId: number,
  userId: number,
  messageId: number,
  callbackQueryId: string
): Promise<string> {
  const session = await sessionService.updateSession(chatId, userId, {
    status: 'reviewing',
    editingField: FieldValue.delete() as unknown as InvoiceSession['editingField'],
  });

  await telegramService.answerCallbackQuery(callbackQueryId);
  await telegramService.editMessageText(chatId, messageId, buildReviewMessage(session), {
    replyMarkup: buildReviewKeyboard(session),
  });

  return 'reviewing';
}

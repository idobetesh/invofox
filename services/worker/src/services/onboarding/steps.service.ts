/**
 * Onboarding Steps Service
 * Business logic for each onboarding step
 */

import type { TelegramMessage } from '../../../../../shared/types';
import type { Language } from '../i18n/languages';
import { t } from '../i18n/languages';
import { sendMessage, downloadFileById, getFileExtension } from '../telegram.service';
import { updateOnboardingData, updateOnboardingSession } from './onboarding.service';
import {
  uploadLogo,
  saveBusinessConfig,
  type BusinessConfigDocument,
} from '../business-config/config.service';
import { initializeCounter } from '../invoice-generator/counter.service';
import {
  validateBusinessName,
  validateOwnerDetails,
  parseOwnerDetails,
  validateAddress,
  validateSheetId,
  extractSheetId,
  validateCounter,
} from './validation.service';
import {
  getSheetStepMessage,
  getSheetErrorMessage,
  getTaxStatusSelectionMessage,
  getTaxStatusSelectionKeyboard,
  getCounterSelectionMessage,
  getCounterSelectionKeyboard,
  getCompletionMessage,
} from './messages.service';
import { verifySheetAccess } from './sheet-verification.service';
import { getConfig } from '../../config';
import logger from '../../logger';

/**
 * Handle business name step
 */
export async function handleBusinessNameStep(
  chatId: number,
  businessName: string,
  language: Language
): Promise<void> {
  if (!businessName) {
    await sendMessage(chatId, t(language, 'onboarding.step1Prompt'));
    return;
  }

  const validation = validateBusinessName(businessName, language);
  if (!validation.valid) {
    await sendMessage(chatId, t(language, 'onboarding.step1Prompt') + '\n\n❌ ' + validation.error);
    return;
  }

  await updateOnboardingData(chatId, { businessName });
  await updateOnboardingSession(chatId, { step: 'owner_details' });

  const message =
    t(language, 'onboarding.step1Confirm', { name: businessName }) +
    '\n\n' +
    t(language, 'onboarding.step2Title') +
    '\n' +
    t(language, 'onboarding.step2Prompt');

  await sendMessage(chatId, message);
}

/**
 * Handle owner details step
 */
export async function handleOwnerDetailsStep(
  chatId: number,
  text: string,
  language: Language
): Promise<void> {
  if (!text) {
    return;
  }

  const validation = validateOwnerDetails(text, language);
  if (!validation.valid) {
    await sendMessage(
      chatId,
      t(language, 'onboarding.step2Invalid') + '\n\n❌ ' + validation.error
    );
    return;
  }

  const details = parseOwnerDetails(text);
  if (!details) {
    await sendMessage(chatId, t(language, 'onboarding.step2Invalid'));
    return;
  }

  await updateOnboardingData(chatId, details);
  await updateOnboardingSession(chatId, { step: 'address' });

  const message =
    t(language, 'onboarding.step2Confirm', {
      name: details.ownerName,
      taxId: details.ownerIdNumber,
      phone: details.phone,
      email: details.email,
    }) +
    '\n\n' +
    t(language, 'onboarding.step3Title') +
    '\n' +
    t(language, 'onboarding.step3Prompt');

  await sendMessage(chatId, message);
}

/**
 * Handle address step
 */
export async function handleAddressStep(
  chatId: number,
  address: string,
  language: Language
): Promise<void> {
  if (!address) {
    await sendMessage(chatId, t(language, 'onboarding.step3Prompt'));
    return;
  }

  const validation = validateAddress(address, language);
  if (!validation.valid) {
    await sendMessage(chatId, t(language, 'onboarding.step3Prompt') + '\n\n❌ ' + validation.error);
    return;
  }

  await updateOnboardingData(chatId, { address });
  await updateOnboardingSession(chatId, { step: 'tax_status' });

  // First acknowledge the address
  await sendMessage(chatId, t(language, 'onboarding.step3Confirm', { address }));

  // Then send tax status selection with buttons
  await sendMessage(chatId, getTaxStatusSelectionMessage(language), {
    replyMarkup: getTaxStatusSelectionKeyboard(language),
  });
}

/**
 * Handle logo step (photo/document upload or skip)
 */
export async function handleLogoStep(
  msg: TelegramMessage,
  chatId: number,
  language: Language
): Promise<void> {
  // Check if user wants to skip
  if (msg.text?.trim() === '/skip') {
    await updateOnboardingSession(chatId, { step: 'sheet' });
    const message = await getSheetStepMessage(language);
    await sendMessage(chatId, t(language, 'onboarding.step5Skipped') + '\n\n' + message);
    return;
  }

  // Check if photo or document uploaded
  let fileId: string | undefined;

  if (msg.photo && msg.photo.length > 0) {
    // Photo upload (compressed by Telegram)
    const photo = msg.photo[msg.photo.length - 1];
    fileId = photo.file_id;
  } else if (msg.document) {
    // Document upload (original quality, check if image)
    const mimeType = msg.document.mime_type || '';
    const supportedImageTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ];

    if (
      supportedImageTypes.includes(mimeType) ||
      msg.document.file_name?.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)
    ) {
      fileId = msg.document.file_id;
    }
  }

  if (!fileId) {
    await sendMessage(chatId, t(language, 'onboarding.step5Invalid'));
    return;
  }

  try {
    const { buffer, filePath } = await downloadFileById(fileId);
    const extension = getFileExtension(filePath);

    // Upload logo to Cloud Storage (skip business_config update during onboarding)
    const config = getConfig();
    const filename = `logo.${extension}`;
    const logoUrl = await uploadLogo(buffer, filename, config.storageBucket, chatId, false);

    await updateOnboardingData(chatId, { logoUrl });
    await updateOnboardingSession(chatId, { step: 'sheet' });

    const message = await getSheetStepMessage(language);
    await sendMessage(chatId, t(language, 'onboarding.step5Confirm') + '\n\n' + message);
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to upload logo');
    await sendMessage(chatId, t(language, 'onboarding.step5Invalid'));
  }
}

/**
 * Handle Google Sheet step
 */
export async function handleSheetStep(
  chatId: number,
  text: string,
  language: Language
): Promise<void> {
  if (!text) {
    return;
  }

  // Check if user wants to skip
  if (text === '/skip') {
    await updateOnboardingSession(chatId, { step: 'counter' });
    await sendMessage(chatId, t(language, 'onboarding.step6Skipped'));
    await sendMessage(chatId, getCounterSelectionMessage(language), {
      replyMarkup: getCounterSelectionKeyboard(language),
    });
    return;
  }

  // Extract sheet ID from URL or validate direct ID
  const sheetId = extractSheetId(text);

  if (!sheetId) {
    await sendMessage(chatId, t(language, 'onboarding.step6Invalid'));
    return;
  }

  // Validate sheet ID format
  const validation = validateSheetId(sheetId);
  if (!validation.valid) {
    await sendMessage(chatId, t(language, 'onboarding.step6Invalid'));
    return;
  }

  // Test sheet access
  try {
    const tabs = await verifySheetAccess(sheetId);

    await updateOnboardingData(chatId, { sheetId });
    await updateOnboardingSession(chatId, { step: 'counter' });

    await sendMessage(chatId, t(language, 'onboarding.step6Confirm', { tabs: tabs.join(', ') }));
    await sendMessage(chatId, getCounterSelectionMessage(language), {
      replyMarkup: getCounterSelectionKeyboard(language),
    });
  } catch (error) {
    logger.error({ error, chatId, sheetId }, 'Failed to access sheet');
    const errorMessage = await getSheetErrorMessage(language);
    await sendMessage(chatId, errorMessage);
  }
}

/**
 * Handle counter step
 */
export async function handleCounterStep(
  chatId: number,
  text: string,
  language: Language,
  sessionData: Record<string, unknown>
): Promise<void> {
  if (!text) {
    return;
  }

  let startingCounter = 0;

  // Check if user wants to skip
  if (text === '/skip') {
    startingCounter = 0; // Will start from 1
  } else {
    // Parse and validate number
    const validation = validateCounter(text);
    if (!validation.valid) {
      await sendMessage(
        chatId,
        t(language, 'onboarding.step7Invalid') + '\n\n❌ ' + validation.error
      );
      return;
    }
    startingCounter = parseInt(text, 10);
  }

  await updateOnboardingData(chatId, { startingCounter });

  // Now finalize onboarding
  await finalizeOnboarding(chatId, language, { ...sessionData, startingCounter });
}

/**
 * Handle tax status selection
 */
export async function handleTaxStatusSelection(
  chatId: number,
  taxStatus: string,
  language: Language
): Promise<void> {
  await updateOnboardingData(chatId, { taxStatus });
  await updateOnboardingSession(chatId, { step: 'logo' });

  const message =
    t(language, 'onboarding.step4Confirm', { status: taxStatus }) +
    '\n\n' +
    t(language, 'onboarding.step5Title') +
    '\n' +
    t(language, 'onboarding.step5Prompt');

  await sendMessage(chatId, message);
}

/**
 * Handle counter selection (button press)
 */
export async function handleCounterSelection(
  chatId: number,
  startFromOne: boolean,
  language: Language,
  sessionData: Record<string, unknown>
): Promise<void> {
  if (startFromOne) {
    // Start from 1 - finalize immediately
    await updateOnboardingData(chatId, { startingCounter: 0 });
    await finalizeOnboarding(chatId, language, { ...sessionData, startingCounter: 0 });
  } else {
    // User has existing invoices - ask for the number
    await sendMessage(
      chatId,
      t(language, 'onboarding.step7Title') + '\n' + 'Please send the starting invoice number:'
    );
    // Stay in counter step to receive the number
  }
}

/**
 * Finalize onboarding: create business config and complete session
 */
async function finalizeOnboarding(
  chatId: number,
  language: Language,
  data: {
    businessName: string;
    ownerName: string;
    ownerIdNumber: string;
    phone: string;
    email: string;
    address: string;
    taxStatus: string;
    logoUrl?: string;
    sheetId?: string;
    startingCounter?: number;
  }
): Promise<void> {
  // Validate all required fields
  if (
    !data.businessName ||
    !data.ownerName ||
    !data.ownerIdNumber ||
    !data.phone ||
    !data.email ||
    !data.address ||
    !data.taxStatus
  ) {
    throw new Error('Missing required onboarding data');
  }

  // Create business config document
  const config: BusinessConfigDocument = {
    language,
    business: {
      name: data.businessName,
      taxId: data.ownerIdNumber,
      taxStatus: data.taxStatus,
      email: data.email,
      phone: data.phone,
      address: data.address,
      logoUrl: data.logoUrl,
      sheetId: data.sheetId,
    },
    invoice: {
      digitalSignatureText: t(language, 'validation.digitalSignature'),
      generatedByText: t(language, 'validation.generatedBy'),
    },
  };

  // Save business config
  await saveBusinessConfig(config, chatId);
  logger.info({ chatId }, 'Business config created');

  // Initialize counter if specified
  if (data.startingCounter && data.startingCounter > 0) {
    await initializeCounter(chatId, data.startingCounter);
    logger.info({ chatId, startingCounter: data.startingCounter }, 'Invoice counter initialized');
  }

  // Complete onboarding session (imported from onboarding.service)
  const { completeOnboarding } = await import('./onboarding.service');
  await completeOnboarding(chatId);

  // Send completion message
  const message = getCompletionMessage(language, {
    businessName: data.businessName,
    ownerName: data.ownerName,
    taxId: data.ownerIdNumber,
    address: data.address,
    phone: data.phone,
    email: data.email,
    logo: !!data.logoUrl,
    sheet: !!data.sheetId,
    counter: data.startingCounter || 0,
  });

  await sendMessage(chatId, message);
  logger.info({ chatId }, 'Onboarding completed successfully');
}

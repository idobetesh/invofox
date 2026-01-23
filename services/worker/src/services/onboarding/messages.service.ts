/**
 * Onboarding Messages Service
 * Handles message formatting and keyboard generation
 */

import type { TelegramInlineKeyboardMarkup } from '../../../../../shared/types';
import { t, type Language } from '../i18n/languages';
import { getServiceAccountEmail } from '../../utils/service-account';

// Cache for service account email
const SERVICE_ACCOUNT_CACHE: { email: string | null } = { email: null };

/**
 * Get language selection keyboard
 */
export function getLanguageSelectionKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'English 🇺🇸', callback_data: 'onboard_lang_en' },
        { text: 'עברית 🇮🇱', callback_data: 'onboard_lang_he' },
      ],
    ],
  };
}

/**
 * Get language selection message
 */
export function getLanguageSelectionMessage(): string {
  return '🚀 Welcome to PaperTrail! / ברוכים הבאים ל-PaperTrail!\n\nPlease select your language / אנא בחרו שפה:';
}

/**
 * Get tax status selection keyboard
 */
export function getTaxStatusSelectionKeyboard(language: Language): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: t(language, 'taxStatus.exempt'), callback_data: 'onboard_tax_exempt' },
        { text: t(language, 'taxStatus.licensed'), callback_data: 'onboard_tax_licensed' },
      ],
    ],
  };
}

/**
 * Get tax status selection message
 */
export function getTaxStatusSelectionMessage(language: Language): string {
  return t(language, 'onboarding.step4Title') + '\n' + t(language, 'onboarding.step4Prompt');
}

/**
 * Get counter selection keyboard
 */
export function getCounterSelectionKeyboard(language: Language): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: t(language, 'counter.startFromOne'), callback_data: 'onboard_counter_1' }],
      [{ text: t(language, 'counter.haveExisting'), callback_data: 'onboard_counter_custom' }],
    ],
  };
}

/**
 * Get counter selection message
 */
export function getCounterSelectionMessage(language: Language): string {
  return t(language, 'onboarding.step7Title') + '\n' + t(language, 'onboarding.step7Prompt');
}

/**
 * Get sheet step message with service account email
 */
export async function getSheetStepMessage(language: Language): Promise<string> {
  // Get or cache service account email
  if (!SERVICE_ACCOUNT_CACHE.email) {
    SERVICE_ACCOUNT_CACHE.email = await getServiceAccountEmail();
  }

  return (
    t(language, 'onboarding.step6Title') +
    '\n' +
    t(language, 'onboarding.step6Prompt', { serviceAccount: SERVICE_ACCOUNT_CACHE.email })
  );
}

/**
 * Get sheet error message with service account email
 */
export async function getSheetErrorMessage(language: Language): Promise<string> {
  if (!SERVICE_ACCOUNT_CACHE.email) {
    SERVICE_ACCOUNT_CACHE.email = await getServiceAccountEmail();
  }

  return t(language, 'onboarding.step6Error', { serviceAccount: SERVICE_ACCOUNT_CACHE.email });
}

/**
 * Format completion message
 */
export function getCompletionMessage(
  language: Language,
  data: {
    businessName: string;
    ownerName: string;
    taxId: string;
    address: string;
    phone: string;
    email: string;
    logo: boolean;
    sheet: boolean;
    counter: number;
  }
): string {
  return t(language, 'onboarding.complete', {
    businessName: data.businessName,
    ownerName: data.ownerName,
    taxId: data.taxId,
    address: data.address,
    phone: data.phone,
    email: data.email,
    logo: data.logo ? '✅' : '⏭️',
    sheet: data.sheet ? '✅' : '⏭️',
    counter: data.counter > 0 ? data.counter.toString() : '1',
  });
}

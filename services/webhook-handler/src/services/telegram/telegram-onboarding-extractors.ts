/**
 * Telegram Onboarding Extractors
 * Extract payloads and identify onboarding flow interactions
 */

/**
 * Check if callback is for onboarding flow
 */
export function isOnboardingCallback(data: string): boolean {
  return data.startsWith('onboard_');
}

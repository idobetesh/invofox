/**
 * Centralized UI messages for consistency across the application
 * All user-facing Hebrew strings are defined here
 */

export const MESSAGES = {
  // Success messages
  INVOICE_PROCESSED_SUCCESSFULLY: 'החשבונית נקלטה בהצלחה',

  // Duplicate detection
  DUPLICATE_EXACT: 'כפילות מלאה',
  DUPLICATE_SIMILAR: 'חשבונית דומה',
  DUPLICATE_DETECTED: 'רגע! נראה שהחשבונית הזו כבר קיימת במערכת',
  DUPLICATE_PENDING_ACTION: 'מה ברצונך לעשות?',

  // Vendor fallback
  VENDOR_UNKNOWN: 'לא ידוע',

  // Link labels
  LINK_EXISTING: 'קיים',
  LINK_NEW: 'חדש',
  LINK_EXISTING_LABEL: 'לחץ לצפייה בחשבונית הקיימת',

  // Button labels
  BUTTON_KEEP_BOTH: '✅ לשמור את שתיהן',
  BUTTON_DELETE_NEW: '🗑️ למחוק את החדשה',

  // Loading messages (callback responses)
  LOADING_KEEPING_BOTH: 'שומר שניים...',
  LOADING_DELETING: 'מוחק...',

  // Resolution messages
  RESOLUTION_BOTH_KEPT: 'שתי החשבוניות נשמרו',
  RESOLUTION_DUPLICATE_DELETED: 'הכפילות נמחקה',
  RESOLUTION_KEPT: 'נשמר',
} as const;

/**
 * Helper to format duplicate match type label
 */
export function getDuplicateLabel(matchType: 'exact' | 'similar'): string {
  return matchType === 'exact' ? MESSAGES.DUPLICATE_EXACT : MESSAGES.DUPLICATE_SIMILAR;
}

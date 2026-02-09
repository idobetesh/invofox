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
  DUPLICATE_DETECTED: 'זוהתה!',
  DUPLICATE_PENDING_ACTION: 'העלאה חדשה ממתינה - בחר פעולה:',

  // Vendor fallback
  VENDOR_UNKNOWN: 'לא ידוע',

  // Link labels
  LINK_EXISTING: 'קיים',
  LINK_NEW: 'חדש',

  // Button labels
  BUTTON_KEEP_BOTH: '✅ שמור שניים',
  BUTTON_DELETE_NEW: '🗑️ מחק חדש',

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

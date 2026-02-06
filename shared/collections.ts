/**
 * Firestore collection names
 * Centralized constants to avoid hardcoding collection names across services
 */

// Document collections (after collection split)
export const GENERATED_INVOICES_COLLECTION = 'generated_invoices';
export const GENERATED_RECEIPTS_COLLECTION = 'generated_receipts';
export const GENERATED_INVOICE_RECEIPTS_COLLECTION = 'generated_invoice_receipts';

// Counter collections
export const INVOICE_COUNTERS_COLLECTION = 'invoice_counters';

// Configuration collections
export const BUSINESS_CONFIG_COLLECTION = 'business_config';
export const ONBOARDING_SESSIONS_COLLECTION = 'onboarding_sessions';

// User management collections
export const USER_CUSTOMER_MAPPING_COLLECTION = 'user_customer_mapping';
export const APPROVED_CHATS_COLLECTION = 'approved_chats';

// Job tracking collections
export const INVOICE_JOBS_COLLECTION = 'invoice_jobs';
export const PROCESSING_JOBS_COLLECTION = 'processing_jobs';

// Session collections
export const INVOICE_SESSIONS_COLLECTION = 'invoice_sessions';
export const REPORT_SESSIONS_COLLECTION = 'report_sessions';

// Rate limiting collections
export const RATE_LIMITS_COLLECTION = 'rate_limits';

// Invite and callback collections
export const INVITE_CODES_COLLECTION = 'invite_codes';
export const PROCESSED_CALLBACKS_COLLECTION = 'processed_callbacks';

/**
 * Document type for counter tracking
 */
export type DocumentType = 'invoice' | 'receipt' | 'invoice_receipt';

/**
 * Document number prefix mapping
 */
const DOCUMENT_PREFIXES: Record<DocumentType, string> = {
  invoice: 'I',
  receipt: 'R',
  invoice_receipt: 'IR',
};

/**
 * Format document number based on type
 * Format: {PREFIX}-{year}-{counter} (e.g., "I-2026-1", "R-2026-5", "IR-2026-3")
 */
export function formatDocumentNumber(
  documentType: DocumentType,
  year: number | string,
  counter: number
): string {
  const prefix = DOCUMENT_PREFIXES[documentType];
  if (!prefix) {
    throw new Error(`Unknown document type: ${documentType}`);
  }
  return `${prefix}-${year}-${counter}`;
}

/**
 * Helper to get collection name based on document type
 */
export function getCollectionForDocumentType(documentType: DocumentType): string {
  switch (documentType) {
    case 'invoice':
      return GENERATED_INVOICES_COLLECTION;
    case 'receipt':
      return GENERATED_RECEIPTS_COLLECTION;
    case 'invoice_receipt':
      return GENERATED_INVOICE_RECEIPTS_COLLECTION;
    default:
      throw new Error(`Unknown document type: ${documentType}`);
  }
}

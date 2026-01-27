/**
 * Firestore Models
 * Type-safe schemas and converters for all Firestore collections
 *
 * CRITICAL: These models prevent bugs caused by different field names in different collections
 *
 * Example: invoice_jobs uses 'telegramChatId' but generated_invoices uses 'chatId'
 * Without models, this difference is invisible until runtime errors occur.
 */

export * from './generated-invoice.model';
export * from './invoice-job.model';
export * from './report-session.model';
export * from './rate-limit.model';
export * from './business-config.model';
export * from './user-mapping.model';

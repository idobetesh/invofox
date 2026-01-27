/**
 * Invoice Job Model
 * Schema for 'invoice_jobs' collection (processed invoices for expenses reports)
 *
 * CRITICAL DIFFERENCES from generated_invoices:
 * - Uses 'telegramChatId' NOT 'chatId'
 * - Uses 'vendorName' NOT 'customerName'
 * - Uses 'totalAmount' NOT 'amount'
 * - Date format: "2026-01-18" NOT "18/01/2026"
 */

import { z } from 'zod';
import type { Firestore, Timestamp } from '@google-cloud/firestore';

/**
 * Zod schema for invoice_jobs collection (expenses)
 * Validates structure at runtime and provides type inference
 */
export const InvoiceJobSchema = z.object({
  // Identifiers - NOTE: Uses 'telegramChatId' not 'chatId'!
  telegramChatId: z.number(), // ⚠️ DIFFERENT from generated_invoices (which uses chatId)!
  telegramMessageId: z.number(),
  telegramFileId: z.string(),

  // Status
  status: z.enum([
    'pending',
    'processing',
    'processed',
    'failed',
    'pending_retry',
    'pending_decision',
  ]),
  lastStep: z.enum(['download', 'drive', 'llm', 'sheets', 'ack']).optional(),
  attempts: z.number().default(0),

  // Extracted data
  vendorName: z.string().optional(), // ⚠️ DIFFERENT from generated_invoices (which uses customerName)!
  totalAmount: z.number().optional(), // ⚠️ DIFFERENT from generated_invoices (which uses amount)!
  vatAmount: z.number().optional(),
  currency: z.string().default('ILS'),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().optional(), // ⚠️ Format is "2026-01-18" NOT "18/01/2026"!
  category: z.string().optional(),
  confidence: z.number().optional(),

  // Storage
  driveFileId: z.string().optional(),
  driveLink: z.string().optional(),
  sheetRowId: z.number().optional(),

  // Metadata
  chatTitle: z.string().optional(),
  uploaderUsername: z.string().optional(),
  uploaderFirstName: z.string().optional(),
  receivedAt: z.string(), // ISO timestamp
  createdAt: z.custom<Timestamp>(),
  updatedAt: z.custom<Timestamp>(),
});

export type InvoiceJob = z.infer<typeof InvoiceJobSchema>;

/**
 * Firestore converter for type-safe reads/writes
 */
export const invoiceJobConverter = {
  toFirestore: (data: InvoiceJob) => data,
  fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot): InvoiceJob => {
    const data = snapshot.data();
    return InvoiceJobSchema.parse(data);
  },
};

/**
 * Collection reference with type safety
 * @example
 * const collection = getInvoiceJobsCollection(db);
 * const snapshot = await collection
 *   .where('telegramChatId', '==', chatId)  // Autocomplete works!
 *   .where('status', '==', 'processed')
 *   .get();
 */
export function getInvoiceJobsCollection(db: Firestore) {
  return db.collection('invoice_jobs').withConverter(invoiceJobConverter);
}

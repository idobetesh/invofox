/**
 * Generated Invoice Model
 * Schema for 'generated_invoices' collection (user-generated invoices for revenue reports)
 *
 * CRITICAL DIFFERENCES from invoice_jobs:
 * - Uses 'chatId' NOT 'telegramChatId'
 * - Uses 'customerName' NOT 'vendorName'
 * - Uses 'amount' NOT 'totalAmount'
 * - Date format: "18/01/2026" NOT "2026-01-18"
 */

import { z } from 'zod';
import type { Firestore, Timestamp } from '@google-cloud/firestore';

/**
 * Zod schema for generated_invoices collection (revenue)
 * Validates structure at runtime and provides type inference
 */
export const GeneratedInvoiceSchema = z.object({
  // Identifiers - NOTE: Uses 'chatId' not 'telegramChatId'!
  chatId: z.number(), // ⚠️ DIFFERENT from invoice_jobs (which uses telegramChatId)!
  invoiceNumber: z.string(),

  // Customer data
  customerName: z.string(), // ⚠️ DIFFERENT from invoice_jobs (which uses vendorName)!

  // Invoice data
  amount: z.number(), // ⚠️ DIFFERENT from invoice_jobs (which uses totalAmount)!
  currency: z.string().default('ILS'),
  date: z.string(), // ⚠️ Format is "18/01/2026" NOT "2026-01-18"!
  description: z.string().optional(),
  documentType: z.enum(['invoice', 'invoice_receipt', 'receipt']),
  paymentMethod: z.string(),

  // Storage
  storagePath: z.string(),
  storageUrl: z.string(),

  // Generation metadata
  generatedAt: z.custom<Timestamp>(),
  generatedBy: z.object({
    chatId: z.number(),
    telegramUserId: z.number(),
    username: z.string(),
  }),
});

export type GeneratedInvoice = z.infer<typeof GeneratedInvoiceSchema>;

/**
 * Firestore converter for type-safe reads/writes
 */
export const generatedInvoiceConverter = {
  toFirestore: (data: GeneratedInvoice) => data,
  fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot): GeneratedInvoice => {
    const data = snapshot.data();
    return GeneratedInvoiceSchema.parse(data);
  },
};

/**
 * Collection reference with type safety
 * @example
 * const collection = getGeneratedInvoicesCollection(db);
 * const snapshot = await collection
 *   .where('chatId', '==', chatId)  // Autocomplete works!
 *   .get();
 */
export function getGeneratedInvoicesCollection(db: Firestore) {
  return db.collection('generated_invoices').withConverter(generatedInvoiceConverter);
}

/**
 * Convert date from "DD/MM/YYYY" format to "YYYY-MM-DD"
 */
export function parseGeneratedInvoiceDate(dateStr: string): string {
  if (!dateStr.includes('/')) {
    return dateStr; // Already in YYYY-MM-DD format
  }

  const [day, month, year] = dateStr.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

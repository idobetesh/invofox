/**
 * Business Config Model
 * Schema for 'business_configs' collection (customer configuration and settings)
 */

import { z } from 'zod';
import type { Firestore, Timestamp } from '@google-cloud/firestore';

/**
 * Zod schema for business_configs collection
 */
export const BusinessConfigSchema = z.object({
  // Settings
  language: z.enum(['en', 'he']).optional().default('he'),

  // Business details
  business: z.object({
    name: z.string(),
    taxId: z.string(),
    taxStatus: z.string(),
    email: z.string().email(),
    phone: z.string(),
    address: z.string(),
    logoUrl: z.string().optional(),
    sheetId: z.string().optional(), // Per-customer Google Sheet ID
  }),

  // Invoice settings
  invoice: z.object({
    digitalSignatureText: z.string(),
    generatedByText: z.string(),
  }),

  // Timestamps (optional for backward compatibility)
  createdAt: z.custom<Timestamp>().optional(),
  updatedAt: z.custom<Timestamp>().optional(),
});

export type BusinessConfig = z.infer<typeof BusinessConfigSchema>;

/**
 * Firestore converter for type-safe reads/writes
 */
export const businessConfigConverter = {
  toFirestore: (data: BusinessConfig) => data,
  fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot): BusinessConfig => {
    const data = snapshot.data();
    return BusinessConfigSchema.parse(data);
  },
};

/**
 * Collection reference with type safety
 */
export function getBusinessConfigsCollection(db: Firestore) {
  return db.collection('business_configs').withConverter(businessConfigConverter);
}

/**
 * Get document ID for business config
 * Document ID = chat ID
 */
export function getBusinessConfigDocId(chatId: number): string {
  return chatId.toString();
}

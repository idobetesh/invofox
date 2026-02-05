/**
 * Document Generation Helpers
 * Shared utilities for invoice, receipt, and invoice-receipt services
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

const STORAGE_BUCKET =
  process.env.GENERATED_INVOICES_BUCKET || 'papertrail-invoice-generated-invoices';

/**
 * Business configuration interface
 */
export interface BusinessConfig {
  name: string;
  taxId: string;
  taxStatus: string;
  email: string;
  address: string;
  phone: string;
  logoUrl?: string;
}

/**
 * Get business configuration from Firestore
 */
export async function getBusinessConfig(
  firestore: Firestore,
  chatId: number
): Promise<BusinessConfig> {
  const docId = `chat_${chatId}`;
  const doc = await firestore.collection('business_config').doc(docId).get();

  if (!doc.exists) {
    throw new Error(`Business config not found for chatId: ${chatId}`);
  }

  const data = doc.data()!;
  const business = data.business || {};

  return {
    name: business.name || 'Unknown Business',
    taxId: business.taxId || 'N/A',
    taxStatus: business.taxStatus || 'עוסק פטור מס',
    email: business.email || '',
    address: business.address || '',
    phone: business.phone || '',
    logoUrl: business.logoUrl,
  };
}

/**
 * Upload PDF to Cloud Storage and return public URL
 */
export async function uploadPDFToStorage(
  storage: Storage,
  pdfBuffer: Buffer,
  storagePath: string,
  metadata: {
    chatId: number;
    documentNumber: string;
    documentType: 'invoice' | 'receipt' | 'invoice_receipt';
    relatedDocumentNumber?: string;
  }
): Promise<string> {
  console.log('Uploading PDF to storage:', storagePath);

  const bucket = storage.bucket(STORAGE_BUCKET);
  const file = bucket.file(storagePath);

  await file.save(pdfBuffer, {
    metadata: {
      contentType: 'application/pdf',
      metadata: {
        chatId: metadata.chatId.toString(),
        documentNumber: metadata.documentNumber,
        documentType: metadata.documentType,
        ...(metadata.relatedDocumentNumber && {
          relatedDocumentNumber: metadata.relatedDocumentNumber,
        }),
        generatedBy: 'admin-panel',
      },
    },
  });

  // Generate public URL (bucket is configured for public read)
  const pdfUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${storagePath}`;

  console.log('PDF uploaded successfully:', pdfUrl);
  return pdfUrl;
}

/**
 * Format date from YYYY-MM-DD to DD/MM/YYYY
 */
export function formatDateDisplay(date: string): string {
  const parts = date.split('-');
  if (parts.length !== 3) {
    return date;
  }
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

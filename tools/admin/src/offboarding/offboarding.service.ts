/**
 * Offboarding Service - Comprehensive GDPR-Compliant Data Deletion
 * Single source of truth for all customer/user data deletion
 *
 * Supports two modes:
 * 1. Business offboarding (delete business, keep users with other businesses)
 * 2. User offboarding (complete user deletion - GDPR Right to Erasure)
 */

import { Firestore, FieldPath } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { execSync } from 'child_process';
import {
  BUSINESS_CONFIG_COLLECTION,
  INVOICE_COUNTERS_COLLECTION,
  INVOICE_JOBS_COLLECTION,
  PROCESSING_JOBS_COLLECTION,
  GENERATED_INVOICES_COLLECTION,
  GENERATED_RECEIPTS_COLLECTION,
  GENERATED_INVOICE_RECEIPTS_COLLECTION,
  INVOICE_SESSIONS_COLLECTION,
  ONBOARDING_SESSIONS_COLLECTION,
  REPORT_SESSIONS_COLLECTION,
  USER_CUSTOMER_MAPPING_COLLECTION,
  APPROVED_CHATS_COLLECTION,
  RATE_LIMITS_COLLECTION,
  PROCESSED_CALLBACKS_COLLECTION,
} from '../../../../shared/collections';

export interface OffboardingReport {
  mode: 'business' | 'user';
  identifier: string;
  firestoreDocs: number;
  firestoreUpdates: number;
  storageFiles: number;
  details: {
    collections: Record<string, number>;
    buckets: Record<string, number>;
  };
  errors: string[];
}

export interface OffboardingPreview {
  mode: 'business' | 'user';
  identifier: string;
  name: string;
  collections: Record<string, { count: number; docIds: string[] }>;
  storage: Record<string, { count: number; paths: string[] }>;
  totalItems: number;
  associatedUsers: string[]; // For business mode (always initialized)
  associatedBusinesses: string[]; // For user mode (always initialized)
}

export class OffboardingService {
  private readonly BUSINESS_COLLECTIONS = [
    BUSINESS_CONFIG_COLLECTION,
    INVOICE_COUNTERS_COLLECTION,
    INVOICE_JOBS_COLLECTION,
    PROCESSING_JOBS_COLLECTION,
    'Invoices', // Legacy collection (pre-split)
    GENERATED_INVOICES_COLLECTION,
    GENERATED_RECEIPTS_COLLECTION, // Split collection for receipts
    GENERATED_INVOICE_RECEIPTS_COLLECTION, // Split collection for invoice-receipts
    INVOICE_SESSIONS_COLLECTION,
    ONBOARDING_SESSIONS_COLLECTION,
    REPORT_SESSIONS_COLLECTION, // Report generation sessions
    RATE_LIMITS_COLLECTION, // Rate limiting data
    APPROVED_CHATS_COLLECTION, // Chat approval data
    PROCESSED_CALLBACKS_COLLECTION, // Callback deduplication
  ];

  private readonly USER_COLLECTIONS = [
    USER_CUSTOMER_MAPPING_COLLECTION,
    INVOICE_SESSIONS_COLLECTION,
    ONBOARDING_SESSIONS_COLLECTION,
    REPORT_SESSIONS_COLLECTION, // User report sessions
  ];

  constructor(
    private firestore: Firestore,
    private storage: Storage,
    private invoicesBucket: string,
    private generatedInvoicesBucket: string
  ) {}

  /**
   * Preview what will be deleted for a business
   */
  async previewBusinessOffboarding(chatId: number): Promise<OffboardingPreview> {
    const preview: OffboardingPreview = {
      mode: 'business',
      identifier: chatId.toString(),
      name: 'Unknown',
      collections: {},
      storage: {},
      totalItems: 0,
      associatedUsers: [],
      associatedBusinesses: [],
    };

    // Get business name
    try {
      const configDoc = await this.firestore
        .collection(BUSINESS_CONFIG_COLLECTION)
        .doc(`chat_${chatId}`)
        .get();
      if (configDoc.exists) {
        preview.name = configDoc.data()?.business?.name || 'Unknown';
      }
    } catch (error) {
      // Name is optional
    }

    // Find associated users
    try {
      const userMappingSnapshot = await this.firestore
        .collection(USER_CUSTOMER_MAPPING_COLLECTION)
        .get();
      for (const doc of userMappingSnapshot.docs) {
        const data = doc.data();
        const customers = data.customers || [];
        if (customers.some((c: { chatId: number }) => c.chatId === chatId)) {
          preview.associatedUsers.push(`${data.userId} (${data.username})`);
        }
      }
    } catch (error) {
      // Continue without user list
    }

    // Scan Firestore collections
    await Promise.all([
      this.scanBusinessConfig(chatId, preview),
      this.scanInvoiceCounters(chatId, preview),
      this.scanInvoiceJobs(chatId, preview),
      this.scanInvoices(chatId, preview),
      this.scanGeneratedInvoices(chatId, preview),
      this.scanGeneratedReceipts(chatId, preview),
      this.scanGeneratedInvoiceReceipts(chatId, preview),
      this.scanInvoiceSessions(chatId, preview),
      this.scanOnboardingSession(chatId, preview),
      this.scanReportSessions(chatId, preview),
      this.scanRateLimits(chatId, preview),
      this.scanApprovedChats(chatId, preview),
      this.scanProcessedCallbacks(chatId, preview),
      this.scanUserMappings(chatId, preview),
    ]);

    // Scan Cloud Storage
    await Promise.all([
      this.scanLogos(chatId, preview),
      this.scanGeneratedPDFs(chatId, preview),
      this.scanReceivedInvoices(chatId, preview),
    ]);

    // Calculate total
    preview.totalItems = Object.values(preview.collections).reduce(
      (sum, item) => sum + item.count,
      0
    );
    preview.totalItems += Object.values(preview.storage).reduce((sum, item) => sum + item.count, 0);

    return preview;
  }

  /**
   * Preview what will be deleted for a user
   */
  async previewUserOffboarding(userId: number): Promise<OffboardingPreview> {
    const preview: OffboardingPreview = {
      mode: 'user',
      identifier: userId.toString(),
      name: 'Unknown',
      collections: {},
      storage: {},
      totalItems: 0,
      associatedUsers: [],
      associatedBusinesses: [],
    };

    // Get user info and associated businesses
    try {
      const userDoc = await this.firestore
        .collection(USER_CUSTOMER_MAPPING_COLLECTION)
        .doc(`user_${userId}`)
        .get();
      if (userDoc.exists) {
        const data = userDoc.data();
        preview.name = data?.username || 'Unknown';
        const customers = data?.customers || [];
        preview.associatedBusinesses = customers.map(
          (c: { chatId: number; chatTitle: string }) => `${c.chatId} (${c.chatTitle})`
        );
      }
    } catch (error) {
      // Continue without user info
    }

    // Scan collections
    await Promise.all([
      this.scanUserMapping(userId, preview),
      this.scanUserInvoiceSessions(userId, preview),
      this.scanUserOnboardingSessions(userId, preview),
      this.scanUserReportSessions(userId, preview),
      this.scanUserInvoiceJobs(userId, preview),
    ]);

    // Calculate total
    preview.totalItems = Object.values(preview.collections).reduce(
      (sum, item) => sum + item.count,
      0
    );

    return preview;
  }

  /**
   * Execute business offboarding
   */
  async offboardBusiness(chatId: number): Promise<OffboardingReport> {
    const report: OffboardingReport = {
      mode: 'business',
      identifier: chatId.toString(),
      firestoreDocs: 0,
      firestoreUpdates: 0,
      storageFiles: 0,
      details: { collections: {}, buckets: {} },
      errors: [],
    };

    // Delete Firestore documents
    await this.deleteBusinessConfig(chatId, report);
    await this.deleteInvoiceCounters(chatId, report);
    await this.deleteInvoiceJobs(chatId, report);
    await this.deleteInvoices(chatId, report);
    await this.deleteGeneratedInvoices(chatId, report);
    await this.deleteGeneratedReceipts(chatId, report); // NEW: Split collection
    await this.deleteGeneratedInvoiceReceipts(chatId, report); // NEW: Split collection
    await this.deleteInvoiceSessions(chatId, report);
    await this.deleteOnboardingSession(chatId, report);
    await this.deleteReportSessions(chatId, report); // NEW: Report sessions
    await this.deleteRateLimits(chatId, report); // NEW: Rate limit data
    await this.deleteApprovedChats(chatId, report); // NEW: Approved chats
    await this.deleteProcessedCallbacks(chatId, report); // NEW: Callback dedup
    await this.updateUserMappings(chatId, report);

    // Delete Cloud Storage files
    await this.deleteLogos(chatId, report);
    await this.deleteGeneratedPDFs(chatId, report);
    await this.deleteReceivedInvoices(chatId, report);

    return report;
  }

  /**
   * Execute user offboarding (GDPR)
   */
  async offboardUser(userId: number): Promise<OffboardingReport> {
    const report: OffboardingReport = {
      mode: 'user',
      identifier: userId.toString(),
      firestoreDocs: 0,
      firestoreUpdates: 0,
      storageFiles: 0,
      details: { collections: {}, buckets: {} },
      errors: [],
    };

    // Delete user data
    await this.deleteUserMapping(userId, report);
    await this.deleteUserInvoiceSessions(userId, report);
    await this.deleteUserOnboardingSessions(userId, report);
    await this.deleteUserReportSessions(userId, report);
    await this.anonymizeGeneratedInvoices(userId, report);
    await this.anonymizeInvoiceJobs(userId, report);

    return report;
  }

  // ============================================================================
  // SCAN METHODS (for preview)
  // ============================================================================

  private async scanBusinessConfig(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const doc = await this.firestore
        .collection(BUSINESS_CONFIG_COLLECTION)
        .doc(`chat_${chatId}`)
        .get();
      if (doc.exists) {
        preview.collections[BUSINESS_CONFIG_COLLECTION] = { count: 1, docIds: [doc.id] };
      }
    } catch (error) {
      // Collection doesn't exist or no access
    }
  }

  private async scanInvoiceCounters(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(INVOICE_COUNTERS_COLLECTION).get();
      const docs = snapshot.docs.filter(
        (doc) => doc.id.startsWith(`chat_${chatId}_`) || doc.id === chatId.toString()
      );
      if (docs.length > 0) {
        preview.collections[INVOICE_COUNTERS_COLLECTION] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanInvoiceJobs(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(INVOICE_JOBS_COLLECTION).get();
      const docs = snapshot.docs.filter((doc) => {
        const data = doc.data();
        return data.chatId === chatId || data.telegramChatId === chatId;
      });
      if (docs.length > 0) {
        preview.collections[INVOICE_JOBS_COLLECTION] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanInvoices(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore.collection('Invoices').get();
      const docs = snapshot.docs.filter((doc) => {
        const data = doc.data();
        return data.chatId === chatId || data.telegramChatId === chatId;
      });
      if (docs.length > 0) {
        preview.collections['Invoices'] = { count: docs.length, docIds: docs.map((d) => d.id) };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanGeneratedInvoices(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(GENERATED_INVOICES_COLLECTION)
        .where('generatedBy.chatId', '==', chatId)
        .get();
      if (snapshot.size > 0) {
        preview.collections[GENERATED_INVOICES_COLLECTION] = {
          count: snapshot.size,
          docIds: snapshot.docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanInvoiceSessions(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(INVOICE_SESSIONS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `${chatId}_`)
        .where(FieldPath.documentId(), '<', `${chatId}_\uf8ff`)
        .get();
      if (snapshot.size > 0) {
        preview.collections[INVOICE_SESSIONS_COLLECTION] = {
          count: snapshot.size,
          docIds: snapshot.docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanOnboardingSession(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const doc = await this.firestore
        .collection(ONBOARDING_SESSIONS_COLLECTION)
        .doc(chatId.toString())
        .get();
      if (doc.exists) {
        preview.collections[ONBOARDING_SESSIONS_COLLECTION] = { count: 1, docIds: [doc.id] };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanUserMappings(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(USER_CUSTOMER_MAPPING_COLLECTION).get();
      const docs = snapshot.docs.filter((doc) => {
        const data = doc.data();
        const customers = data.customers || [];
        return customers.some((c: { chatId: number }) => c.chatId === chatId);
      });
      if (docs.length > 0) {
        preview.collections[USER_CUSTOMER_MAPPING_COLLECTION] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanGeneratedReceipts(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(GENERATED_RECEIPTS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `chat_${chatId}_`)
        .where(FieldPath.documentId(), '<', `chat_${chatId}_\uf8ff`)
        .get();
      if (snapshot.size > 0) {
        preview.collections[GENERATED_RECEIPTS_COLLECTION] = {
          count: snapshot.size,
          docIds: snapshot.docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanGeneratedInvoiceReceipts(
    chatId: number,
    preview: OffboardingPreview
  ): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(GENERATED_INVOICE_RECEIPTS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `chat_${chatId}_`)
        .where(FieldPath.documentId(), '<', `chat_${chatId}_\uf8ff`)
        .get();
      if (snapshot.size > 0) {
        preview.collections[GENERATED_INVOICE_RECEIPTS_COLLECTION] = {
          count: snapshot.size,
          docIds: snapshot.docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanReportSessions(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(REPORT_SESSIONS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `${chatId}_`)
        .where(FieldPath.documentId(), '<', `${chatId}_\uf8ff`)
        .get();
      if (snapshot.size > 0) {
        preview.collections[REPORT_SESSIONS_COLLECTION] = {
          count: snapshot.size,
          docIds: snapshot.docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanRateLimits(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(RATE_LIMITS_COLLECTION).get();
      const docs = snapshot.docs.filter((doc) => {
        const data = doc.data();
        return data.chatId === chatId || doc.id.includes(`_${chatId}`);
      });
      if (docs.length > 0) {
        preview.collections[RATE_LIMITS_COLLECTION] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanApprovedChats(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const doc = await this.firestore
        .collection(APPROVED_CHATS_COLLECTION)
        .doc(chatId.toString())
        .get();
      if (doc.exists) {
        preview.collections[APPROVED_CHATS_COLLECTION] = { count: 1, docIds: [doc.id] };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanProcessedCallbacks(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(PROCESSED_CALLBACKS_COLLECTION)
        .where('chatId', '==', chatId)
        .get();
      if (snapshot.size > 0) {
        preview.collections[PROCESSED_CALLBACKS_COLLECTION] = {
          count: snapshot.size,
          docIds: snapshot.docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanLogos(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.generatedInvoicesBucket);
      const [files] = await bucket.getFiles({ prefix: `logos/${chatId}/` });
      if (files.length > 0) {
        preview.storage['logos'] = { count: files.length, paths: files.map((f) => f.name) };
      }
    } catch (error) {
      // Bucket or prefix doesn't exist
    }
  }

  private async scanGeneratedPDFs(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.generatedInvoicesBucket);
      const [files] = await bucket.getFiles({ prefix: `${chatId}/` });
      if (files.length > 0) {
        preview.storage['generated_pdfs'] = {
          count: files.length,
          paths: files.map((f) => f.name),
        };
      }
    } catch (error) {
      // Bucket or prefix doesn't exist
    }
  }

  private async scanReceivedInvoices(chatId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.invoicesBucket);
      const [files] = await bucket.getFiles({ prefix: `invoices/${chatId}/` });
      if (files.length > 0) {
        preview.storage['received_invoices'] = {
          count: files.length,
          paths: files.map((f) => f.name),
        };
      }
    } catch (error) {
      // Bucket or prefix doesn't exist
    }
  }

  private async scanUserMapping(userId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const doc = await this.firestore
        .collection(USER_CUSTOMER_MAPPING_COLLECTION)
        .doc(`user_${userId}`)
        .get();
      if (doc.exists) {
        preview.collections[USER_CUSTOMER_MAPPING_COLLECTION] = { count: 1, docIds: [doc.id] };
      }
    } catch (error) {
      // Document doesn't exist
    }
  }

  private async scanUserInvoiceSessions(
    userId: number,
    preview: OffboardingPreview
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(INVOICE_SESSIONS_COLLECTION).get();
      const docs = snapshot.docs.filter((doc) => doc.id.includes(`_${userId}`));
      if (docs.length > 0) {
        preview.collections[INVOICE_SESSIONS_COLLECTION] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanUserOnboardingSessions(
    userId: number,
    preview: OffboardingPreview
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(ONBOARDING_SESSIONS_COLLECTION).get();
      const docs = snapshot.docs.filter((doc) => {
        const data = doc.data();
        return data.userId?.toString() === userId.toString();
      });
      if (docs.length > 0) {
        preview.collections[ONBOARDING_SESSIONS_COLLECTION] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanUserReportSessions(userId: number, preview: OffboardingPreview): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(REPORT_SESSIONS_COLLECTION).get();
      const docs = snapshot.docs.filter((doc) => doc.id.includes(`_${userId}`));
      if (docs.length > 0) {
        preview.collections[REPORT_SESSIONS_COLLECTION] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  private async scanUserInvoiceJobs(userId: number, preview: OffboardingPreview): Promise<void> {
    try {
      // Get username from user_customer_mapping
      let username: string | null = null;
      try {
        const userDoc = await this.firestore
          .collection(USER_CUSTOMER_MAPPING_COLLECTION)
          .doc(`user_${userId}`)
          .get();
        if (userDoc.exists) {
          username = userDoc.data()?.username || null;
        }
      } catch (error) {
        // User mapping might not exist
      }

      if (username) {
        const snapshot = await this.firestore.collection(INVOICE_JOBS_COLLECTION).get();
        const docs = snapshot.docs.filter((doc) => {
          const data = doc.data();
          return data.uploaderUsername === username;
        });
        if (docs.length > 0) {
          preview.collections[INVOICE_JOBS_COLLECTION] = {
            count: docs.length,
            docIds: docs.map((d) => d.id),
          };
        }
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  // ============================================================================
  // DELETE METHODS (for execution)
  // ============================================================================

  private async deleteBusinessConfig(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const docRef = this.firestore.collection(BUSINESS_CONFIG_COLLECTION).doc(`chat_${chatId}`);
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.delete();
        report.firestoreDocs++;
        report.details.collections[BUSINESS_CONFIG_COLLECTION] = 1;
      }
    } catch (error) {
      report.errors.push(`business_config: ${error}`);
    }
  }

  private async deleteInvoiceCounters(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(INVOICE_COUNTERS_COLLECTION).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        if (doc.id.startsWith(`chat_${chatId}_`) || doc.id === chatId.toString()) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[INVOICE_COUNTERS_COLLECTION] = count;
      }
    } catch (error) {
      report.errors.push(`invoice_counters: ${error}`);
    }
  }

  private async deleteInvoiceJobs(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(INVOICE_JOBS_COLLECTION).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.chatId === chatId || data.telegramChatId === chatId) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[INVOICE_JOBS_COLLECTION] = count;
      }
    } catch (error) {
      report.errors.push(`invoice_jobs: ${error}`);
    }
  }

  private async deleteInvoices(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore.collection('Invoices').get();
      let count = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.chatId === chatId || data.telegramChatId === chatId) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections['Invoices'] = count;
      }
    } catch (error) {
      report.errors.push(`Invoices: ${error}`);
    }
  }

  private async deleteGeneratedInvoices(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(GENERATED_INVOICES_COLLECTION)
        .where('generatedBy.chatId', '==', chatId)
        .get();
      for (const doc of snapshot.docs) {
        await doc.ref.delete();
      }
      if (snapshot.size > 0) {
        report.firestoreDocs += snapshot.size;
        report.details.collections[GENERATED_INVOICES_COLLECTION] = snapshot.size;
      }
    } catch (error) {
      report.errors.push(`generated_invoices: ${error}`);
    }
  }

  private async deleteInvoiceSessions(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(INVOICE_SESSIONS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `${chatId}_`)
        .where(FieldPath.documentId(), '<', `${chatId}_\uf8ff`)
        .get();
      for (const doc of snapshot.docs) {
        await doc.ref.delete();
      }
      if (snapshot.size > 0) {
        report.firestoreDocs += snapshot.size;
        report.details.collections[INVOICE_SESSIONS_COLLECTION] = snapshot.size;
      }
    } catch (error) {
      report.errors.push(`invoice_sessions: ${error}`);
    }
  }

  private async deleteOnboardingSession(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const docRef = this.firestore
        .collection(ONBOARDING_SESSIONS_COLLECTION)
        .doc(chatId.toString());
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.delete();
        report.firestoreDocs++;
        report.details.collections[ONBOARDING_SESSIONS_COLLECTION] = 1;
      }
    } catch (error) {
      report.errors.push(`onboarding_sessions: ${error}`);
    }
  }

  private async deleteGeneratedReceipts(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(GENERATED_RECEIPTS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `chat_${chatId}_`)
        .where(FieldPath.documentId(), '<', `chat_${chatId}_\uf8ff`)
        .get();
      for (const doc of snapshot.docs) {
        await doc.ref.delete();
      }
      if (snapshot.size > 0) {
        report.firestoreDocs += snapshot.size;
        report.details.collections[GENERATED_RECEIPTS_COLLECTION] = snapshot.size;
      }
    } catch (error) {
      report.errors.push(`generated_receipts: ${error}`);
    }
  }

  private async deleteGeneratedInvoiceReceipts(
    chatId: number,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(GENERATED_INVOICE_RECEIPTS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `chat_${chatId}_`)
        .where(FieldPath.documentId(), '<', `chat_${chatId}_\uf8ff`)
        .get();
      for (const doc of snapshot.docs) {
        await doc.ref.delete();
      }
      if (snapshot.size > 0) {
        report.firestoreDocs += snapshot.size;
        report.details.collections[GENERATED_INVOICE_RECEIPTS_COLLECTION] = snapshot.size;
      }
    } catch (error) {
      report.errors.push(`generated_invoice_receipts: ${error}`);
    }
  }

  private async deleteReportSessions(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(REPORT_SESSIONS_COLLECTION)
        .where(FieldPath.documentId(), '>=', `${chatId}_`)
        .where(FieldPath.documentId(), '<', `${chatId}_\uf8ff`)
        .get();
      for (const doc of snapshot.docs) {
        await doc.ref.delete();
      }
      if (snapshot.size > 0) {
        report.firestoreDocs += snapshot.size;
        report.details.collections[REPORT_SESSIONS_COLLECTION] = snapshot.size;
      }
    } catch (error) {
      report.errors.push(`report_sessions: ${error}`);
    }
  }

  private async deleteRateLimits(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(RATE_LIMITS_COLLECTION).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.chatId === chatId || doc.id.includes(`_${chatId}`)) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[RATE_LIMITS_COLLECTION] = count;
      }
    } catch (error) {
      report.errors.push(`rate_limits: ${error}`);
    }
  }

  private async deleteApprovedChats(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const docRef = this.firestore.collection(APPROVED_CHATS_COLLECTION).doc(chatId.toString());
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.delete();
        report.firestoreDocs++;
        report.details.collections[APPROVED_CHATS_COLLECTION] = 1;
      }
    } catch (error) {
      report.errors.push(`approved_chats: ${error}`);
    }
  }

  private async deleteProcessedCallbacks(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(PROCESSED_CALLBACKS_COLLECTION)
        .where('chatId', '==', chatId)
        .get();
      for (const doc of snapshot.docs) {
        await doc.ref.delete();
      }
      if (snapshot.size > 0) {
        report.firestoreDocs += snapshot.size;
        report.details.collections[PROCESSED_CALLBACKS_COLLECTION] = snapshot.size;
      }
    } catch (error) {
      report.errors.push(`processed_callbacks: ${error}`);
    }
  }

  private async updateUserMappings(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(USER_CUSTOMER_MAPPING_COLLECTION).get();
      let updates = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const customers = data.customers || [];
        const hasCustomer = customers.some((c: { chatId: number }) => c.chatId === chatId);

        if (hasCustomer) {
          const updatedCustomers = customers.filter((c: { chatId: number }) => c.chatId !== chatId);

          if (updatedCustomers.length === 0) {
            // User has no more customers, delete the document
            await doc.ref.delete();
            report.firestoreDocs++;
          } else {
            // User still has other customers, just update
            await doc.ref.update({ customers: updatedCustomers });
            report.firestoreUpdates++;
          }
          updates++;
        }
      }
      if (updates > 0) {
        report.details.collections[USER_CUSTOMER_MAPPING_COLLECTION] = updates;
      }
    } catch (error) {
      report.errors.push(`user_customer_mapping: ${error}`);
    }
  }

  private async deleteLogos(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.generatedInvoicesBucket);
      const prefix = `logos/${chatId}/`;
      const [files] = await bucket.getFiles({ prefix });

      // Delete all files
      for (const file of files) {
        await file.delete();
        report.storageFiles++;
      }

      if (files.length > 0) {
        report.details.buckets['logos'] = files.length;
      }

      // Explicitly delete folder marker objects that GCP console might have created
      // These are objects with the folder path itself as the name
      const folderMarkers = [`logos/${chatId}/`, `logos/${chatId}`, `logos/${chatId}/.folder`];

      for (const marker of folderMarkers) {
        try {
          await bucket.file(marker).delete();
        } catch {
          // Marker doesn't exist - that's fine
        }
      }

      // Force cleanup using gsutil to clear console UI artifacts
      this.forceRemoveFolderArtifact(this.generatedInvoicesBucket, `logos/${chatId}/`);
    } catch (error) {
      report.errors.push(`logos: ${error}`);
    }
  }

  private async deleteGeneratedPDFs(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.generatedInvoicesBucket);
      const prefix = `${chatId}/`;
      const [files] = await bucket.getFiles({ prefix });

      // Delete all files
      for (const file of files) {
        await file.delete();
        report.storageFiles++;
      }

      if (files.length > 0) {
        report.details.buckets['generated_pdfs'] = files.length;
      }

      // Explicitly delete folder marker objects that GCP console might have created
      const folderMarkers = [`${chatId}/`, `${chatId}`, `${chatId}/.folder`];

      for (const marker of folderMarkers) {
        try {
          await bucket.file(marker).delete();
        } catch {
          // Marker doesn't exist - that's fine
        }
      }

      // Force cleanup using gsutil to clear console UI artifacts
      this.forceRemoveFolderArtifact(this.generatedInvoicesBucket, `${chatId}/`);
    } catch (error) {
      report.errors.push(`generated_pdfs: ${error}`);
    }
  }

  private async deleteReceivedInvoices(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.invoicesBucket);
      const prefix = `invoices/${chatId}/`;
      const [files] = await bucket.getFiles({ prefix });

      // Delete all files
      for (const file of files) {
        await file.delete();
        report.storageFiles++;
      }

      if (files.length > 0) {
        report.details.buckets['received_invoices'] = files.length;
      }

      // Explicitly delete folder marker objects that GCP console might have created
      const folderMarkers = [
        `invoices/${chatId}/`,
        `invoices/${chatId}`,
        `invoices/${chatId}/.folder`,
      ];

      for (const marker of folderMarkers) {
        try {
          await bucket.file(marker).delete();
        } catch {
          // Marker doesn't exist - that's fine
        }
      }

      // Force cleanup using gsutil to clear console UI artifacts
      this.forceRemoveFolderArtifact(this.invoicesBucket, `invoices/${chatId}/`);
    } catch (error) {
      report.errors.push(`received_invoices: ${error}`);
    }
  }

  /**
   * Force cleanup of empty folder artifacts using gsutil
   * This addresses GCP console UI caching issues
   */
  private forceRemoveFolderArtifact(bucketName: string, prefix: string): void {
    try {
      // Try to force remove using gsutil - this might help clear console UI cache
      execSync(`gsutil -m rm -r gs://${bucketName}/${prefix} 2>/dev/null || true`, {
        stdio: 'ignore',
      });
    } catch {
      // Ignore errors - this is a best-effort cleanup for UI artifacts
    }
  }

  private async deleteUserMapping(userId: number, report: OffboardingReport): Promise<void> {
    try {
      const docRef = this.firestore
        .collection(USER_CUSTOMER_MAPPING_COLLECTION)
        .doc(`user_${userId}`);
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.delete();
        report.firestoreDocs++;
        report.details.collections[USER_CUSTOMER_MAPPING_COLLECTION] = 1;
      }
    } catch (error) {
      report.errors.push(`user_customer_mapping: ${error}`);
    }
  }

  private async deleteUserInvoiceSessions(
    userId: number,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(INVOICE_SESSIONS_COLLECTION).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        if (doc.id.includes(`_${userId}`)) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[INVOICE_SESSIONS_COLLECTION] = count;
      }
    } catch (error) {
      report.errors.push(`invoice_sessions: ${error}`);
    }
  }

  private async deleteUserOnboardingSessions(
    userId: number,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(ONBOARDING_SESSIONS_COLLECTION).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.userId?.toString() === userId.toString()) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[ONBOARDING_SESSIONS_COLLECTION] = count;
      }
    } catch (error) {
      report.errors.push(`onboarding_sessions: ${error}`);
    }
  }

  private async deleteUserReportSessions(userId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(REPORT_SESSIONS_COLLECTION).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        if (doc.id.includes(`_${userId}`)) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[REPORT_SESSIONS_COLLECTION] = count;
      }
    } catch (error) {
      report.errors.push(`report_sessions: ${error}`);
    }
  }

  private async anonymizeGeneratedInvoices(
    userId: number,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(GENERATED_INVOICES_COLLECTION).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.generatedBy?.telegramUserId?.toString() === userId.toString()) {
          await doc.ref.update({
            'generatedBy.telegramUserId': null,
            'generatedBy.username': '[deleted]',
          });
          count++;
        }
      }
      if (count > 0) {
        report.firestoreUpdates += count;
        report.details.collections['generated_invoices_anonymized'] = count;
      }
    } catch (error) {
      report.errors.push(`generated_invoices_anonymization: ${error}`);
    }
  }

  /**
   * Anonymize invoice_jobs for a user
   * Note: InvoiceJob doesn't have telegramUserId, so we match by uploaderUsername
   * This requires getting the username from user_customer_mapping first
   */
  private async anonymizeInvoiceJobs(userId: number, report: OffboardingReport): Promise<void> {
    try {
      // First, get the username from user_customer_mapping
      let username: string | null = null;
      try {
        const userDoc = await this.firestore
          .collection(USER_CUSTOMER_MAPPING_COLLECTION)
          .doc(`user_${userId}`)
          .get();
        if (userDoc.exists) {
          username = userDoc.data()?.username || null;
        }
      } catch (error) {
        // User mapping might already be deleted, try to find username from invoice_jobs directly
      }

      // If we have a username, anonymize all invoice_jobs with that username
      if (username) {
        const snapshot = await this.firestore.collection(INVOICE_JOBS_COLLECTION).get();
        let count = 0;
        for (const doc of snapshot.docs) {
          const data = doc.data();
          if (data.uploaderUsername === username) {
            await doc.ref.update({
              uploaderUsername: '[deleted]',
              uploaderFirstName: '[deleted]',
            });
            count++;
          }
        }
        if (count > 0) {
          report.firestoreUpdates += count;
          report.details.collections['invoice_jobs_anonymized'] = count;
        }
      } else {
        // If username not found, we can't reliably match invoice_jobs
        // This could happen if user mapping was already deleted
        report.errors.push(
          `invoice_jobs_anonymization: Could not find username for userId ${userId} - invoice_jobs may not be anonymized`
        );
      }
    } catch (error) {
      report.errors.push(`invoice_jobs_anonymization: ${error}`);
    }
  }
}

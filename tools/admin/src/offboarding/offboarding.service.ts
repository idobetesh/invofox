/**
 * Offboarding Service - Comprehensive GDPR-Compliant Data Deletion
 * Single source of truth for all customer/user data deletion
 *
 * Supports two modes:
 * 1. Business offboarding (delete business, keep users with other businesses)
 * 2. User offboarding (complete user deletion - GDPR Right to Erasure)
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { execSync } from 'child_process';

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
    'business_config',
    'invoice_counters',
    'invoice_jobs',
    'Invoices',
    'generated_invoices',
    'invoice_sessions',
    'onboarding_sessions',
  ];

  private readonly USER_COLLECTIONS = [
    'user_customer_mapping',
    'invoice_sessions',
    'onboarding_sessions',
  ];

  constructor(
    private firestore: Firestore,
    private storage: Storage,
    private invoicesBucket: string,
    private generatedInvoicesBucket: string
  ) {}

  /**
   * Helper: Delete documents by prefix
   */
  private async deleteDocsByPrefix(
    collectionName: string,
    prefix: string,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(collectionName).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        if (doc.id.startsWith(prefix)) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[collectionName] = count;
      }
    } catch (error) {
      report.errors.push(`${collectionName}: ${error}`);
    }
  }

  /**
   * Helper: Delete single document by ID
   */
  private async deleteSingleDoc(
    collectionName: string,
    docId: string,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const docRef = this.firestore.collection(collectionName).doc(docId);
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.delete();
        report.firestoreDocs++;
        report.details.collections[collectionName] = 1;
      }
    } catch (error) {
      report.errors.push(`${collectionName}: ${error}`);
    }
  }

  /**
   * Helper: Delete documents by custom filter
   */
  private async deleteDocsByFilter(
    collectionName: string,
    filterFn: (docId: string, docData: any) => boolean,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(collectionName).get();
      let count = 0;
      for (const doc of snapshot.docs) {
        if (filterFn(doc.id, doc.data())) {
          await doc.ref.delete();
          count++;
        }
      }
      if (count > 0) {
        report.firestoreDocs += count;
        report.details.collections[collectionName] = count;
      }
    } catch (error) {
      report.errors.push(`${collectionName}: ${error}`);
    }
  }

  /**
   * Helper: Delete Cloud Storage files by prefix
   */
  private async deleteStoragePrefix(
    bucketName: string,
    prefix: string,
    reportKey: string,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix });

      // Delete all files
      for (const file of files) {
        await file.delete();
        report.storageFiles++;
      }

      if (files.length > 0) {
        report.details.buckets[reportKey] = files.length;
      }

      // Explicitly delete folder marker objects that GCP console might have created
      const folderMarkers = [prefix, prefix.replace(/\/$/, ''), `${prefix}.folder`];
      for (const marker of folderMarkers) {
        try {
          await bucket.file(marker).delete();
        } catch {
          // Marker doesn't exist - that's fine
        }
      }

      // Force cleanup using gsutil to clear console UI artifacts
      this.forceRemoveFolderArtifact(bucketName, prefix);
    } catch (error) {
      report.errors.push(`${reportKey}: ${error}`);
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

  /**
   * Helper: Scan single document
   */
  private async scanSingleDoc(
    collectionName: string,
    docId: string,
    preview: OffboardingPreview
  ): Promise<void> {
    try {
      const doc = await this.firestore.collection(collectionName).doc(docId).get();
      if (doc.exists) {
        preview.collections[collectionName] = { count: 1, docIds: [doc.id] };
      }
    } catch (error) {
      // Collection doesn't exist or no access
    }
  }

  /**
   * Helper: Scan documents by prefix
   */
  private async scanDocsByPrefix(
    collectionName: string,
    prefix: string,
    preview: OffboardingPreview
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(collectionName).get();
      const docs = snapshot.docs.filter((doc) => doc.id.startsWith(prefix));
      if (docs.length > 0) {
        preview.collections[collectionName] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  /**
   * Helper: Scan documents by filter
   */
  private async scanDocsByFilter(
    collectionName: string,
    filterFn: (docId: string, docData: any) => boolean,
    preview: OffboardingPreview
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection(collectionName).get();
      const docs = snapshot.docs.filter((doc) => filterFn(doc.id, doc.data()));
      if (docs.length > 0) {
        preview.collections[collectionName] = {
          count: docs.length,
          docIds: docs.map((d) => d.id),
        };
      }
    } catch (error) {
      // Collection doesn't exist
    }
  }

  /**
   * Helper: Scan Cloud Storage files by prefix
   */
  private async scanStoragePrefix(
    bucketName: string,
    prefix: string,
    reportKey: string,
    preview: OffboardingPreview
  ): Promise<void> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix });
      if (files.length > 0) {
        preview.storage[reportKey] = {
          count: files.length,
          paths: files.map((f) => f.name),
        };
      }
    } catch (error) {
      // Bucket doesn't exist or no access
    }
  }

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
        .collection('business_config')
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
      const userMappingSnapshot = await this.firestore.collection('user_customer_mapping').get();
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
      this.scanInvoiceSessions(chatId, preview),
      this.scanOnboardingSession(chatId, preview),
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
        .collection('user_customer_mapping')
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

    // Delete everything in parallel (Firestore + Storage)
    await Promise.all([
      // Firestore deletions
      this.deleteBusinessConfig(chatId, report),
      this.deleteInvoiceCounters(chatId, report),
      this.deleteInvoiceJobs(chatId, report),
      this.deleteInvoices(chatId, report),
      this.deleteGeneratedInvoices(chatId, report),
      this.deleteInvoiceSessions(chatId, report),
      this.deleteOnboardingSession(chatId, report),
      this.deleteRateLimits(chatId, report),
      this.deleteApprovedChats(chatId, report),
      this.deleteReportSessions(chatId, report),
      this.updateUserMappings(chatId, report),
      // Storage deletions
      this.deleteLogos(chatId, report),
      this.deleteGeneratedPDFs(chatId, report),
      this.deleteReceivedInvoices(chatId, report),
    ]);

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

    // Step 1: Anonymize data (needs user_customer_mapping to exist for username lookup)
    await Promise.all([
      this.anonymizeGeneratedInvoices(userId, report),
      this.anonymizeInvoiceJobs(userId, report),
    ]);

    // Step 2: Delete user data (after anonymization is done)
    await Promise.all([
      this.deleteUserMapping(userId, report),
      this.deleteUserInvoiceSessions(userId, report),
      this.deleteUserOnboardingSessions(userId, report),
    ]);

    return report;
  }

  // ============================================================================
  // SCAN METHODS (for preview)
  // ============================================================================

  private async scanBusinessConfig(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanSingleDoc('business_config', `chat_${chatId}`, preview);
  }

  private async scanInvoiceCounters(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanDocsByFilter(
      'invoice_counters',
      (docId) => docId.startsWith(`chat_${chatId}_`) || docId === chatId.toString(),
      preview
    );
  }

  private async scanInvoiceJobs(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanDocsByFilter(
      'invoice_jobs',
      (_, data) => data.chatId === chatId || data.telegramChatId === chatId,
      preview
    );
  }

  private async scanInvoices(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanDocsByFilter(
      'Invoices',
      (_, data) => data.chatId === chatId || data.telegramChatId === chatId,
      preview
    );
  }

  private async scanGeneratedInvoices(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanDocsByFilter(
      'generated_invoices',
      (_, data) => data.generatedBy?.chatId === chatId,
      preview
    );
  }

  private async scanInvoiceSessions(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanDocsByPrefix('invoice_sessions', `${chatId}_`, preview);
  }

  private async scanOnboardingSession(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanSingleDoc('onboarding_sessions', chatId.toString(), preview);
  }

  private async scanUserMappings(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanDocsByFilter(
      'user_customer_mapping',
      (_, data) => {
        const customers = data.customers || [];
        return customers.some((c: { chatId: number }) => c.chatId === chatId);
      },
      preview
    );
  }

  private async scanLogos(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanStoragePrefix(
      this.generatedInvoicesBucket,
      `logos/${chatId}/`,
      'logos',
      preview
    );
  }

  private async scanGeneratedPDFs(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanStoragePrefix(
      this.generatedInvoicesBucket,
      `${chatId}/`,
      'generated_pdfs',
      preview
    );
  }

  private async scanReceivedInvoices(chatId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanStoragePrefix(
      this.invoicesBucket,
      `invoices/${chatId}/`,
      'received_invoices',
      preview
    );
  }

  private async scanUserMapping(userId: number, preview: OffboardingPreview): Promise<void> {
    await this.scanSingleDoc('user_customer_mapping', `user_${userId}`, preview);
  }

  private async scanUserInvoiceSessions(
    userId: number,
    preview: OffboardingPreview
  ): Promise<void> {
    await this.scanDocsByFilter(
      'invoice_sessions',
      (docId) => docId.includes(`_${userId}`),
      preview
    );
  }

  private async scanUserOnboardingSessions(
    userId: number,
    preview: OffboardingPreview
  ): Promise<void> {
    await this.scanDocsByFilter(
      'onboarding_sessions',
      (_, data) => data.userId?.toString() === userId.toString(),
      preview
    );
  }

  private async scanUserInvoiceJobs(userId: number, preview: OffboardingPreview): Promise<void> {
    try {
      // Get username from user_customer_mapping
      let username: string | null = null;
      try {
        const userDoc = await this.firestore
          .collection('user_customer_mapping')
          .doc(`user_${userId}`)
          .get();
        if (userDoc.exists) {
          username = userDoc.data()?.username || null;
        }
      } catch (error) {
        // User mapping might not exist
      }

      if (username) {
        const snapshot = await this.firestore.collection('invoice_jobs').get();
        const docs = snapshot.docs.filter((doc) => {
          const data = doc.data();
          return data.uploaderUsername === username;
        });
        if (docs.length > 0) {
          preview.collections['invoice_jobs'] = {
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
    await this.deleteSingleDoc('business_config', `chat_${chatId}`, report);
  }

  private async deleteInvoiceCounters(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteDocsByFilter(
      'invoice_counters',
      (docId) => docId.startsWith(`chat_${chatId}_`) || docId === chatId.toString(),
      report
    );
  }

  private async deleteInvoiceJobs(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteDocsByFilter(
      'invoice_jobs',
      (_, data) => data.chatId === chatId || data.telegramChatId === chatId,
      report
    );
  }

  private async deleteInvoices(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteDocsByFilter(
      'Invoices',
      (_, data) => data.chatId === chatId || data.telegramChatId === chatId,
      report
    );
  }

  private async deleteGeneratedInvoices(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteDocsByFilter(
      'generated_invoices',
      (_, data) => data.generatedBy?.chatId === chatId,
      report
    );
  }

  private async deleteInvoiceSessions(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteDocsByPrefix('invoice_sessions', `${chatId}_`, report);
  }

  private async deleteOnboardingSession(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteSingleDoc('onboarding_sessions', chatId.toString(), report);
  }

  private async deleteRateLimits(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteDocsByFilter(
      'rate_limits',
      (docId) => docId === `onboard_${chatId}` || docId === `report_${chatId}`,
      report
    );
  }

  private async deleteApprovedChats(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteSingleDoc('approved_chats', String(chatId), report);
  }

  private async deleteReportSessions(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteDocsByPrefix('report_sessions', `${chatId}_`, report);
  }

  private async updateUserMappings(chatId: number, report: OffboardingReport): Promise<void> {
    try {
      const snapshot = await this.firestore.collection('user_customer_mapping').get();
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
        report.details.collections['user_customer_mapping'] = updates;
      }
    } catch (error) {
      report.errors.push(`user_customer_mapping: ${error}`);
    }
  }

  private async deleteLogos(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteStoragePrefix(
      this.generatedInvoicesBucket,
      `logos/${chatId}/`,
      'logos',
      report
    );
  }

  private async deleteGeneratedPDFs(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteStoragePrefix(
      this.generatedInvoicesBucket,
      `${chatId}/`,
      'generated_pdfs',
      report
    );
  }

  private async deleteReceivedInvoices(chatId: number, report: OffboardingReport): Promise<void> {
    await this.deleteStoragePrefix(
      this.invoicesBucket,
      `invoices/${chatId}/`,
      'received_invoices',
      report
    );
  }

  private async deleteUserMapping(userId: number, report: OffboardingReport): Promise<void> {
    await this.deleteSingleDoc('user_customer_mapping', `user_${userId}`, report);
  }

  private async deleteUserInvoiceSessions(
    userId: number,
    report: OffboardingReport
  ): Promise<void> {
    await this.deleteDocsByFilter(
      'invoice_sessions',
      (docId) => docId.includes(`_${userId}`),
      report
    );
  }

  private async deleteUserOnboardingSessions(
    userId: number,
    report: OffboardingReport
  ): Promise<void> {
    await this.deleteDocsByFilter(
      'onboarding_sessions',
      (_, data) => data.userId?.toString() === userId.toString(),
      report
    );
  }

  private async anonymizeGeneratedInvoices(
    userId: number,
    report: OffboardingReport
  ): Promise<void> {
    try {
      const snapshot = await this.firestore.collection('generated_invoices').get();
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
          .collection('user_customer_mapping')
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
        const snapshot = await this.firestore.collection('invoice_jobs').get();
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

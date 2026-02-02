import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

export interface Customer {
  chatId: number;
  docId: string;
  name: string;
  taxId: string;
  email: string;
  phone: string;
  hasLogo: boolean;
  hasSheet: boolean;
  updatedAt: string;
}

export interface OffboardPreview {
  chatId: number;
  customerName: string;
  summary: {
    businessConfig: boolean;
    logo: { exists: boolean; path?: string };
    onboardingSession: boolean;
    counters: { count: number; docIds: string[] };
    generatedInvoices: { count: number; docIds: string[] };
    generatedPDFs: { count: number; paths: string[] };
    receivedInvoices: { count: number; paths: string[] };
    userMappings: { count: number; userIds: string[] };
    processingJobs: { count: number; docIds: string[] };
  };
  totalItems: number;
}

export class CustomerService {
  constructor(
    private firestore: Firestore,
    private storage: Storage
  ) {}

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Check if single document exists
   */
  private async checkDocExists(collection: string, docId: string): Promise<boolean> {
    const doc = await this.firestore.collection(collection).doc(docId).get();
    return doc.exists;
  }

  /**
   * Check documents by prefix
   */
  private async checkDocsByPrefix(
    collection: string,
    prefix: string
  ): Promise<{ count: number; docIds: string[] }> {
    const snapshot = await this.firestore.collection(collection).get();
    const docIds = snapshot.docs.filter((doc) => doc.id.startsWith(prefix)).map((doc) => doc.id);
    return { count: docIds.length, docIds };
  }

  /**
   * Check storage files by prefix
   */
  private async checkStorageFiles(
    bucketName: string,
    prefix: string
  ): Promise<{ count: number; paths: string[] }> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix });
      return {
        count: files.length,
        paths: files.map((f) => f.name),
      };
    } catch {
      return { count: 0, paths: [] };
    }
  }

  /**
   * Delete single document
   */
  private async deleteDoc(collection: string, docId: string): Promise<boolean> {
    const docRef = this.firestore.collection(collection).doc(docId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return false;
    }
    await docRef.delete();
    return true;
  }

  /**
   * Delete documents by prefix
   */
  private async deleteDocsByPrefix(collection: string, prefix: string): Promise<number> {
    const snapshot = await this.firestore.collection(collection).get();
    let count = 0;
    for (const doc of snapshot.docs) {
      if (doc.id.startsWith(prefix)) {
        await doc.ref.delete();
        count++;
      }
    }
    return count;
  }

  /**
   * Delete storage files by prefix
   */
  private async deleteStorageFiles(bucketName: string, prefix: string): Promise<number> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix });
      if (files.length === 0) {
        return 0;
      }
      await Promise.all(files.map((file) => file.delete()));
      return files.length;
    } catch {
      return 0;
    }
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * List all customers from business_config collection
   */
  async listCustomers(): Promise<Customer[]> {
    const snapshot = await this.firestore.collection('business_config').get();

    const customers: Customer[] = [];

    for (const doc of snapshot.docs) {
      if (doc.id.startsWith('chat_')) {
        const chatId = parseInt(doc.id.replace('chat_', ''), 10);
        const data = doc.data();

        customers.push({
          chatId,
          docId: doc.id,
          name: data.business?.name || 'Unknown',
          taxId: data.business?.taxId || 'N/A',
          email: data.business?.email || 'N/A',
          phone: data.business?.phone || 'N/A',
          hasLogo: Boolean(data.business?.logoUrl),
          hasSheet: Boolean(data.business?.sheetId),
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || 'N/A',
        });
      }
    }

    // Sort by chat ID
    customers.sort((a, b) => a.chatId - b.chatId);

    return customers;
  }

  /**
   * Get offboarding preview - scan for all data that will be deleted
   */
  async getOffboardingPreview(chatId: number): Promise<OffboardPreview> {
    const storageBucket = process.env.STORAGE_BUCKET || `${process.env.GCP_PROJECT_ID}-invoices`;
    const generatedInvoicesBucket =
      process.env.GENERATED_INVOICES_BUCKET || `${process.env.GCP_PROJECT_ID}-generated-invoices`;

    // Get customer name
    const docId = `chat_${chatId}`;
    const configDoc = await this.firestore.collection('business_config').doc(docId).get();
    const customerName = configDoc.exists ? configDoc.data()?.business?.name : 'Unknown';

    // Scan all data
    const [
      businessConfig,
      logo,
      onboardingSession,
      counters,
      generatedInvoices,
      generatedPDFs,
      receivedInvoices,
      userMappings,
      processingJobs,
    ] = await Promise.all([
      this.checkBusinessConfig(chatId),
      this.checkLogo(chatId, storageBucket),
      this.checkOnboardingSession(chatId),
      this.checkCounters(chatId),
      this.checkGeneratedInvoices(chatId),
      this.checkGeneratedPDFs(chatId, generatedInvoicesBucket),
      this.checkReceivedInvoices(chatId, storageBucket),
      this.checkUserMappings(chatId),
      this.checkProcessingJobs(chatId),
    ]);

    const totalItems =
      (businessConfig ? 1 : 0) +
      (logo.exists ? 1 : 0) +
      (onboardingSession ? 1 : 0) +
      counters.count +
      generatedInvoices.count +
      generatedPDFs.count +
      receivedInvoices.count +
      userMappings.count +
      processingJobs.count;

    return {
      chatId,
      customerName,
      summary: {
        businessConfig,
        logo,
        onboardingSession,
        counters,
        generatedInvoices,
        generatedPDFs,
        receivedInvoices,
        userMappings,
        processingJobs,
      },
      totalItems,
    };
  }

  /**
   * Perform actual offboarding - delete all customer data
   */
  async offboardCustomer(chatId: number): Promise<{ deleted: number }> {
    const storageBucket = process.env.STORAGE_BUCKET || `${process.env.GCP_PROJECT_ID}-invoices`;
    const generatedInvoicesBucket =
      process.env.GENERATED_INVOICES_BUCKET || `${process.env.GCP_PROJECT_ID}-generated-invoices`;

    let deleted = 0;

    // Delete all data
    const results = await Promise.all([
      this.deleteBusinessConfig(chatId),
      this.deleteLogo(chatId, storageBucket),
      this.deleteOnboardingSession(chatId),
      this.deleteCounters(chatId),
      this.deleteGeneratedInvoices(chatId),
      this.deleteGeneratedPDFs(chatId, generatedInvoicesBucket),
      this.deleteReceivedInvoices(chatId, storageBucket),
      this.removeUserMappings(chatId),
      this.deleteProcessingJobs(chatId),
    ]);

    // Count deletions
    deleted += results[0] ? 1 : 0; // businessConfig
    deleted += results[1] ? 1 : 0; // logo
    deleted += results[2] ? 1 : 0; // onboardingSession
    deleted += results[3]; // counters count
    deleted += results[4]; // generatedInvoices count
    deleted += results[5]; // generatedPDFs count
    deleted += results[6]; // receivedInvoices count
    deleted += results[7]; // userMappings count
    deleted += results[8]; // processingJobs count

    return { deleted };
  }

  // Check methods
  private async checkBusinessConfig(chatId: number): Promise<boolean> {
    return this.checkDocExists('business_config', `chat_${chatId}`);
  }

  private async checkLogo(
    chatId: number,
    bucketName: string
  ): Promise<{ exists: boolean; path?: string }> {
    const result = await this.checkStorageFiles(bucketName, `logos/${chatId}/`);
    return result.count > 0 ? { exists: true, path: result.paths[0] } : { exists: false };
  }

  private async checkOnboardingSession(chatId: number): Promise<boolean> {
    return this.checkDocExists('onboarding_sessions', chatId.toString());
  }

  private async checkCounters(chatId: number): Promise<{ count: number; docIds: string[] }> {
    return this.checkDocsByPrefix('invoice_counters', `chat_${chatId}_`);
  }

  private async checkGeneratedInvoices(
    chatId: number
  ): Promise<{ count: number; docIds: string[] }> {
    return this.checkDocsByPrefix('generated_invoices', `chat_${chatId}_`);
  }

  private async checkGeneratedPDFs(
    chatId: number,
    bucketName: string
  ): Promise<{ count: number; paths: string[] }> {
    return this.checkStorageFiles(bucketName, `${chatId}/`);
  }

  private async checkReceivedInvoices(
    chatId: number,
    bucketName: string
  ): Promise<{ count: number; paths: string[] }> {
    return this.checkStorageFiles(bucketName, `invoices/${chatId}/`);
  }

  private async checkUserMappings(chatId: number): Promise<{ count: number; userIds: string[] }> {
    const snapshot = await this.firestore.collection('user_customer_mapping').get();

    const userIds: string[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const customers = data.customers || [];
      const hasCustomer = customers.some((c: { chatId: number }) => c.chatId === chatId);

      if (hasCustomer) {
        userIds.push(doc.id);
      }
    }

    return { count: userIds.length, userIds };
  }

  private async checkProcessingJobs(chatId: number): Promise<{ count: number; docIds: string[] }> {
    return this.checkDocsByPrefix('processing_jobs', `chat_${chatId}_`);
  }

  // Delete methods
  private async deleteBusinessConfig(chatId: number): Promise<boolean> {
    return this.deleteDoc('business_config', `chat_${chatId}`);
  }

  private async deleteLogo(chatId: number, bucketName: string): Promise<boolean> {
    const count = await this.deleteStorageFiles(bucketName, `logos/${chatId}/`);
    return count > 0;
  }

  private async deleteOnboardingSession(chatId: number): Promise<boolean> {
    return this.deleteDoc('onboarding_sessions', chatId.toString());
  }

  private async deleteCounters(chatId: number): Promise<number> {
    return this.deleteDocsByPrefix('invoice_counters', `chat_${chatId}_`);
  }

  private async deleteGeneratedInvoices(chatId: number): Promise<number> {
    return this.deleteDocsByPrefix('generated_invoices', `chat_${chatId}_`);
  }

  private async deleteGeneratedPDFs(chatId: number, bucketName: string): Promise<number> {
    return this.deleteStorageFiles(bucketName, `${chatId}/`);
  }

  private async deleteReceivedInvoices(chatId: number, bucketName: string): Promise<number> {
    return this.deleteStorageFiles(bucketName, `invoices/${chatId}/`);
  }

  private async removeUserMappings(chatId: number): Promise<number> {
    const snapshot = await this.firestore.collection('user_customer_mapping').get();

    let count = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const customers = data.customers || [];

      const hasCustomer = customers.some((c: { chatId: number }) => c.chatId === chatId);

      if (hasCustomer) {
        const updatedCustomers = customers.filter((c: { chatId: number }) => c.chatId !== chatId);

        if (updatedCustomers.length === 0) {
          await doc.ref.delete();
        } else {
          await doc.ref.update({ customers: updatedCustomers });
        }
        count++;
      }
    }

    return count;
  }

  private async deleteProcessingJobs(chatId: number): Promise<number> {
    return this.deleteDocsByPrefix('processing_jobs', `chat_${chatId}_`);
  }
}

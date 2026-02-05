import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

export interface Customer {
  chatId: number;
  docId: string;
  name: string;
  taxId: string;
  taxStatus?: string;
  email: string;
  phone: string;
  address?: string;
  hasLogo: boolean;
  logoUrl?: string;
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
          taxStatus: data.business?.taxStatus || undefined,
          email: data.business?.email || 'N/A',
          phone: data.business?.phone || 'N/A',
          address: data.business?.address || undefined,
          hasLogo: Boolean(data.business?.logoUrl),
          logoUrl: data.business?.logoUrl || undefined,
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
    const docId = `chat_${chatId}`;
    const doc = await this.firestore.collection('business_config').doc(docId).get();
    return doc.exists;
  }

  private async checkLogo(
    chatId: number,
    bucketName: string
  ): Promise<{ exists: boolean; path?: string }> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const prefix = `logos/${chatId}/`;
      const [files] = await bucket.getFiles({ prefix });

      if (files.length === 0) {
        return { exists: false };
      }

      return { exists: true, path: files[0].name };
    } catch {
      return { exists: false };
    }
  }

  private async checkOnboardingSession(chatId: number): Promise<boolean> {
    const docId = chatId.toString();
    const doc = await this.firestore.collection('onboarding_sessions').doc(docId).get();
    return doc.exists;
  }

  private async checkCounters(chatId: number): Promise<{ count: number; docIds: string[] }> {
    const prefix = `chat_${chatId}_`;
    const snapshot = await this.firestore.collection('invoice_counters').get();

    const docIds: string[] = [];
    for (const doc of snapshot.docs) {
      if (doc.id.startsWith(prefix)) {
        docIds.push(doc.id);
      }
    }

    return { count: docIds.length, docIds };
  }

  private async checkGeneratedInvoices(
    chatId: number
  ): Promise<{ count: number; docIds: string[] }> {
    const prefix = `chat_${chatId}_`;
    const snapshot = await this.firestore.collection('generated_invoices').get();

    const docIds: string[] = [];
    for (const doc of snapshot.docs) {
      if (doc.id.startsWith(prefix)) {
        docIds.push(doc.id);
      }
    }

    return { count: docIds.length, docIds };
  }

  private async checkGeneratedPDFs(
    chatId: number,
    bucketName: string
  ): Promise<{ count: number; paths: string[] }> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const prefix = `${chatId}/`;
      const [files] = await bucket.getFiles({ prefix });

      return {
        count: files.length,
        paths: files.map((f) => f.name),
      };
    } catch {
      return { count: 0, paths: [] };
    }
  }

  private async checkReceivedInvoices(
    chatId: number,
    bucketName: string
  ): Promise<{ count: number; paths: string[] }> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const prefix = `invoices/${chatId}/`;
      const [files] = await bucket.getFiles({ prefix });

      return {
        count: files.length,
        paths: files.map((f) => f.name),
      };
    } catch {
      return { count: 0, paths: [] };
    }
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
    const prefix = `chat_${chatId}_`;
    const snapshot = await this.firestore.collection('processing_jobs').get();

    const docIds: string[] = [];
    for (const doc of snapshot.docs) {
      if (doc.id.startsWith(prefix)) {
        docIds.push(doc.id);
      }
    }

    return { count: docIds.length, docIds };
  }

  // Delete methods
  private async deleteBusinessConfig(chatId: number): Promise<boolean> {
    const docId = `chat_${chatId}`;
    const docRef = this.firestore.collection('business_config').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return false;
    }

    await docRef.delete();
    return true;
  }

  private async deleteLogo(chatId: number, bucketName: string): Promise<boolean> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const prefix = `logos/${chatId}/`;
      const [files] = await bucket.getFiles({ prefix });

      if (files.length === 0) {
        return false;
      }

      await Promise.all(files.map((file) => file.delete()));
      return true;
    } catch {
      return false;
    }
  }

  private async deleteOnboardingSession(chatId: number): Promise<boolean> {
    const docId = chatId.toString();
    const docRef = this.firestore.collection('onboarding_sessions').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return false;
    }

    await docRef.delete();
    return true;
  }

  private async deleteCounters(chatId: number): Promise<number> {
    const prefix = `chat_${chatId}_`;
    const snapshot = await this.firestore.collection('invoice_counters').get();

    let count = 0;
    for (const doc of snapshot.docs) {
      if (doc.id.startsWith(prefix)) {
        await doc.ref.delete();
        count++;
      }
    }

    return count;
  }

  private async deleteGeneratedInvoices(chatId: number): Promise<number> {
    const prefix = `chat_${chatId}_`;
    const snapshot = await this.firestore.collection('generated_invoices').get();

    let count = 0;
    for (const doc of snapshot.docs) {
      if (doc.id.startsWith(prefix)) {
        await doc.ref.delete();
        count++;
      }
    }

    return count;
  }

  private async deleteGeneratedPDFs(chatId: number, bucketName: string): Promise<number> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const prefix = `${chatId}/`;
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

  private async deleteReceivedInvoices(chatId: number, bucketName: string): Promise<number> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const prefix = `invoices/${chatId}/`;
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
    const prefix = `chat_${chatId}_`;
    const snapshot = await this.firestore.collection('processing_jobs').get();

    let count = 0;
    for (const doc of snapshot.docs) {
      if (doc.id.startsWith(prefix)) {
        await doc.ref.delete();
        count++;
      }
    }

    return count;
  }
}

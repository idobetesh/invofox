/**
 * Business Configuration Types
 * Type definitions for business setup, user mappings, and system configuration
 */

// ============================================================================
// System Configuration
// ============================================================================

export interface WebhookHandlerConfig {
  port: number;
  projectId: string;
  location: string;
  queueName: string;
  workerUrl: string;
  webhookSecretPath: string;
  serviceAccountEmail: string;
}

export interface WorkerConfig {
  port: number;
  projectId: string;
  telegramBotToken: string;
  openaiApiKey: string;
  storageBucket: string;
  sheetId: string;
  serviceAccountEmail: string;
}

// ============================================================================
// Business Configuration
// ============================================================================

/**
 * Business configuration for invoice generation
 */
export interface BusinessConfig {
  language?: 'en' | 'he'; // User's preferred language
  business: {
    name: string;
    taxId: string;
    taxStatus: string;
    email: string;
    phone: string;
    address: string;
    logoUrl?: string; // Cloud Storage URL or public URL
    sheetId?: string; // Per-customer Google Sheet ID
  };
  invoice: {
    digitalSignatureText: string;
    generatedByText: string;
  };
}

// ============================================================================
// User-to-Customer Mapping
// ============================================================================

/**
 * Customer access information for a user
 */
export interface CustomerAccess {
  chatId: number;
  chatTitle: string;
  addedAt: Date;
  addedBy?: number;
}

/**
 * User to customer mapping document
 * Stored as user_customer_mapping/user_{userId}
 */
export interface UserCustomerMapping {
  userId: number;
  username: string;
  customers: CustomerAccess[];
  lastActive: Date;
}

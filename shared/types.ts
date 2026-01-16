/**
 * Shared TypeScript types for the Papertrail Invoice Bot
 */

// ============================================================================
// Telegram Types
// ============================================================================

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  caption?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string; // Callback data from button
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// ============================================================================
// Cloud Task Payload
// ============================================================================

export interface TaskPayload {
  chatId: number;
  messageId: number;
  fileId: string;
  uploaderUsername: string;
  uploaderFirstName: string;
  chatTitle: string;
  receivedAt: string; // ISO timestamp
}

// ============================================================================
// Firestore Job Schema
// ============================================================================

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'pending_decision'
  | 'pending_retry';
export type PipelineStep = 'download' | 'drive' | 'llm' | 'sheets' | 'ack' | 'rejected';

export interface InvoiceJob {
  status: JobStatus;
  attempts: number;
  createdAt: Date | { toMillis: () => number };
  updatedAt: Date | { toMillis: () => number };
  telegramChatId: number;
  telegramMessageId: number;
  telegramFileId: string;
  uploaderUsername: string;
  uploaderFirstName: string;
  chatTitle: string;
  receivedAt: string;
  driveFileId?: string;
  driveLink?: string;
  sheetRowId?: number;
  lastStep?: PipelineStep;
  lastError?: string;
  // Extraction data for duplicate detection
  vendorName?: string | null;
  totalAmount?: number | null;
  invoiceDate?: string | null;
  currency?: string | null;
  category?: string | null;
  // Pending decision data
  duplicateOfJobId?: string;
  llmProvider?: 'gemini' | 'openai';
  totalTokens?: number;
  costUSD?: number;
  // Rejection data (for non-invoice documents)
  rejectionReason?: string | null;
}

// ============================================================================
// LLM Extraction Result
// ============================================================================

export interface InvoiceExtraction {
  // Document validation
  is_invoice: boolean; // Whether the document is a valid invoice
  rejection_reason: string | null; // Why it was rejected (if is_invoice is false)

  // Extraction fields
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // ISO format YYYY-MM-DD
  total_amount: number | null;
  currency: string | null;
  vat_amount: number | null;
  confidence: number; // 0-1
  category: string | null; // Business expense category
}

export interface LLMUsage {
  provider: 'gemini' | 'openai';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD: number; // Total cost in USD
}

export interface ExtractionResult {
  extraction: InvoiceExtraction;
  usage: LLMUsage;
}

// ============================================================================
// Google Sheets Row
// ============================================================================

export interface SheetRow {
  received_at: string; // DD/MM/YYYY HH:MM:SS
  invoice_date: string; // DD/MM/YYYY or ?
  amount: string; // number or ?
  currency: string; // ILS/USD/EUR or ?
  invoice_number: string; // or ?
  vendor_name: string; // or ?
  category: string; // Business expense category
  uploader: string; // Telegram username
  chat_name: string; // group/chat name
  drive_link: string; // clickable URL
  status: 'processed' | 'needs_review';
  llm_provider: 'gemini' | 'openai'; // Which LLM was used
  total_tokens: number; // LLM input + output tokens
  cost_usd: number; // Cost in USD (numeric for SUM)
}

// ============================================================================
// Duplicate Detection
// ============================================================================

export interface DuplicateMatch {
  jobId: string;
  vendorName: string | null;
  totalAmount: number | null;
  invoiceDate: string | null;
  driveLink: string;
  receivedAt: string;
  matchType: 'exact' | 'similar';
}

export type DuplicateAction = 'keep_both' | 'delete_new';

/**
 * Raw callback payload from Telegram webhook
 */
export interface CallbackPayload {
  callbackQueryId: string;
  data: string;
  botMessageChatId: number;
  botMessageId: number;
}

/**
 * Parsed duplicate decision from callback data
 */
export interface DuplicateDecision {
  action: DuplicateAction;
  chatId: number;
  messageId: number;
}

// ============================================================================
// Processing Result
// ============================================================================

export interface ProcessingResult {
  success: boolean;
  step: PipelineStep;
  driveFileId?: string;
  driveLink?: string;
  rawText?: string;
  extraction?: InvoiceExtraction;
  sheetRowId?: number;
  error?: string;
}

// ============================================================================
// Configuration Types
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
// Invoice Generation Types
// ============================================================================

/**
 * Invoice document types
 * - invoice: חשבונית (invoice only, payment pending)
 * - invoice_receipt: חשבונית-קבלה (invoice + receipt, payment received)
 */
export type InvoiceDocumentType = 'invoice' | 'invoice_receipt';

/**
 * Invoice generation session status
 */
export type InvoiceSessionStatus =
  | 'select_type' // Waiting for user to select document type
  | 'awaiting_details' // Waiting for customer name, amount, description
  | 'awaiting_payment' // Waiting for payment method selection
  | 'confirming'; // Showing confirmation, waiting for approve/cancel

/**
 * Payment methods (Hebrew)
 */
export type PaymentMethod = 'מזומן' | 'ביט' | 'PayBox' | 'העברה' | 'אשראי' | 'צ׳ק';

/**
 * Invoice generation session stored in Firestore
 * Document ID: `${chatId}_${userId}`
 */
export interface InvoiceSession {
  status: InvoiceSessionStatus;
  documentType?: InvoiceDocumentType;
  customerName?: string;
  customerTaxId?: string;
  description?: string;
  amount?: number;
  paymentMethod?: PaymentMethod;
  date?: string; // YYYY-MM-DD format
  createdAt: Date | { toMillis: () => number };
  updatedAt: Date | { toMillis: () => number };
}

/**
 * Generated invoice audit log stored in Firestore
 * Document ID: invoice number (e.g., "20261")
 */
export interface GeneratedInvoice {
  invoiceNumber: string;
  documentType: InvoiceDocumentType;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  date: string; // DD/MM/YYYY format
  generatedAt: Date | { toMillis: () => number };
  generatedBy: {
    telegramUserId: number;
    username: string;
    chatId: number;
  };
  storagePath: string;
  storageUrl: string;
}

/**
 * Invoice counter stored in Firestore
 * Document ID: year (e.g., "2026")
 */
export interface InvoiceCounter {
  counter: number;
  lastUpdated: Date | { toMillis: () => number };
}

/**
 * Cloud Task payload for invoice command processing
 */
export interface InvoiceCommandPayload {
  type: 'command';
  chatId: number;
  messageId: number;
  userId: number;
  username: string;
  firstName: string;
  text: string; // Full command text (may include arguments)
  receivedAt: string; // ISO timestamp
}

/**
 * Cloud Task payload for invoice conversation messages
 */
export interface InvoiceMessagePayload {
  type: 'message';
  chatId: number;
  messageId: number;
  userId: number;
  username: string;
  firstName: string;
  text: string;
  receivedAt: string;
}

/**
 * Cloud Task payload for invoice button callbacks
 */
export interface InvoiceCallbackPayload {
  type: 'callback';
  callbackQueryId: string;
  chatId: number;
  messageId: number;
  userId: number;
  username: string;
  data: string; // Callback data from button
}

/**
 * Union type for all invoice-related task payloads
 */
export type InvoiceTaskPayload =
  | InvoiceCommandPayload
  | InvoiceMessagePayload
  | InvoiceCallbackPayload;

/**
 * Business configuration for invoice generation
 */
export interface BusinessConfig {
  business: {
    name: string;
    taxId: string;
    taxStatus: string;
    email: string;
    phone: string;
    address: string;
  };
  invoice: {
    digitalSignatureText: string;
    generatedByText: string;
  };
}

/**
 * Data required to generate an invoice PDF
 */
export interface InvoiceData {
  invoiceNumber: string;
  documentType: InvoiceDocumentType;
  customerName: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  date: string; // DD/MM/YYYY format
}

/**
 * Generated Invoices sheet row
 */
export interface GeneratedInvoiceSheetRow {
  invoice_number: string;
  document_type: string;
  date: string;
  customer_name: string;
  customer_tax_id: string;
  description: string;
  amount: number;
  payment_method: string;
  generated_by: string;
  generated_at: string;
  pdf_link: string;
}

/**
 * Invoice callback action types
 */
export type InvoiceCallbackAction =
  | { action: 'select_type'; documentType: InvoiceDocumentType }
  | { action: 'select_payment'; paymentMethod: PaymentMethod }
  | { action: 'confirm' }
  | { action: 'cancel' };

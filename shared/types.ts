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

export type JobStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'pending_decision';
export type PipelineStep = 'download' | 'drive' | 'llm' | 'sheets' | 'ack';

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
  // Pending decision data
  duplicateOfJobId?: string;
  llmProvider?: 'gemini' | 'openai';
  totalTokens?: number;
  costUSD?: number;
}

// ============================================================================
// LLM Extraction Result
// ============================================================================

export interface InvoiceExtraction {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // ISO format YYYY-MM-DD
  total_amount: number | null;
  currency: string | null;
  vat_amount: number | null;
  confidence: number; // 0-1
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

export interface CallbackPayload {
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

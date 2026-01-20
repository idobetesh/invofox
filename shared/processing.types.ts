/**
 * Invoice Processing Types
 * Type definitions for invoice extraction, duplicate detection, and processing pipeline
 */

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

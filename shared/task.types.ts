/**
 * Cloud Task Payload Types
 * Type definitions for Cloud Tasks queue payloads
 */

/**
 * Task payload for invoice photo processing
 */
export interface TaskPayload {
  chatId: number;
  messageId: number;
  fileId: string;
  uploaderUsername: string;
  uploaderFirstName: string;
  chatTitle: string;
  receivedAt: string; // ISO timestamp
}

/**
 * Cloud Task payload for invoice command processing
 */
export interface InvoiceCommandPayload {
  type: 'command';
  chatId: number;
  chatTitle?: string; // Group/channel title (undefined for private chats)
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

/**
 * Security Types
 * Type definitions for invite codes, approved chats, and access control
 */

/**
 * Invite code document stored in Firestore
 * Document ID: code (e.g., "INV-ABC123")
 */
export interface InviteCode {
  code: string;
  createdBy: {
    userId: number;
    username: string;
  };
  createdAt: Date | { toMillis: () => number };
  expiresAt: Date | { toMillis: () => number };
  used: boolean;
  usedBy: {
    chatId: number;
    chatTitle: string;
  } | null;
  usedAt: Date | { toMillis: () => number } | null;
  note: string;
  revoked: boolean;
}

/**
 * Invite code validation result
 */
export interface ValidationResult {
  valid: boolean;
  reason?: 'invalid_format' | 'not_found' | 'revoked' | 'used' | 'expired';
  invite?: InviteCode;
  usedBy?: {
    chatId: number;
    chatTitle: string;
  };
}

/**
 * Approved chat document stored in Firestore
 * Document ID: chatId (e.g., "-1001234567890")
 */
export interface ApprovedChat {
  chatId: number;
  chatTitle: string;
  approvedAt: Date | { toMillis: () => number };
  approvedBy: {
    method: 'invite_code' | 'migration' | 'manual';
    code?: string;
    adminUserId?: number;
    note?: string;
  };
  status: 'active' | 'suspended' | 'banned';
}

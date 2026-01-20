/**
 * Shared TypeScript types for the Papertrail Invoice Bot
 *
 * @deprecated This file is kept for backward compatibility.
 * Types have been split into domain modules for better organization.
 * Please import from './shared' or './shared/index' instead.
 *
 * New structure:
 * - telegram.types.ts - Telegram API types
 * - task.types.ts - Cloud Task payloads
 * - processing.types.ts - Invoice processing pipeline
 * - business.types.ts - Business configuration and user mappings
 * - invoice.types.ts - Invoice generation
 * - security.types.ts - Security and access control
 * - index.ts - Re-exports all types
 */

// Re-export everything from the new structure for backward compatibility
export * from './index';

/**
 * Shared Types - Barrel Export
 *
 * Re-exports all types from domain-specific modules.
 * This allows consumers to import from a single location:
 *
 * @example
 * import { TelegramUpdate, InvoiceData, BusinessConfig } from '../shared';
 * // or
 * import { TelegramUpdate, InvoiceData, BusinessConfig } from '../shared/types';
 */

// Telegram API types
export * from './telegram.types';

// Cloud Task payloads
export * from './task.types';

// Invoice processing pipeline
export * from './processing.types';

// Business configuration and user mappings
export * from './business.types';

// Invoice generation
export * from './invoice.types';

// Security and access control
export * from './security.types';

// Report generation
export * from './report.types';

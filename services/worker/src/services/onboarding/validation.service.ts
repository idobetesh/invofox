/**
 * Onboarding Validation Service
 * Centralized validation logic using Zod schemas
 */

import { z } from 'zod';
import { t, type Language } from '../i18n/languages';

// Validation schemas
export const businessNameSchema = z.string().min(2).max(100);
export const addressSchema = z.string().min(5).max(200);
export const emailSchema = z.string().email();
export const phoneSchema = z
  .string()
  .min(9)
  .max(15)
  .regex(/^[+]?[\d\s\-()]+$/);
export const israeliIdSchema = z.string().regex(/^\d{9}$/);
export const israeliCompanyIdSchema = z.string().regex(/^\d{9}$/);
export const taxIdSchema = z.union([israeliIdSchema, israeliCompanyIdSchema]);
export const ownerNameSchema = z.string().min(2).max(100);
export const googleSheetIdSchema = z
  .string()
  .min(20)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const counterSchema = z.number().int().min(0);

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate business name
 */
export function validateBusinessName(name: string, language: Language = 'he'): ValidationResult {
  const result = businessNameSchema.safeParse(name);
  return {
    valid: result.success,
    error: result.success ? undefined : t(language, 'validation.businessNameInvalid'),
  };
}

/**
 * Validate owner details format and individual fields
 */
export function validateOwnerDetails(text: string, language: Language = 'he'): ValidationResult {
  const parts = text.split(',').map((p) => p.trim());

  if (parts.length !== 4) {
    return {
      valid: false,
      error: t(language, 'validation.ownerDetailsInvalid'),
    };
  }

  const [ownerName, ownerIdNumber, phone, email] = parts;

  // Validate owner name
  if (!ownerNameSchema.safeParse(ownerName).success) {
    return {
      valid: false,
      error: t(language, 'validation.ownerNameInvalid'),
    };
  }

  // Validate tax ID
  if (!taxIdSchema.safeParse(ownerIdNumber).success) {
    return {
      valid: false,
      error: t(language, 'validation.taxIdInvalid'),
    };
  }

  // Validate phone
  if (!phoneSchema.safeParse(phone).success) {
    return {
      valid: false,
      error: t(language, 'validation.phoneInvalid'),
    };
  }

  // Validate email
  if (!emailSchema.safeParse(email).success) {
    return {
      valid: false,
      error: t(language, 'validation.emailInvalid'),
    };
  }

  return { valid: true };
}

/**
 * Parse owner details into structured format
 */
export interface OwnerDetails {
  ownerName: string;
  ownerIdNumber: string;
  phone: string;
  email: string;
}

export function parseOwnerDetails(text: string, language: Language = 'he'): OwnerDetails | null {
  const validation = validateOwnerDetails(text, language);
  if (!validation.valid) {
    return null;
  }

  const [ownerName, ownerIdNumber, phone, email] = text.split(',').map((p) => p.trim());

  return {
    ownerName,
    ownerIdNumber,
    phone,
    email,
  };
}

/**
 * Validate address
 */
export function validateAddress(address: string, language: Language = 'he'): ValidationResult {
  const result = addressSchema.safeParse(address);
  return {
    valid: result.success,
    error: result.success ? undefined : t(language, 'validation.addressInvalid'),
  };
}

/**
 * Validate Google Sheet ID format
 */
export function validateSheetId(sheetId: string, language: Language = 'he'): ValidationResult {
  const result = googleSheetIdSchema.safeParse(sheetId);
  return {
    valid: result.success,
    error: result.success ? undefined : t(language, 'validation.sheetIdInvalid'),
  };
}

/**
 * Validate counter number
 */
export function validateCounter(value: string, language: Language = 'he'): ValidationResult {
  const num = parseInt(value, 10);

  if (isNaN(num)) {
    return {
      valid: false,
      error: t(language, 'validation.counterInvalid'),
    };
  }

  const result = counterSchema.safeParse(num);
  return {
    valid: result.success,
    error: result.success ? undefined : t(language, 'validation.counterNegative'),
  };
}

/**
 * Extract Google Sheet ID from URL or validate direct ID
 * Supports formats:
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/edit
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=0
 * - SHEET_ID (direct ID)
 */
export function extractSheetId(input: string): string | null {
  // Try to match Google Sheets URL pattern
  const urlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
  const match = input.match(urlPattern);

  if (match && match[1]) {
    return match[1];
  }

  // If no URL pattern found, assume it's a direct ID
  // Validate it looks like a sheet ID (alphanumeric, dashes, underscores, min 20 chars)
  if (/^[a-zA-Z0-9-_]{20,}$/.test(input)) {
    return input;
  }

  return null;
}

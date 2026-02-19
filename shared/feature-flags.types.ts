/**
 * Feature Flags Types
 * Shared types for the feature flag system used across all services.
 */

export type FlagType = 'boolean' | 'multivariate' | 'string' | 'number';

export type FlagAuditAction = 'created' | 'updated' | 'deleted' | 'toggled' | 'archived';

export interface FlagTargets {
  chats?: number[];
  users?: number[];
  percentage?: number; // 0-100
}

export interface FlagVariant {
  value: unknown;
  weight: number; // 0-100, all variants must sum to 100
}

export interface FlagPrerequisites {
  [flagKey: string]: boolean;
}

export interface FlagConfig {
  key: string;
  description: string;
  type: FlagType;
  enabled: boolean;
  defaultValue: unknown; // Returned when no targeting rule matches
  archived: boolean;
  targets?: FlagTargets;
  prerequisites?: FlagPrerequisites;
  variants?: Record<string, FlagVariant>; // Only for type: 'multivariate'
  createdAt: unknown; // Firestore Timestamp
  updatedAt: unknown; // Firestore Timestamp
}

export interface FeatureFlagContext {
  chatId?: number;
  userId?: number;
}

export interface AuditLogEntry {
  flagKey: string;
  action: FlagAuditAction;
  previousValue: unknown;
  newValue: unknown;
  timestamp: unknown; // Firestore Timestamp
}

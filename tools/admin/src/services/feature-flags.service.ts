/**
 * Feature Flags Admin Service
 * CRUD operations for feature flags stored in Firestore.
 *
 * Caching strategy:
 *   - listFlags() is cached for CACHE_TTL_MS to avoid repeated Firestore reads
 *   - Any mutation (create/update/toggle/archive/delete) invalidates the cache
 *   - getFlag() and getAuditLog() always hit Firestore (called infrequently)
 *
 * Query strategy:
 *   - All queries fetch the full collection and filter/sort in memory
 *   - Avoids composite indexes entirely (feature_flags will never exceed ~50 docs)
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import type {
  FlagConfig,
  FlagType,
  FlagTargets,
  FlagVariant,
  FlagPrerequisites,
  AuditLogEntry,
  FlagAuditAction,
} from '../../../../shared/feature-flags.types';
import {
  FEATURE_FLAGS_COLLECTION,
  FLAG_AUDIT_LOG_COLLECTION,
} from '../../../../shared/collections';

export interface CreateFlagDto {
  key: string;
  description: string;
  type: FlagType;
  enabled: boolean;
  defaultValue: unknown;
  targets?: FlagTargets;
  prerequisites?: FlagPrerequisites;
  variants?: Record<string, FlagVariant>;
}

export interface UpdateFlagDto {
  description?: string;
  enabled?: boolean;
  defaultValue?: unknown;
  targets?: FlagTargets;
  prerequisites?: FlagPrerequisites;
  variants?: Record<string, FlagVariant>;
}

const CACHE_TTL_MS = 15_000; // 15 seconds

export class FeatureFlagsService {
  private flagsCache: { data: FlagConfig[]; expiresAt: number } | null = null;

  constructor(private db: Firestore) {}

  /**
   * List all flags. Results are cached for CACHE_TTL_MS.
   * Filtering and sorting happen in memory to avoid composite Firestore indexes.
   */
  async listFlags(includeArchived = false): Promise<FlagConfig[]> {
    const now = Date.now();

    if (this.flagsCache && now < this.flagsCache.expiresAt) {
      const cached = this.flagsCache.data;
      return includeArchived ? cached : cached.filter((f) => !f.archived);
    }

    const snapshot = await this.db.collection(FEATURE_FLAGS_COLLECTION).get();
    const all = snapshot.docs
      .map((doc) => ({ key: doc.id, ...doc.data() }) as FlagConfig)
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    this.flagsCache = { data: all, expiresAt: now + CACHE_TTL_MS };

    return includeArchived ? all : all.filter((f) => !f.archived);
  }

  async getFlag(key: string): Promise<FlagConfig | null> {
    const doc = await this.db.collection(FEATURE_FLAGS_COLLECTION).doc(key).get();
    if (!doc.exists) {
      return null;
    }
    return { key: doc.id, ...doc.data() } as FlagConfig;
  }

  async createFlag(dto: CreateFlagDto): Promise<FlagConfig> {
    const ref = this.db.collection(FEATURE_FLAGS_COLLECTION).doc(dto.key);
    const existing = await ref.get();

    if (existing.exists) {
      throw new Error(`Flag '${dto.key}' already exists`);
    }

    const now = new Date();
    const flag: Omit<FlagConfig, 'key'> = {
      description: dto.description,
      type: dto.type,
      enabled: dto.enabled,
      defaultValue: dto.defaultValue,
      archived: false,
      targets: dto.targets ?? {},
      prerequisites: dto.prerequisites ?? {},
      ...(dto.variants !== undefined && { variants: dto.variants }),
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(flag);
    await this.logAudit({
      flagKey: dto.key,
      action: 'created',
      previousValue: null,
      newValue: flag,
    });
    this.invalidateCache();

    return { key: dto.key, ...flag };
  }

  async updateFlag(key: string, dto: UpdateFlagDto): Promise<FlagConfig> {
    const ref = this.db.collection(FEATURE_FLAGS_COLLECTION).doc(key);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new Error(`Flag '${key}' not found`);
    }

    const previous = doc.data();
    const updates = stripUndefined({ ...dto, updatedAt: new Date() });

    await ref.update(updates);
    await this.logAudit({
      flagKey: key,
      action: 'updated',
      previousValue: previous,
      newValue: updates,
    });
    this.invalidateCache();

    const updated = await ref.get();
    return { key, ...updated.data() } as FlagConfig;
  }

  async toggleFlag(key: string): Promise<{ key: string; enabled: boolean }> {
    const ref = this.db.collection(FEATURE_FLAGS_COLLECTION).doc(key);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new Error(`Flag '${key}' not found`);
    }

    const currentEnabled = (doc.data()?.enabled as boolean) ?? false;
    const newEnabled = !currentEnabled;

    await ref.update({ enabled: newEnabled, updatedAt: new Date() });
    await this.logAudit({
      flagKey: key,
      action: 'toggled',
      previousValue: currentEnabled,
      newValue: newEnabled,
    });
    this.invalidateCache();

    return { key, enabled: newEnabled };
  }

  async archiveFlag(key: string): Promise<void> {
    const ref = this.db.collection(FEATURE_FLAGS_COLLECTION).doc(key);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new Error(`Flag '${key}' not found`);
    }

    await ref.update({ archived: true, enabled: false, updatedAt: new Date() });
    await this.logAudit({ flagKey: key, action: 'archived', previousValue: false, newValue: true });
    this.invalidateCache();
  }

  async deleteFlag(key: string): Promise<void> {
    const ref = this.db.collection(FEATURE_FLAGS_COLLECTION).doc(key);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new Error(`Flag '${key}' not found`);
    }

    await this.logAudit({
      flagKey: key,
      action: 'deleted',
      previousValue: doc.data(),
      newValue: null,
    });
    await ref.delete();
    this.invalidateCache();
  }

  /**
   * Fetch audit log entries for a flag. Filtered by flagKey in Firestore,
   * sorted by timestamp in memory to avoid a composite index.
   */
  async getAuditLog(key: string): Promise<AuditLogEntry[]> {
    const snapshot = await this.db
      .collection(FLAG_AUDIT_LOG_COLLECTION)
      .where('flagKey', '==', key)
      .limit(50)
      .get();

    return snapshot.docs
      .map((doc) => doc.data() as AuditLogEntry)
      .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
  }

  private invalidateCache(): void {
    this.flagsCache = null;
  }

  private async logAudit(
    entry: Omit<AuditLogEntry, 'timestamp'> & { action: FlagAuditAction }
  ): Promise<void> {
    await this.db.collection(FLAG_AUDIT_LOG_COLLECTION).add({
      ...entry,
      timestamp: FieldValue.serverTimestamp(),
    });
  }
}

/** Remove undefined values from an object so Firestore doesn't reject them. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** Safely extract milliseconds from a Firestore Timestamp, Date, or unknown value. */
function toMillis(value: unknown): number {
  if (!value) {
    return 0;
  }
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return 0;
}

/**
 * FeatureFlagsService
 *
 * LaunchDarkly-style feature flag SDK backed by Firestore.
 * - In-memory cache for O(1) evaluations after first fetch
 * - Real-time Firestore listener keeps cache up-to-date automatically
 * - No redeployment needed to change flag values
 *
 * Usage (per-service singleton):
 *   export const featureFlags = new FeatureFlagsService(getFirestore());
 *
 *   if (await featureFlags.isEnabled('new-receipt-flow', { chatId })) { ... }
 */

import { Firestore } from '@google-cloud/firestore';
import type { FlagConfig, FeatureFlagContext, FlagVariant } from '../feature-flags.types';
import { FEATURE_FLAGS_COLLECTION } from '../collections';

export class FeatureFlagsService {
  private cache: Map<string, FlagConfig> = new Map();

  constructor(private db: Firestore) {
    this.initializeRealTimeSync();
  }

  /**
   * Check whether a flag is enabled for the given context.
   * Evaluates targeting rules in order: explicit chat → explicit user → percentage rollout → defaultValue.
   */
  async isEnabled(flagKey: string, context: FeatureFlagContext): Promise<boolean> {
    const flag = await this.getFlag(flagKey);

    if (!flag || !flag.enabled || flag.archived) {
      return false;
    }

    // Check prerequisites - all must be satisfied before evaluating this flag
    if (flag.prerequisites) {
      for (const [prereqKey, requiredValue] of Object.entries(flag.prerequisites)) {
        const prereqResult = await this.isEnabled(prereqKey, context);
        if (prereqResult !== requiredValue) {
          return false;
        }
      }
    }

    return this.evaluateTargeting(flagKey, flag, context);
  }

  /**
   * Get the variant key for a multivariate flag.
   * Returns null if flag doesn't exist, is disabled, archived, or not multivariate.
   * Variant assignment is stable: same flagKey + context always returns the same variant.
   */
  async getVariant(flagKey: string, context: FeatureFlagContext): Promise<string | null> {
    const flag = await this.getFlag(flagKey);

    if (!flag || !flag.enabled || flag.archived || flag.type !== 'multivariate' || !flag.variants) {
      return null;
    }

    const hash = this.hashContext(flagKey, context);
    return this.selectVariantByWeight(flag.variants, hash);
  }

  /**
   * Get the raw value of a string/number flag.
   * Returns defaultValue if flag doesn't exist, is disabled, or archived.
   */
  async getValue<T = unknown>(flagKey: string, defaultValue: T): Promise<T> {
    const flag = await this.getFlag(flagKey);

    if (!flag || !flag.enabled || flag.archived) {
      return defaultValue;
    }

    return (flag.defaultValue as T) ?? defaultValue;
  }

  /**
   * Evaluate multiple flags in parallel. Useful for batch-loading all flags needed for a request.
   */
  async evaluateAll(
    flagKeys: string[],
    context: FeatureFlagContext
  ): Promise<Record<string, boolean>> {
    const entries = await Promise.all(
      flagKeys.map(async (key) => [key, await this.isEnabled(key, context)] as const)
    );
    return Object.fromEntries(entries);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async getFlag(flagKey: string): Promise<FlagConfig | null> {
    if (this.cache.has(flagKey)) {
      return this.cache.get(flagKey)!;
    }

    const doc = await this.db.collection(FEATURE_FLAGS_COLLECTION).doc(flagKey).get();

    if (!doc.exists) {
      return null;
    }

    const flag = doc.data() as FlagConfig;
    this.cache.set(flagKey, flag);
    return flag;
  }

  private evaluateTargeting(
    flagKey: string,
    flag: FlagConfig,
    context: FeatureFlagContext
  ): boolean {
    const { targets } = flag;

    // 1. Explicit chat targeting always wins (beta testers, specific customers)
    if (context.chatId !== undefined && targets?.chats?.includes(context.chatId)) {
      return true;
    }

    // 2. Explicit user targeting always wins
    if (context.userId !== undefined && targets?.users?.includes(context.userId)) {
      return true;
    }

    // 3. Percentage rollout via consistent hashing (same context → same result every time)
    if (targets?.percentage !== undefined && targets.percentage > 0) {
      const bucket = this.hashContext(flagKey, context) % 100;
      return bucket < targets.percentage;
    }

    // 4. Fall through to flag's default value
    return Boolean(flag.defaultValue);
  }

  /**
   * Consistent hash of flagKey + context identifier.
   * Ensures the same context always lands in the same bucket across calls and restarts.
   */
  private hashContext(flagKey: string, context: FeatureFlagContext): number {
    const identifier = context.chatId ?? context.userId ?? 0;
    const str = `${flagKey}:${identifier}`;

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash);
  }

  private selectVariantByWeight(variants: Record<string, FlagVariant>, hash: number): string {
    const bucket = hash % 100;
    let cumulative = 0;

    for (const [key, variant] of Object.entries(variants)) {
      cumulative += variant.weight;
      if (bucket < cumulative) {
        return key;
      }
    }

    return 'control'; // Fallback - should never happen if weights sum to 100
  }

  /**
   * Subscribe to real-time Firestore updates.
   * Keeps the in-memory cache in sync without polling.
   * Any flag change in Firestore is reflected in <1s.
   */
  private initializeRealTimeSync(): void {
    this.db.collection(FEATURE_FLAGS_COLLECTION).onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const flagKey = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            this.cache.set(flagKey, change.doc.data() as FlagConfig);
          } else if (change.type === 'removed') {
            this.cache.delete(flagKey);
          }
        });
      },
      (error) => {
        // Log but don't crash - cache still serves last-known values
        console.error('[FeatureFlags] Real-time sync error:', error);
      }
    );
  }
}

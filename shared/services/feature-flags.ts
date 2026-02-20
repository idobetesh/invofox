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
 *   if (await featureFlags.getValue('new-receipt-flow', false, { chatId })) { ... }
 *   const limit = await featureFlags.getValue('max-invoices', 50);
 */

import type { FlagConfig, FeatureFlagContext } from '../feature-flags.types';
import { FEATURE_FLAGS_COLLECTION } from '../collections';

// Minimal structural interface — avoids importing @google-cloud/firestore in the
// shared package (which has no node_modules). Any Firestore instance satisfies this.
interface FirestoreDoc {
  exists: boolean;
  data(): unknown;
}
interface FirestoreDocChange {
  type: 'added' | 'modified' | 'removed';
  doc: { id: string; data(): unknown };
}
interface FirestoreSnapshot {
  docChanges(): FirestoreDocChange[];
}
interface FirestoreDb {
  collection(name: string): {
    doc(id: string): { get(): Promise<FirestoreDoc> };
    onSnapshot(
      onNext: (snapshot: FirestoreSnapshot) => void,
      onError: (error: Error) => void
    ): () => void;
  };
}

export class FeatureFlagsService {
  private cache: Map<string, FlagConfig> = new Map();
  private unsubscribeSync?: () => void;

  constructor(private db: FirestoreDb) {
    this.initializeRealTimeSync();
  }

  /**
   * Get the value of a flag.
   *
   * For boolean flags, pass context to evaluate targeting rules
   * (explicit chat/user targets, percentage rollout, prerequisites).
   * Returns defaultValue when flag is missing, disabled, archived, or prerequisites fail.
   *
   * For string/number flags, context is not used — the flag's defaultValue is returned.
   *
   * Examples:
   *   getValue('invoice-correction', false, { chatId }) // boolean with targeting
   *   getValue('max-invoices', 50)                      // number config value
   */
  async getValue<T = unknown>(
    flagKey: string,
    defaultValue: T,
    context?: FeatureFlagContext
  ): Promise<T> {
    const flag = await this.getFlag(flagKey);

    if (!flag || !flag.enabled || flag.archived) {
      return defaultValue;
    }

    // Check prerequisites when context is provided
    if (context && flag.prerequisites) {
      for (const [prereqKey, requiredValue] of Object.entries(flag.prerequisites)) {
        const prereqResult = await this.getValue(prereqKey, false, context);
        if (prereqResult !== requiredValue) {
          return defaultValue;
        }
      }
    }

    // Boolean flags with context: apply targeting rules
    if (context && flag.type === 'boolean') {
      return this.evaluateTargeting(flagKey, flag, context) as unknown as T;
    }

    return (flag.defaultValue as T) ?? defaultValue;
  }

  /**
   * Evaluate multiple boolean flags in parallel. Useful for batch-loading all flags needed for a request.
   */
  async evaluateAll(
    flagKeys: string[],
    context: FeatureFlagContext
  ): Promise<Record<string, boolean>> {
    const entries = await Promise.all(
      flagKeys.map(async (key) => [key, await this.getValue(key, false, context)] as const)
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

  /**
   * Subscribe to real-time Firestore updates.
   * Keeps the in-memory cache in sync without polling.
   * Any flag change in Firestore is reflected in <1s.
   */
  private initializeRealTimeSync(): void {
    this.unsubscribeSync = this.db.collection(FEATURE_FLAGS_COLLECTION).onSnapshot(
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
        // eslint-disable-next-line no-console
        console.error('[FeatureFlags] Real-time sync error:', error);
      }
    );
  }

  /**
   * Unsubscribes the real-time Firestore listener.
   * Call this when the service instance is no longer needed (e.g. in tests).
   */
  dispose(): void {
    this.unsubscribeSync?.();
  }
}

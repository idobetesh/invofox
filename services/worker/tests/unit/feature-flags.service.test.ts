/**
 * FeatureFlagsService Unit Tests
 */

import { FeatureFlagsService } from '../../../../shared/services/feature-flags';
import type { FlagConfig } from '../../../../shared/feature-flags.types';

// ---------------------------------------------------------------------------
// Firestore mock setup
// ---------------------------------------------------------------------------

const mockDocGet = jest.fn();
const mockOnSnapshot = jest.fn(); // returns unsubscribe fn; impl set per-test or in beforeEach

jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: mockDocGet })),
      onSnapshot: mockOnSnapshot,
    })),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlag(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    key: 'test-flag',
    description: 'Test Flag',
    type: 'boolean',
    enabled: true,
    defaultValue: false,
    archived: false,
    targets: {},
    prerequisites: {},
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeFirestoreDoc(data: FlagConfig | null) {
  if (!data) {
    return { exists: false, data: () => undefined };
  }
  return { exists: true, data: () => data };
}

function makeService(): FeatureFlagsService {
  const { Firestore } = jest.requireMock('@google-cloud/firestore');
  return new FeatureFlagsService(new Firestore());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureFlagsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnSnapshot.mockReturnValue(jest.fn()); // reset unsubscribe mock
  });

  // -------------------------------------------------------------------------
  // isEnabled
  // -------------------------------------------------------------------------

  describe('isEnabled', () => {
    it('returns false when flag does not exist in Firestore', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(null));
      const svc = makeService();

      expect(await svc.isEnabled('missing-flag', { chatId: 1 })).toBe(false);
    });

    it('returns false when flag.enabled is false', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ enabled: false })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 1 })).toBe(false);
    });

    it('returns false when flag is archived', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ archived: true })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 1 })).toBe(false);
    });

    it('returns defaultValue when enabled with no targeting rules', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ defaultValue: true })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 999 })).toBe(true);
    });

    it('returns false when enabled but defaultValue is false and no targeting match', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ defaultValue: false })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 999 })).toBe(false);
    });

    it('returns true when chatId is explicitly targeted', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { chats: [123, 456] } })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 123 })).toBe(true);
    });

    it('returns false when chatId is NOT in the explicit list', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { chats: [123, 456] } })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 999 })).toBe(false);
    });

    it('returns true when userId is explicitly targeted', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { users: [42] } })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { userId: 42 })).toBe(true);
    });

    it('returns true for percentage: 100 (all users included)', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { percentage: 100 } })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 99999 })).toBe(true);
    });

    it('returns false for percentage: 0 (no users included)', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { percentage: 0 } })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 1 })).toBe(false);
    });

    it('gives stable percentage result for same chatId across calls', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { percentage: 50 } })));
      const svc = makeService();

      const first = await svc.isEnabled('test-flag', { chatId: 12345 });
      const second = await svc.isEnabled('test-flag', { chatId: 12345 });

      expect(first).toBe(second);
    });

    it('explicit chat targeting overrides a percentage rollout that would exclude', async () => {
      // percentage: 0 would exclude everyone, but chatId 1 is explicitly targeted
      mockDocGet.mockResolvedValue(
        makeFirestoreDoc(makeFlag({ targets: { chats: [1], percentage: 0 } }))
      );
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 1 })).toBe(true);
    });

    describe('prerequisites', () => {
      it('returns false when a prerequisite flag is not met', async () => {
        // Main flag requires 'prereq-flag' to be true
        const mainFlag = makeFlag({
          key: 'main-flag',
          prerequisites: { 'prereq-flag': true },
        });
        const prereqFlag = makeFlag({ key: 'prereq-flag', enabled: false });

        mockDocGet
          .mockResolvedValueOnce(makeFirestoreDoc(mainFlag)) // main-flag fetch
          .mockResolvedValueOnce(makeFirestoreDoc(prereqFlag)); // prereq-flag fetch

        const svc = makeService();

        expect(await svc.isEnabled('main-flag', { chatId: 1 })).toBe(false);
      });

      it('returns true when all prerequisites are met', async () => {
        const mainFlag = makeFlag({
          key: 'main-flag',
          defaultValue: true,
          prerequisites: { 'prereq-flag': true },
        });
        const prereqFlag = makeFlag({ key: 'prereq-flag', enabled: true, defaultValue: true });

        mockDocGet
          .mockResolvedValueOnce(makeFirestoreDoc(mainFlag))
          .mockResolvedValueOnce(makeFirestoreDoc(prereqFlag));

        const svc = makeService();

        expect(await svc.isEnabled('main-flag', { chatId: 1 })).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // getVariant
  // -------------------------------------------------------------------------

  describe('getVariant', () => {
    it('returns null when flag does not exist', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(null));
      const svc = makeService();

      expect(await svc.getVariant('missing-flag', { chatId: 1 })).toBeNull();
    });

    it('returns null when flag type is boolean (not multivariate)', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ type: 'boolean' })));
      const svc = makeService();

      expect(await svc.getVariant('test-flag', { chatId: 1 })).toBeNull();
    });

    it('returns null when flag is disabled', async () => {
      mockDocGet.mockResolvedValue(
        makeFirestoreDoc(makeFlag({ type: 'multivariate', enabled: false }))
      );
      const svc = makeService();

      expect(await svc.getVariant('test-flag', { chatId: 1 })).toBeNull();
    });

    it('returns a variant from the weighted list', async () => {
      mockDocGet.mockResolvedValue(
        makeFirestoreDoc(
          makeFlag({
            type: 'multivariate',
            variants: {
              control: { value: 'control', weight: 50 },
              treatment: { value: 'treatment', weight: 50 },
            },
          })
        )
      );
      const svc = makeService();

      const variant = await svc.getVariant('test-flag', { chatId: 1 });

      expect(['control', 'treatment']).toContain(variant);
    });

    it('returns the same variant for the same context on repeated calls (stable)', async () => {
      mockDocGet.mockResolvedValue(
        makeFirestoreDoc(
          makeFlag({
            type: 'multivariate',
            variants: {
              a: { value: 'a', weight: 50 },
              b: { value: 'b', weight: 50 },
            },
          })
        )
      );
      const svc = makeService();
      const context = { chatId: 777 };

      const first = await svc.getVariant('test-flag', context);
      const second = await svc.getVariant('test-flag', context);

      expect(first).toBe(second);
    });

    it('may return different variants for different chatIds', async () => {
      const flag = makeFlag({
        type: 'multivariate',
        variants: {
          a: { value: 'a', weight: 50 },
          b: { value: 'b', weight: 50 },
        },
      });
      // Use mockResolvedValue (not Once) so cache is populated per service instance
      mockDocGet.mockResolvedValue(makeFirestoreDoc(flag));

      const svc = makeService();

      // Collect variants for many chatIds - with 50/50 split we should see both
      const variants = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const v = await svc.getVariant('test-flag', { chatId: i * 97 + 1 });
        if (v) {
          variants.add(v);
        }
      }

      expect(variants.size).toBeGreaterThan(1);
    });
  });

  // -------------------------------------------------------------------------
  // getValue
  // -------------------------------------------------------------------------

  describe('getValue', () => {
    it('returns the provided defaultValue when flag does not exist', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(null));
      const svc = makeService();

      expect(await svc.getValue('missing-flag', 'fallback')).toBe('fallback');
    });

    it('returns the provided defaultValue when flag is disabled', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ enabled: false })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', 42)).toBe(42);
    });

    it('returns flag.defaultValue when flag is enabled', async () => {
      mockDocGet.mockResolvedValue(
        makeFirestoreDoc(makeFlag({ defaultValue: 'production-value' }))
      );
      const svc = makeService();

      expect(await svc.getValue('test-flag', 'fallback')).toBe('production-value');
    });

    it('returns the provided defaultValue when flag is archived', async () => {
      mockDocGet.mockResolvedValue(
        makeFirestoreDoc(makeFlag({ archived: true, defaultValue: 'x' }))
      );
      const svc = makeService();

      expect(await svc.getValue('test-flag', 'fallback')).toBe('fallback');
    });
  });

  // -------------------------------------------------------------------------
  // evaluateAll
  // -------------------------------------------------------------------------

  describe('evaluateAll', () => {
    it('evaluates multiple flags and returns a keyed result map', async () => {
      mockDocGet
        .mockResolvedValueOnce(makeFirestoreDoc(makeFlag({ key: 'flag-a', defaultValue: true })))
        .mockResolvedValueOnce(makeFirestoreDoc(makeFlag({ key: 'flag-b', defaultValue: false })))
        .mockResolvedValueOnce(makeFirestoreDoc(null)); // flag-c missing

      const svc = makeService();

      const result = await svc.evaluateAll(['flag-a', 'flag-b', 'flag-c'], { chatId: 1 });

      expect(result).toEqual({ 'flag-a': true, 'flag-b': false, 'flag-c': false });
    });
  });

  // -------------------------------------------------------------------------
  // Cache behaviour
  // -------------------------------------------------------------------------

  describe('cache', () => {
    it('only fetches from Firestore once for repeated calls on the same flag', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ defaultValue: true })));
      const svc = makeService();

      await svc.isEnabled('test-flag', { chatId: 1 });
      await svc.isEnabled('test-flag', { chatId: 2 });
      await svc.isEnabled('test-flag', { chatId: 3 });

      expect(mockDocGet).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Real-time sync
  // -------------------------------------------------------------------------

  describe('real-time sync', () => {
    it('updates cache when Firestore fires a modified event', async () => {
      // Capture the snapshot callback when the service is constructed
      let snapshotCallback!: (snapshot: unknown) => void;
      mockOnSnapshot.mockImplementationOnce((cb: (snapshot: unknown) => void) => {
        snapshotCallback = cb;
        return jest.fn();
      });

      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ enabled: false })));
      const svc = makeService();

      expect(await svc.isEnabled('test-flag', { chatId: 1 })).toBe(false);

      // Simulate Firestore snapshot update: flag is now enabled
      const updatedFlag = makeFlag({ enabled: true, defaultValue: true });
      snapshotCallback({
        docChanges: () => [{ type: 'modified', doc: { id: 'test-flag', data: () => updatedFlag } }],
      });

      // Cache should now reflect the updated flag
      expect(await svc.isEnabled('test-flag', { chatId: 1 })).toBe(true);
      // Still only 1 Firestore read (cache was updated via snapshot, not refetched)
      expect(mockDocGet).toHaveBeenCalledTimes(1);
    });

    it('removes flag from cache when Firestore fires a removed event', async () => {
      let snapshotCallback!: (snapshot: unknown) => void;
      mockOnSnapshot.mockImplementationOnce((cb: (snapshot: unknown) => void) => {
        snapshotCallback = cb;
        return jest.fn();
      });

      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ defaultValue: true })));
      const svc = makeService();

      // Populate cache
      await svc.isEnabled('test-flag', { chatId: 1 });
      expect(mockDocGet).toHaveBeenCalledTimes(1);

      // Simulate flag deletion
      snapshotCallback({
        docChanges: () => [{ type: 'removed', doc: { id: 'test-flag', data: () => null } }],
      });

      // Next call should miss cache and go to Firestore (returns null → false)
      mockDocGet.mockResolvedValue(makeFirestoreDoc(null));
      expect(await svc.isEnabled('test-flag', { chatId: 1 })).toBe(false);
      expect(mockDocGet).toHaveBeenCalledTimes(2);
    });
  });
});

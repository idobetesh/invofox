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
  // getValue
  // -------------------------------------------------------------------------

  describe('getValue', () => {
    it('returns false when flag does not exist in Firestore', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(null));
      const svc = makeService();

      expect(await svc.getValue('missing-flag', false, { chatId: 1 })).toBe(false);
    });

    it('returns false when flag.enabled is false', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ enabled: false })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 1 })).toBe(false);
    });

    it('returns false when flag is archived', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ archived: true })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 1 })).toBe(false);
    });

    it('returns defaultValue when enabled with no targeting rules', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ defaultValue: true })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 999 })).toBe(true);
    });

    it('returns false when enabled but defaultValue is false and no targeting match', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ defaultValue: false })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 999 })).toBe(false);
    });

    it('returns true when chatId is explicitly targeted', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { chats: [123, 456] } })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 123 })).toBe(true);
    });

    it('returns false when chatId is NOT in the explicit list', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { chats: [123, 456] } })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 999 })).toBe(false);
    });

    it('returns true when userId is explicitly targeted', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { users: [42] } })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { userId: 42 })).toBe(true);
    });

    it('returns true for percentage: 100 (all users included)', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { percentage: 100 } })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 99999 })).toBe(true);
    });

    it('returns false for percentage: 0 (no users included)', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { percentage: 0 } })));
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 1 })).toBe(false);
    });

    it('gives stable percentage result for same chatId across calls', async () => {
      mockDocGet.mockResolvedValue(makeFirestoreDoc(makeFlag({ targets: { percentage: 50 } })));
      const svc = makeService();

      const first = await svc.getValue('test-flag', false, { chatId: 12345 });
      const second = await svc.getValue('test-flag', false, { chatId: 12345 });

      expect(first).toBe(second);
    });

    it('explicit chat targeting overrides a percentage rollout that would exclude', async () => {
      // percentage: 0 would exclude everyone, but chatId 1 is explicitly targeted
      mockDocGet.mockResolvedValue(
        makeFirestoreDoc(makeFlag({ targets: { chats: [1], percentage: 0 } }))
      );
      const svc = makeService();

      expect(await svc.getValue('test-flag', false, { chatId: 1 })).toBe(true);
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

        expect(await svc.getValue('main-flag', false, { chatId: 1 })).toBe(false);
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

        expect(await svc.getValue('main-flag', false, { chatId: 1 })).toBe(true);
      });
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

      await svc.getValue('test-flag', false, { chatId: 1 });
      await svc.getValue('test-flag', false, { chatId: 2 });
      await svc.getValue('test-flag', false, { chatId: 3 });

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

      expect(await svc.getValue('test-flag', false, { chatId: 1 })).toBe(false);

      // Simulate Firestore snapshot update: flag is now enabled
      const updatedFlag = makeFlag({ enabled: true, defaultValue: true });
      snapshotCallback({
        docChanges: () => [{ type: 'modified', doc: { id: 'test-flag', data: () => updatedFlag } }],
      });

      // Cache should now reflect the updated flag
      expect(await svc.getValue('test-flag', false, { chatId: 1 })).toBe(true);
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
      await svc.getValue('test-flag', false, { chatId: 1 });
      expect(mockDocGet).toHaveBeenCalledTimes(1);

      // Simulate flag deletion
      snapshotCallback({
        docChanges: () => [{ type: 'removed', doc: { id: 'test-flag', data: () => null } }],
      });

      // Next call should miss cache and go to Firestore (returns null → false)
      mockDocGet.mockResolvedValue(makeFirestoreDoc(null));
      expect(await svc.getValue('test-flag', false, { chatId: 1 })).toBe(false);
      expect(mockDocGet).toHaveBeenCalledTimes(2);
    });
  });
});

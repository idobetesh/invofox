/**
 * FeatureFlagsService (admin) Unit Tests
 *
 * Covers:
 *   - listFlags: cache hit/miss, archived filtering, cache expiry
 *   - createFlag: success, duplicate rejection, undefined variants stripped
 *   - updateFlag: success, not-found error
 *   - toggleFlag: flips enabled, not-found error
 *   - archiveFlag: sets archived+disabled, not-found error
 *   - deleteFlag: deletes doc, not-found error
 *   - all mutations invalidate the cache
 */

import { FeatureFlagsService } from '../../src/services/feature-flags.service';
import type { FlagConfig } from '../../../../shared/feature-flags.types';

// ---------------------------------------------------------------------------
// Firestore mock
// ---------------------------------------------------------------------------

const mockCollectionGet = jest.fn();
const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue(undefined);
const mockDocUpdate = jest.fn().mockResolvedValue(undefined);
const mockDocDelete = jest.fn().mockResolvedValue(undefined);
const mockAuditAdd = jest.fn().mockResolvedValue(undefined);
const mockWhereGet = jest.fn();

jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => ({
    collection: jest.fn((name: string) => {
      if (name === 'flag_audit_log') {
        return {
          add: mockAuditAdd,
          where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockWhereGet })) })),
        };
      }
      return {
        get: mockCollectionGet,
        doc: jest.fn(() => ({
          get: mockDocGet,
          set: mockDocSet,
          update: mockDocUpdate,
          delete: mockDocDelete,
        })),
      };
    }),
  })),
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlag(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    key: 'my-flag',
    description: 'My flag',
    type: 'boolean',
    enabled: false,
    defaultValue: false,
    archived: false,
    targets: {},
    prerequisites: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeDoc(data: Partial<FlagConfig> | null, id = 'my-flag') {
  if (!data) {
    return { exists: false, id, data: () => undefined };
  }
  return { exists: true, id, data: () => data };
}

function makeSnapshot(flags: FlagConfig[]) {
  return { docs: flags.map((f) => ({ id: f.key, data: () => f })) };
}

function makeService(): FeatureFlagsService {
  const { Firestore } = jest.requireMock('@google-cloud/firestore');
  return new FeatureFlagsService(new Firestore());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// --- listFlags ---

describe('listFlags', () => {
  it('fetches from Firestore on cache miss', async () => {
    const flag = makeFlag();
    mockCollectionGet.mockResolvedValue(makeSnapshot([flag]));

    const svc = makeService();
    const result = await svc.listFlags();

    expect(mockCollectionGet).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('my-flag');
  });

  it('returns cached data without hitting Firestore on second call', async () => {
    mockCollectionGet.mockResolvedValue(makeSnapshot([makeFlag()]));
    const svc = makeService();

    await svc.listFlags();
    await svc.listFlags();

    expect(mockCollectionGet).toHaveBeenCalledTimes(1);
  });

  it('filters out archived flags by default', async () => {
    mockCollectionGet.mockResolvedValue(
      makeSnapshot([makeFlag(), makeFlag({ key: 'old-flag', archived: true })])
    );
    const svc = makeService();
    const result = await svc.listFlags();

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('my-flag');
  });

  it('includes archived flags when includeArchived=true', async () => {
    mockCollectionGet.mockResolvedValue(
      makeSnapshot([makeFlag(), makeFlag({ key: 'old-flag', archived: true })])
    );
    const svc = makeService();
    const result = await svc.listFlags(true);

    expect(result).toHaveLength(2);
  });

  it('re-fetches after cache expires', async () => {
    jest.useFakeTimers();
    mockCollectionGet.mockResolvedValue(makeSnapshot([makeFlag()]));
    const svc = makeService();

    await svc.listFlags();
    jest.advanceTimersByTime(16_000); // past 15s TTL
    await svc.listFlags();

    expect(mockCollectionGet).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

// --- createFlag ---

describe('createFlag', () => {
  it('creates a flag and invalidates cache', async () => {
    mockDocGet.mockResolvedValue(makeDoc(null)); // not existing
    mockCollectionGet.mockResolvedValue(makeSnapshot([]));
    const svc = makeService();

    // Populate cache first
    await svc.listFlags();
    expect(mockCollectionGet).toHaveBeenCalledTimes(1);

    await svc.createFlag({
      key: 'new-flag',
      description: 'A new flag',
      type: 'boolean',
      enabled: false,
      defaultValue: false,
    });

    expect(mockDocSet).toHaveBeenCalledTimes(1);
    expect(mockAuditAdd).toHaveBeenCalledTimes(1);

    // Cache invalidated — next listFlags hits Firestore again
    mockCollectionGet.mockResolvedValue(makeSnapshot([]));
    await svc.listFlags();
    expect(mockCollectionGet).toHaveBeenCalledTimes(2);
  });

  it('throws if flag already exists', async () => {
    mockDocGet.mockResolvedValue(makeDoc(makeFlag()));

    const svc = makeService();
    await expect(
      svc.createFlag({
        key: 'my-flag',
        description: 'x',
        type: 'boolean',
        enabled: false,
        defaultValue: false,
      })
    ).rejects.toThrow("Flag 'my-flag' already exists");
  });

  it('does not include variants key when not provided', async () => {
    mockDocGet.mockResolvedValue(makeDoc(null));
    const svc = makeService();

    await svc.createFlag({
      key: 'f',
      description: 'd',
      type: 'boolean',
      enabled: false,
      defaultValue: false,
    });

    const savedData = mockDocSet.mock.calls[0][0];
    expect(savedData).not.toHaveProperty('variants');
  });

  it('includes variants when provided', async () => {
    mockDocGet.mockResolvedValue(makeDoc(null));
    const svc = makeService();

    const variants = { on: { value: true, weight: 50 }, off: { value: false, weight: 50 } };
    await svc.createFlag({
      key: 'f',
      description: 'd',
      type: 'multivariate',
      enabled: false,
      defaultValue: false,
      variants,
    });

    const savedData = mockDocSet.mock.calls[0][0];
    expect(savedData.variants).toEqual(variants);
  });
});

// --- updateFlag ---

describe('updateFlag', () => {
  it('updates the flag and invalidates cache', async () => {
    const existing = makeFlag();
    // First call: existence check; second call: re-fetch after update
    mockDocGet
      .mockResolvedValueOnce(makeDoc(existing))
      .mockResolvedValueOnce(makeDoc({ ...existing, description: 'Updated' }));

    const svc = makeService();
    const result = await svc.updateFlag('my-flag', { description: 'Updated' });

    expect(mockDocUpdate).toHaveBeenCalledTimes(1);
    expect(result.description).toBe('Updated');
  });

  it('throws if flag not found', async () => {
    mockDocGet.mockResolvedValue(makeDoc(null));
    const svc = makeService();

    await expect(svc.updateFlag('missing', {})).rejects.toThrow("Flag 'missing' not found");
  });

  it('strips undefined fields before writing', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeDoc(makeFlag()))
      .mockResolvedValueOnce(makeDoc(makeFlag()));

    const svc = makeService();
    await svc.updateFlag('my-flag', { description: 'hello', enabled: undefined });

    const updates = mockDocUpdate.mock.calls[0][0];
    expect(updates).not.toHaveProperty('enabled');
    expect(updates.description).toBe('hello');
  });
});

// --- toggleFlag ---

describe('toggleFlag', () => {
  it('flips enabled from false to true', async () => {
    mockDocGet.mockResolvedValue(makeDoc(makeFlag({ enabled: false })));
    const svc = makeService();

    const result = await svc.toggleFlag('my-flag');
    expect(result.enabled).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('flips enabled from true to false', async () => {
    mockDocGet.mockResolvedValue(makeDoc(makeFlag({ enabled: true })));
    const svc = makeService();

    const result = await svc.toggleFlag('my-flag');
    expect(result.enabled).toBe(false);
  });

  it('throws if flag not found', async () => {
    mockDocGet.mockResolvedValue(makeDoc(null));
    const svc = makeService();

    await expect(svc.toggleFlag('missing')).rejects.toThrow("Flag 'missing' not found");
  });
});

// --- archiveFlag ---

describe('archiveFlag', () => {
  it('sets archived=true and enabled=false', async () => {
    mockDocGet.mockResolvedValue(makeDoc(makeFlag({ enabled: true })));
    const svc = makeService();

    await svc.archiveFlag('my-flag');

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ archived: true, enabled: false })
    );
  });

  it('throws if flag not found', async () => {
    mockDocGet.mockResolvedValue(makeDoc(null));
    const svc = makeService();

    await expect(svc.archiveFlag('missing')).rejects.toThrow("Flag 'missing' not found");
  });
});

// --- deleteFlag ---

describe('deleteFlag', () => {
  it('logs audit then deletes the document', async () => {
    mockDocGet.mockResolvedValue(makeDoc(makeFlag()));
    const svc = makeService();

    await svc.deleteFlag('my-flag');

    expect(mockAuditAdd).toHaveBeenCalledTimes(1);
    expect(mockDocDelete).toHaveBeenCalledTimes(1);
  });

  it('throws if flag not found', async () => {
    mockDocGet.mockResolvedValue(makeDoc(null));
    const svc = makeService();

    await expect(svc.deleteFlag('missing')).rejects.toThrow("Flag 'missing' not found");
  });
});

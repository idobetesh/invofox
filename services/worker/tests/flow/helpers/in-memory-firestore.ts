/**
 * In-Memory Firestore implementation for flow tests.
 * Persists data across HTTP calls within a single test, resets between tests.
 *
 * Usage:
 *   const db = new InMemoryFirestore();
 *   db.seed('invoice_sessions', 'chatId_userId', { status: 'select_type' });
 *   db.peek('invoice_sessions', 'chatId_userId'); // read back
 */

type DocData = Record<string, unknown>;

// ─── FieldValue sentinel detection ─────────────────────────────────────────
// These markers are set by the @google-cloud/firestore mock in each test file.

function isServerTimestamp(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__firestoreType === 'serverTimestamp'
  );
}

function isDeleteSentinel(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__firestoreType === 'delete'
  );
}

function isArrayUnion(v: unknown): v is { __firestoreType: 'arrayUnion'; elements: unknown[] } {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__firestoreType === 'arrayUnion'
  );
}

function isArrayRemove(v: unknown): v is { __firestoreType: 'arrayRemove'; elements: unknown[] } {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__firestoreType === 'arrayRemove'
  );
}

function makeMockTimestamp(): { toMillis: () => number; toDate: () => Date } {
  const ms = Date.now();
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

/** Resolve a single field value, handling FieldValue sentinels. */
function resolveValue(value: unknown, existingValue?: unknown): unknown {
  if (isServerTimestamp(value)) {
    return makeMockTimestamp();
  }
  if (isArrayUnion(value)) {
    const current = Array.isArray(existingValue) ? existingValue : [];
    const merged = [...current];
    for (const el of value.elements) {
      if (!merged.includes(el)) {
        merged.push(el);
      }
    }
    return merged;
  }
  if (isArrayRemove(value)) {
    const current = Array.isArray(existingValue) ? existingValue : [];
    return current.filter((e) => !(value as { elements: unknown[] }).elements.includes(e));
  }
  return value;
}

/** Convert a value to something comparable (for where/orderBy). */
function toComparable(v: unknown): number | string | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  if (typeof v === 'object' && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number' || typeof v === 'string') {
    return v;
  }
  return undefined;
}

// ─── Document Snapshot ───────────────────────────────────────────────────────

export class MockDocumentSnapshot {
  readonly exists: boolean;
  readonly id: string;
  readonly ref: MockDocumentReference;
  private _data?: DocData;

  constructor(exists: boolean, id: string, ref: MockDocumentReference, data?: DocData) {
    this.exists = exists;
    this.id = id;
    this.ref = ref;
    this._data = data;
  }

  data(): DocData | undefined {
    return this._data ? { ...this._data } : undefined;
  }
}

// ─── Query Document Snapshot (always exists) ────────────────────────────────

export class MockQueryDocumentSnapshot {
  readonly exists = true;
  readonly id: string;
  private _data: DocData;

  constructor(id: string, data: DocData) {
    this.id = id;
    this._data = data;
  }

  data(): DocData {
    return { ...this._data };
  }
}

// ─── Query Snapshot ──────────────────────────────────────────────────────────

export class MockQuerySnapshot {
  readonly docs: MockQueryDocumentSnapshot[];
  readonly empty: boolean;
  readonly size: number;

  constructor(results: Array<{ id: string; data: DocData }>) {
    this.docs = results.map((r) => new MockQueryDocumentSnapshot(r.id, r.data));
    this.empty = results.length === 0;
    this.size = results.length;
  }
}

// ─── Aggregate Query (count) ────────────────────────────────────────────────

class MockAggregateQuery {
  constructor(private query: MockQuery) {}

  async get(): Promise<{ data(): { count: number } }> {
    const snap = await this.query.get();
    return { data: () => ({ count: snap.size }) };
  }
}

// ─── Query ──────────────────────────────────────────────────────────────────

type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';

interface WhereClause {
  field: string;
  op: WhereOp;
  value: unknown;
}

class MockQuery {
  constructor(
    protected col: Map<string, DocData>,
    protected colPath: string,
    protected _conditions: WhereClause[] = [],
    protected _orderBy?: { field: string; dir: 'asc' | 'desc' },
    protected _offset: number = 0,
    protected _limit?: number
  ) {}

  where(field: string, op: string, value: unknown): MockQuery {
    return new MockQuery(
      this.col,
      this.colPath,
      [...this._conditions, { field, op: op as WhereOp, value }],
      this._orderBy,
      this._offset,
      this._limit
    );
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): MockQuery {
    return new MockQuery(
      this.col,
      this.colPath,
      this._conditions,
      { field, dir },
      this._offset,
      this._limit
    );
  }

  offset(n: number): MockQuery {
    return new MockQuery(this.col, this.colPath, this._conditions, this._orderBy, n, this._limit);
  }

  limit(n: number): MockQuery {
    return new MockQuery(this.col, this.colPath, this._conditions, this._orderBy, this._offset, n);
  }

  count(): MockAggregateQuery {
    return new MockAggregateQuery(this);
  }

  async get(): Promise<MockQuerySnapshot> {
    let results = Array.from(this.col.entries())
      .filter(([, data]) => this._matchesAll(data))
      .map(([id, data]) => ({ id, data }));

    if (this._orderBy) {
      const { field, dir } = this._orderBy;
      results.sort((a, b) => {
        const av = toComparable(a.data[field]);
        const bv = toComparable(b.data[field]);
        if (av === undefined) {
          return 1;
        }
        if (bv === undefined) {
          return -1;
        }
        if (av < bv) {
          return dir === 'asc' ? -1 : 1;
        }
        if (av > bv) {
          return dir === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    if (this._offset > 0) {
      results = results.slice(this._offset);
    }
    if (this._limit !== undefined) {
      results = results.slice(0, this._limit);
    }

    return new MockQuerySnapshot(results);
  }

  private _matchesAll(data: DocData): boolean {
    return this._conditions.every(({ field, op, value }) => {
      const docVal = data[field];
      switch (op) {
        case '==':
          return docVal === value;
        case '!=':
          return docVal !== value;
        case '<':
          return (toComparable(docVal) ?? 0) < (toComparable(value) ?? 0);
        case '<=':
          return (toComparable(docVal) ?? 0) <= (toComparable(value) ?? 0);
        case '>':
          return (toComparable(docVal) ?? 0) > (toComparable(value) ?? 0);
        case '>=':
          return (toComparable(docVal) ?? 0) >= (toComparable(value) ?? 0);
        case 'in':
          return Array.isArray(value) && value.includes(docVal);
        case 'not-in':
          return Array.isArray(value) && !value.includes(docVal);
        case 'array-contains':
          return Array.isArray(docVal) && docVal.includes(value);
        default:
          return true;
      }
    });
  }
}

// ─── Collection Reference ────────────────────────────────────────────────────

class MockCollectionReference extends MockQuery {
  constructor(col: Map<string, DocData>, colPath: string) {
    super(col, colPath);
  }

  doc(id: string): MockDocumentReference {
    return new MockDocumentReference(this.col, id, this.colPath);
  }
}

// ─── Dot-notation helpers ──────────────────────────────────────────────────────

function deepClone(obj: DocData): DocData {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Set a value at a dot-notation path (e.g., 'data.businessName' → doc.data.businessName).
 * Creates intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      current[part] === undefined ||
      current[part] === null ||
      typeof current[part] !== 'object'
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  if (value === undefined) {
    delete current[lastPart];
  } else {
    current[lastPart] = value;
  }
}

// ─── Document Reference ──────────────────────────────────────────────────────

export class MockDocumentReference {
  readonly id: string;
  readonly path: string;

  constructor(
    private col: Map<string, DocData>,
    id: string,
    colPath: string
  ) {
    this.id = id;
    this.path = `${colPath}/${id}`;
  }

  async get(): Promise<MockDocumentSnapshot> {
    const stored = this.col.get(this.id);
    return new MockDocumentSnapshot(stored !== undefined, this.id, this, stored);
  }

  async set(data: DocData): Promise<void> {
    const existing = this.col.get(this.id) ?? {};
    const resolved: DocData = {};
    for (const [k, v] of Object.entries(data)) {
      if (!isDeleteSentinel(v)) {
        resolved[k] = resolveValue(v, existing[k]);
      }
    }
    this.col.set(this.id, resolved);
  }

  async update(updates: Partial<DocData>): Promise<void> {
    const existing = deepClone(this.col.get(this.id) ?? {});
    for (const [k, v] of Object.entries(updates)) {
      if (k.includes('.')) {
        // Dot-notation path: 'data.businessName' → set existing.data.businessName
        setNestedValue(existing, k, isDeleteSentinel(v) ? undefined : resolveValue(v));
      } else if (isDeleteSentinel(v)) {
        delete existing[k];
      } else {
        existing[k] = resolveValue(v, existing[k]);
      }
    }
    this.col.set(this.id, existing);
  }

  async delete(): Promise<void> {
    this.col.delete(this.id);
  }
}

// ─── Transaction ─────────────────────────────────────────────────────────────

class MockTransaction {
  private writes: Array<() => Promise<void>> = [];

  async get(ref: MockDocumentReference): Promise<MockDocumentSnapshot> {
    return ref.get();
  }

  update(ref: MockDocumentReference, data: Partial<DocData>): void {
    this.writes.push(() => ref.update(data));
  }

  set(ref: MockDocumentReference, data: DocData): void {
    this.writes.push(() => ref.set(data));
  }

  delete(ref: MockDocumentReference): void {
    this.writes.push(() => ref.delete());
  }

  async commit(): Promise<void> {
    for (const w of this.writes) {
      await w();
    }
  }
}

// ─── Write Batch ─────────────────────────────────────────────────────────────

class MockWriteBatch {
  private ops: Array<() => Promise<void>> = [];

  set(ref: MockDocumentReference, data: DocData): this {
    this.ops.push(() => ref.set(data));
    return this;
  }

  update(ref: MockDocumentReference, data: Partial<DocData>): this {
    this.ops.push(() => ref.update(data));
    return this;
  }

  delete(ref: MockDocumentReference): this {
    this.ops.push(() => ref.delete());
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.ops) {
      await op();
    }
  }
}

// ─── Main InMemoryFirestore ──────────────────────────────────────────────────

export class InMemoryFirestore {
  private store: Map<string, Map<string, DocData>> = new Map();

  collection(name: string): MockCollectionReference {
    if (!this.store.has(name)) {
      this.store.set(name, new Map());
    }
    return new MockCollectionReference(this.store.get(name)!, name);
  }

  async runTransaction<T>(callback: (transaction: MockTransaction) => Promise<T>): Promise<T> {
    const transaction = new MockTransaction();
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  }

  batch(): MockWriteBatch {
    return new MockWriteBatch();
  }

  /**
   * Seed a document directly (for test setup).
   * The data is stored as-is (no FieldValue resolution).
   */
  seed(collectionName: string, docId: string, data: DocData): void {
    if (!this.store.has(collectionName)) {
      this.store.set(collectionName, new Map());
    }
    this.store.get(collectionName)!.set(docId, { ...data });
  }

  /**
   * Read a document directly (for test assertions).
   */
  peek(collectionName: string, docId: string): DocData | null {
    return this.store.get(collectionName)?.get(docId) ?? null;
  }

  /**
   * Check whether a document exists.
   */
  exists(collectionName: string, docId: string): boolean {
    return this.store.get(collectionName)?.has(docId) ?? false;
  }
}

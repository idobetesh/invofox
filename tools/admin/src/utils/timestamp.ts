/**
 * Timestamp helpers for admin services (Firestore / API responses)
 */

export function toMillis(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.toMillis === 'function') {
      return (record.toMillis as () => number)();
    }
    if (typeof record.toDate === 'function') {
      return (record.toDate as () => Date)().getTime();
    }
    const secs = record._seconds ?? record.seconds;
    if (typeof secs === 'number') {
      return secs * 1000;
    }
  }

  return 0;
}

/** Resolve best creation timestamp from a Firestore document. */
export function getCreatedAtMillis(
  data: Record<string, unknown>,
  preferredField = 'createdAt'
): number {
  const fields = [
    preferredField,
    'createdAt',
    'generatedAt',
    'startedAt',
    'receivedAt',
    'updatedAt',
  ];
  for (const field of fields) {
    const ms = toMillis(data[field]);
    if (ms > 0) {
      return ms;
    }
  }
  return 0;
}

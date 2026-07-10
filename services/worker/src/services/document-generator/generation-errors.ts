import { isTransientSheetsError } from '../sheets.service';

const TRANSIENT_NETWORK_CODES = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** gRPC status codes for transient Firestore / backend failures */
const TRANSIENT_GRPC_CODES = new Set([4, 10, 13, 14]); // DEADLINE_EXCEEDED, ABORTED, INTERNAL, UNAVAILABLE

/**
 * Whether a document-generation failure is likely transient and safe to retry
 * with the same reserved invoice number.
 */
export function isTransientGenerationError(error: unknown): boolean {
  if (isTransientSheetsError(error)) {
    return true;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as { code?: string | number; response?: { status?: number } };

  if (typeof err.code === 'string' && TRANSIENT_NETWORK_CODES.has(err.code)) {
    return true;
  }

  if (typeof err.code === 'number' && TRANSIENT_GRPC_CODES.has(err.code)) {
    return true;
  }

  const status = err.response?.status;
  return status === 429 || (status !== undefined && status >= 500);
}

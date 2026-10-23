/**
 * Document intent parsing — primary / fallback orchestration
 *
 * Current: OpenAI only (text + audio).
 * Future: pass a fallback provider to withDocumentIntentFallback.
 */

import type { DocumentIntentResult } from '../../../../../../shared/document-intent.types';
import logger from '../../../logger';
import { RateLimitError, AuthError } from '../../llms/types';
import * as openai from './openai';

export { computeMissingFields, hasBlockingMissingFields } from './missing-fields';
export { parseFieldEdit } from './field-parser';
export type { FieldParseResult } from './field-parser';

function formatFallbackReason(error: unknown): string {
  if (error instanceof RateLimitError || error instanceof AuthError) {
    return `${error.constructor.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

async function withDocumentIntentFallback<T extends DocumentIntentResult>(
  primary: () => Promise<T>,
  fallback: (() => Promise<T>) | null,
  fallbackFrom?: 'gemini'
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (!fallback) {
      throw error;
    }

    const fallbackReason = formatFallbackReason(error);
    logger.warn({ fallbackReason }, 'Primary LLM failed, trying fallback provider');
    const result = await fallback();
    return {
      ...result,
      usage: {
        ...result.usage,
        ...(fallbackFrom && { fallbackFrom, fallbackReason }),
      },
    };
  }
}

export async function parseDocumentIntentFromText(text: string): Promise<DocumentIntentResult> {
  return withDocumentIntentFallback(() => openai.parseDocumentIntentFromText(text), null);
}

export async function parseDocumentIntentFromAudio(
  audioBuffer: Buffer
): Promise<DocumentIntentResult> {
  return withDocumentIntentFallback(() => openai.parseDocumentIntentFromAudio(audioBuffer), null);
}

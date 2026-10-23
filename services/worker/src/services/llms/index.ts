/**
 * LLM Service — primary / fallback orchestration
 *
 * Current: OpenAI only (invoice vision extraction).
 * Future: pass a second provider to withExtractionFallback (e.g. alternate model/API).
 */

import type { ExtractionResult, InvoiceExtraction } from './types';
import { RateLimitError, AuthError } from './types';
import * as openai from './openai';
import logger from '../../logger';

export { RateLimitError, AuthError } from './types';
export type { ExtractionResult, InvoiceExtraction } from './types';

function formatFallbackReason(error: unknown): string {
  if (error instanceof RateLimitError || error instanceof AuthError) {
    return `${error.constructor.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Run primary LLM; on failure optionally run fallback and attach fallback metadata.
 */
async function withExtractionFallback(
  primary: () => Promise<ExtractionResult>,
  fallback: (() => Promise<ExtractionResult>) | null,
  fallbackFrom?: 'gemini'
): Promise<ExtractionResult> {
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

/**
 * Extract invoice data from a single image
 */
export async function extractInvoiceData(
  imageBuffer: Buffer,
  fileExtension: string
): Promise<ExtractionResult> {
  return withExtractionFallback(() => openai.extractInvoiceData(imageBuffer, fileExtension), null);
}

/**
 * Extract invoice data from multiple images (multi-page PDFs)
 */
export async function extractInvoiceDataMulti(
  imageBuffers: Buffer[],
  fileExtension: string
): Promise<ExtractionResult> {
  return withExtractionFallback(
    () => openai.extractInvoiceDataMulti(imageBuffers, fileExtension),
    null
  );
}

/**
 * Determine if extraction needs review based on confidence and missing fields
 */
export function needsReview(extraction: InvoiceExtraction): boolean {
  if (extraction.confidence < 0.6) {
    return true;
  }

  if (!extraction.total_amount) {
    return true;
  }

  return false;
}

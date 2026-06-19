/**
 * LLM Service - Hybrid provider with fallback
 *
 * Strategy:
 * 1. Try Gemini (free tier)
 * 2. On any error → fallback to OpenAI (paid, reliable)
 */

import type { ExtractionResult, InvoiceExtraction } from './types';
import { RateLimitError, AuthError } from './types';
import * as gemini from './gemini';
import * as openai from './openai';
import { getConfig } from '../../config';
import logger from '../../logger';

export { RateLimitError, AuthError } from './types';
export type { ExtractionResult, InvoiceExtraction } from './types';

/**
 * Extract invoice data using hybrid LLM strategy
 * - Primary: Gemini (free)
 * - Fallback: OpenAI (paid, reliable)
 */
export async function extractInvoiceData(
  imageBuffer: Buffer,
  fileExtension: string
): Promise<ExtractionResult> {
  const config = getConfig();

  if (!config.geminiApiKey) {
    logger.debug('No Gemini API key, using OpenAI directly');
    return openai.extractInvoiceData(imageBuffer, fileExtension);
  }

  try {
    logger.debug('Attempting Gemini extraction');
    return await gemini.extractInvoiceData(imageBuffer, fileExtension);
  } catch (error) {
    const fallbackReason =
      error instanceof RateLimitError || error instanceof AuthError
        ? `${error.constructor.name}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown error';

    logger.warn({ fallbackReason }, 'Gemini failed, falling back to OpenAI');
    const result = await openai.extractInvoiceData(imageBuffer, fileExtension);
    return {
      ...result,
      usage: {
        ...result.usage,
        fallbackFrom: 'gemini',
        fallbackReason,
      },
    };
  }
}

/**
 * Extract invoice data from multiple images (for multi-page PDFs)
 * Uses hybrid LLM strategy with fallback
 */
export async function extractInvoiceDataMulti(
  imageBuffers: Buffer[],
  fileExtension: string
): Promise<ExtractionResult> {
  const config = getConfig();

  if (!config.geminiApiKey) {
    logger.debug('No Gemini API key, using OpenAI directly');
    return openai.extractInvoiceDataMulti(imageBuffers, fileExtension);
  }

  try {
    logger.debug('Attempting Gemini multi-image extraction');
    return await gemini.extractInvoiceDataMulti(imageBuffers, fileExtension);
  } catch (error) {
    const fallbackReason =
      error instanceof RateLimitError || error instanceof AuthError
        ? `${error.constructor.name}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown error';

    logger.warn({ fallbackReason }, 'Gemini failed, falling back to OpenAI');
    const result = await openai.extractInvoiceDataMulti(imageBuffers, fileExtension);
    return {
      ...result,
      usage: {
        ...result.usage,
        fallbackFrom: 'gemini',
        fallbackReason,
      },
    };
  }
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

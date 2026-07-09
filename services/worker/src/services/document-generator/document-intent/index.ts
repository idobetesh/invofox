/**
 * Document intent parsing — hybrid Gemini primary, OpenAI fallback
 */

import type { DocumentIntentResult } from '../../../../../../shared/document-intent.types';
import { getConfig } from '../../../config';
import logger from '../../../logger';
import { RateLimitError, AuthError } from '../../llms/types';
import * as gemini from './gemini';
import * as openai from './openai';

export { computeMissingFields, hasBlockingMissingFields } from './missing-fields';
export { parseFieldEdit } from './field-parser';
export type { FieldParseResult } from './field-parser';

async function withFallback<T extends DocumentIntentResult>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    const fallbackReason =
      error instanceof RateLimitError || error instanceof AuthError
        ? `${error.constructor.name}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown error';

    logger.warn({ fallbackReason }, 'Gemini document intent failed, falling back to OpenAI');
    const result = await fallback();
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

export async function parseDocumentIntentFromText(text: string): Promise<DocumentIntentResult> {
  const config = getConfig();
  if (!config.geminiApiKey) {
    return openai.parseDocumentIntentFromText(text);
  }
  return withFallback(
    () => gemini.parseDocumentIntentFromText(text),
    () => openai.parseDocumentIntentFromText(text)
  );
}

export async function parseDocumentIntentFromAudio(
  audioBuffer: Buffer
): Promise<DocumentIntentResult> {
  const config = getConfig();
  if (!config.geminiApiKey) {
    return openai.parseDocumentIntentFromAudio(audioBuffer);
  }
  return withFallback(
    () => gemini.parseDocumentIntentFromAudio(audioBuffer),
    () => openai.parseDocumentIntentFromAudio(audioBuffer)
  );
}

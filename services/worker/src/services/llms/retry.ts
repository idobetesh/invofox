/**
 * Retry wrapper for transient LLM HTTP / transport failures (e.g. Premature close from Cloud Run).
 */

import OpenAI from 'openai';
import logger from '../../logger';

const MAX_ATTEMPTS = 5;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isTransientOpenAiError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) {
      return false;
    }
    if (error.status === 429 || error.status === 408) {
      return true;
    }
    if (error.status !== undefined && error.status >= 500) {
      return true;
    }
  }

  const msg = errorMessage(error).toLowerCase();
  return (
    msg.includes('premature close') ||
    msg.includes('invalid response body') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('fetch failed')
  );
}

export async function withOpenAiRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientOpenAiError(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      logger.warn(
        { attempt, maxAttempts: MAX_ATTEMPTS, delayMs, label, error: errorMessage(error) },
        'Transient OpenAI API error, retrying'
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

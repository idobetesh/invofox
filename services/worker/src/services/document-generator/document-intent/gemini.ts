/**
 * Gemini provider for document intent (audio + text)
 */

import { GoogleGenerativeAI, GoogleGenerativeAIResponseError } from '@google/generative-ai';
import type { DocumentIntentResult } from '../../../../../../shared/document-intent.types';
import { getConfig } from '../../../config';
import logger from '../../../logger';
import { DOCUMENT_INTENT_SYSTEM_PROMPT, DOCUMENT_INTENT_TEXT_USER_PROMPT } from './prompts';
import { parseDocumentIntentJson } from './schema';
import { RateLimitError, AuthError } from '../../llms/types';

const PRICE_PER_INPUT_TOKEN = 0.0000001;
const PRICE_PER_OUTPUT_TOKEN = 0.0000004;

let geminiClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    const config = getConfig();
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    geminiClient = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return geminiClient;
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * PRICE_PER_INPUT_TOKEN + outputTokens * PRICE_PER_OUTPUT_TOKEN;
}

function getModel() {
  return getClient().getGenerativeModel({
    model: getConfig().geminiModel,
    generationConfig: { temperature: 0.1 },
  });
}

function buildUsage(inputTokens: number, outputTokens: number): DocumentIntentResult['usage'] {
  const totalTokens = inputTokens + outputTokens;
  return {
    provider: 'gemini',
    totalTokens,
    costUSD: calculateCost(inputTokens, outputTokens),
  };
}

function mapGeminiError(error: unknown): never {
  if (error instanceof GoogleGenerativeAIResponseError) {
    const message = error.message.toLowerCase();
    if (message.includes('429') || message.includes('quota') || message.includes('rate')) {
      throw new RateLimitError('Gemini rate limit exceeded', 'gemini');
    }
    if (
      message.includes('401') ||
      message.includes('api key') ||
      message.includes('unauthorized')
    ) {
      throw new AuthError('Gemini authentication failed', 'gemini');
    }
  }
  throw error;
}

export async function parseDocumentIntentFromText(text: string): Promise<DocumentIntentResult> {
  const model = getModel();
  logger.debug('Sending text to Gemini for document intent');

  try {
    const result = await model.generateContent([
      DOCUMENT_INTENT_SYSTEM_PROMPT,
      DOCUMENT_INTENT_TEXT_USER_PROMPT(text),
    ]);
    const response = result.response;
    const usageMetadata = response.usageMetadata;
    const usage = buildUsage(
      usageMetadata?.promptTokenCount || 0,
      usageMetadata?.candidatesTokenCount || 0
    );
    const responseText = response.text();
    if (!responseText) {
      throw new Error('No response from Gemini');
    }
    return { intent: parseDocumentIntentJson(responseText), usage };
  } catch (error) {
    mapGeminiError(error);
  }
}

export async function parseDocumentIntentFromAudio(
  audioBuffer: Buffer
): Promise<DocumentIntentResult> {
  const model = getModel();
  logger.debug('Sending audio to Gemini for document intent');

  try {
    const result = await model.generateContent([
      DOCUMENT_INTENT_SYSTEM_PROMPT,
      {
        inlineData: {
          mimeType: 'audio/ogg',
          data: audioBuffer.toString('base64'),
        },
      },
      'Parse the spoken request into document intent JSON.',
    ]);
    const response = result.response;
    const usageMetadata = response.usageMetadata;
    const usage = buildUsage(
      usageMetadata?.promptTokenCount || 0,
      usageMetadata?.candidatesTokenCount || 0
    );
    const responseText = response.text();
    if (!responseText) {
      throw new Error('No response from Gemini');
    }
    return { intent: parseDocumentIntentJson(responseText), usage };
  } catch (error) {
    mapGeminiError(error);
  }
}

/**
 * Google Gemini (AI Studio) provider for invoice extraction
 * Uses free tier with fallback on 429
 */

import { GoogleGenerativeAI, GoogleGenerativeAIResponseError } from '@google/generative-ai';
import type { InvoiceExtraction, LLMUsage } from '../../../../../shared/types';
import type { ExtractionResult } from './types';
import { RateLimitError, AuthError } from './types';
import { INVOICE_EXTRACTION_PROMPT, EXTRACTION_USER_PROMPT } from './prompts';
import { getConfig } from '../../config';
import logger from '../../logger';
import { normalizeExtraction, getMimeType } from './utils';

// Gemini 2.0 Flash pricing
// Free tier: 1M tokens/min, 1.5K requests/day (shows $0 effective cost)
// Paid tier: $0.10/1M input, $0.40/1M output
// We calculate actual cost for tracking (useful if you exceed free tier)
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

/**
 * Get configured Gemini model for invoice extraction
 */
function getModel() {
  const genAI = getClient();
  return genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json', // Force JSON output
      temperature: 0.1, // Reduce creativity/deviation
    },
  });
}

export async function extractInvoiceData(
  imageBuffer: Buffer,
  fileExtension: string
): Promise<ExtractionResult> {
  const model = getModel();
  const mimeType = getMimeType(fileExtension);

  logger.debug('Sending image to Gemini for extraction');
  const startTime = Date.now();

  try {
    const result = await model.generateContent([
      INVOICE_EXTRACTION_PROMPT,
      {
        inlineData: {
          mimeType,
          data: imageBuffer.toString('base64'),
        },
      },
      EXTRACTION_USER_PROMPT,
    ]);

    const duration = Date.now() - startTime;
    const response = result.response;

    // Extract token usage (Gemini provides this)
    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const totalTokens = inputTokens + outputTokens;
    const costUSD = calculateCost(inputTokens, outputTokens);

    const usage: LLMUsage = {
      provider: 'gemini',
      inputTokens,
      outputTokens,
      totalTokens,
      costUSD,
    };

    logger.info(
      { provider: 'gemini', durationMs: duration, totalTokens, costUSD: costUSD.toFixed(6) },
      'Gemini extraction completed'
    );

    const text = response.text();

    if (!text) {
      throw new Error('No response from Gemini');
    }

    // Gemini sometimes wraps JSON in markdown code blocks
    const jsonText = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(jsonText) as InvoiceExtraction;

    return {
      extraction: normalizeExtraction(parsed),
      usage,
    };
  } catch (error) {
    // Handle specific Gemini errors
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

    // Check for HTTP 429 in error response
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('429') || msg.includes('resource exhausted') || msg.includes('quota')) {
        throw new RateLimitError('Gemini rate limit exceeded', 'gemini');
      }
    }

    throw error;
  }
}

/**
 * Extract invoice data from multiple images (for multi-page PDFs)
 * Sends all images to Gemini in a single request
 */
export async function extractInvoiceDataMulti(
  imageBuffers: Buffer[],
  fileExtension: string
): Promise<ExtractionResult> {
  const model = getModel();
  const mimeType = getMimeType(fileExtension);

  logger.debug({ imageCount: imageBuffers.length }, 'Sending multiple images to Gemini');
  const startTime = Date.now();

  try {
    // Build prompt with all images
    const promptParts: Array<string | { inlineData: { mimeType: string; data: string } }> = [
      INVOICE_EXTRACTION_PROMPT,
    ];

    // Add all images
    for (const buffer of imageBuffers) {
      promptParts.push({
        inlineData: {
          mimeType,
          data: buffer.toString('base64'),
        },
      });
    }

    promptParts.push(EXTRACTION_USER_PROMPT);

    const result = await model.generateContent(promptParts);

    const duration = Date.now() - startTime;
    const response = result.response;

    // Extract token usage
    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const totalTokens = inputTokens + outputTokens;
    const costUSD = calculateCost(inputTokens, outputTokens);

    const usage: LLMUsage = {
      provider: 'gemini',
      inputTokens,
      outputTokens,
      totalTokens,
      costUSD,
    };

    logger.info(
      {
        provider: 'gemini',
        imageCount: imageBuffers.length,
        durationMs: duration,
        totalTokens,
        costUSD: costUSD.toFixed(6),
      },
      'Gemini multi-image extraction completed'
    );

    const text = response.text();

    if (!text) {
      throw new Error('No response from Gemini');
    }

    // Gemini sometimes wraps JSON in markdown code blocks
    const jsonText = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(jsonText) as InvoiceExtraction;

    return {
      extraction: normalizeExtraction(parsed),
      usage,
    };
  } catch (error) {
    // Handle specific Gemini errors
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

    // Check for HTTP 429 in error response
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('429') || msg.includes('resource exhausted') || msg.includes('quota')) {
        throw new RateLimitError('Gemini rate limit exceeded', 'gemini');
      }
    }

    throw error;
  }
}

export const provider = {
  name: 'gemini',
  extractInvoiceData,
  extractInvoiceDataMulti,
};

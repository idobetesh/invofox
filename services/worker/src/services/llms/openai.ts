/**
 * OpenAI Vision provider for invoice extraction
 */

import OpenAI from 'openai';
import type { InvoiceExtraction, LLMUsage } from '../../../../../shared/types';
import type { ExtractionResult } from './types';
import { RateLimitError, AuthError } from './types';
import { INVOICE_EXTRACTION_PROMPT } from './prompts';
import { getConfig } from '../../config';
import logger from '../../logger';
import { normalizeExtraction, getMimeType } from './utils';
import { withOpenAiRetry } from './retry';

// gpt-4o-mini pricing (as of 2024)
const PRICE_PER_INPUT_TOKEN = 0.00000015; // $0.15 per 1M tokens
const PRICE_PER_OUTPUT_TOKEN = 0.0000006; // $0.60 per 1M tokens

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const config = getConfig();
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
      maxRetries: 0,
      timeout: 120_000,
    });
  }
  return openaiClient;
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * PRICE_PER_INPUT_TOKEN + outputTokens * PRICE_PER_OUTPUT_TOKEN;
}

function bufferToBase64(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

export async function extractInvoiceData(
  imageBuffer: Buffer,
  fileExtension: string
): Promise<ExtractionResult> {
  const openai = getClient();
  const mimeType = getMimeType(fileExtension);
  const imageUrl = bufferToBase64(imageBuffer, mimeType);

  logger.debug('Sending image to OpenAI Vision for extraction');
  const startTime = Date.now();

  try {
    const response = await withOpenAiRetry(
      () =>
        openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: INVOICE_EXTRACTION_PROMPT,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Extract invoice data from this image:',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl,
                    detail: 'high',
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 500,
        }),
      'extractInvoiceData'
    );

    const duration = Date.now() - startTime;

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const costUSD = calculateCost(inputTokens, outputTokens);

    const usage: LLMUsage = {
      provider: 'openai',
      inputTokens,
      outputTokens,
      totalTokens,
      costUSD,
    };

    logger.info(
      { provider: 'openai', durationMs: duration, totalTokens, costUSD: costUSD.toFixed(6) },
      'OpenAI extraction completed'
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(content) as InvoiceExtraction;

    return {
      extraction: normalizeExtraction(parsed),
      usage,
    };
  } catch (error) {
    // Handle specific error types
    if (error instanceof OpenAI.APIError) {
      if (error.status === 429) {
        throw new RateLimitError('OpenAI rate limit exceeded', 'openai');
      }
      if (error.status === 401) {
        throw new AuthError('OpenAI authentication failed', 'openai');
      }
    }
    throw error;
  }
}

/**
 * Extract invoice data from multiple images (for multi-page PDFs)
 * Sends all images to OpenAI in a single request
 */
export async function extractInvoiceDataMulti(
  imageBuffers: Buffer[],
  fileExtension: string
): Promise<ExtractionResult> {
  const openai = getClient();
  const mimeType = getMimeType(fileExtension);

  logger.debug({ imageCount: imageBuffers.length }, 'Sending multiple images to OpenAI');
  const startTime = Date.now();

  try {
    // Build message content with all images using proper OpenAI types
    type TextPart = { type: 'text'; text: string };
    type ImagePart = {
      type: 'image_url';
      image_url: { url: string; detail: 'high' | 'low' | 'auto' };
    };
    type ContentPart = TextPart | ImagePart;

    const contentParts: ContentPart[] = [
      {
        type: 'text',
        text: 'Extract invoice data from these images (multiple pages of the same invoice):',
      },
    ];

    // Add all images
    for (const buffer of imageBuffers) {
      const imageUrl = bufferToBase64(buffer, mimeType);
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: imageUrl,
          detail: 'high',
        },
      });
    }

    const response = await withOpenAiRetry(
      () =>
        openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: INVOICE_EXTRACTION_PROMPT,
            },
            {
              role: 'user',
              content: contentParts,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 500,
        }),
      'extractInvoiceDataMulti'
    );

    const duration = Date.now() - startTime;

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const costUSD = calculateCost(inputTokens, outputTokens);

    const usage: LLMUsage = {
      provider: 'openai',
      inputTokens,
      outputTokens,
      totalTokens,
      costUSD,
    };

    logger.info(
      {
        provider: 'openai',
        imageCount: imageBuffers.length,
        durationMs: duration,
        totalTokens,
        costUSD: costUSD.toFixed(6),
      },
      'OpenAI multi-image extraction completed'
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(content) as InvoiceExtraction;

    return {
      extraction: normalizeExtraction(parsed),
      usage,
    };
  } catch (error) {
    // Handle specific error types
    if (error instanceof OpenAI.APIError) {
      if (error.status === 429) {
        throw new RateLimitError('OpenAI rate limit exceeded', 'openai');
      }
      if (error.status === 401) {
        throw new AuthError('OpenAI authentication failed', 'openai');
      }
    }
    throw error;
  }
}

export const provider = {
  name: 'openai',
  extractInvoiceData,
  extractInvoiceDataMulti,
};

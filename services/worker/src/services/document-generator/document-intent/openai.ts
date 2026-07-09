/**
 * OpenAI provider for document intent (audio primary, Whisper+text tertiary)
 */

import OpenAI from 'openai';
import type { DocumentIntentResult } from '../../../../../../shared/document-intent.types';
import { getConfig } from '../../../config';
import logger from '../../../logger';
import { DOCUMENT_INTENT_SYSTEM_PROMPT, DOCUMENT_INTENT_TEXT_USER_PROMPT } from './prompts';
import { parseDocumentIntentJson } from './schema';
import { RateLimitError, AuthError } from '../../llms/types';

const AUDIO_MODEL = 'gpt-4o-mini-audio-preview';
const TEXT_MODEL = 'gpt-4o-mini';
const WHISPER_MODEL = 'whisper-1';
const PRICE_PER_INPUT_TOKEN = 0.00000015;
const PRICE_PER_OUTPUT_TOKEN = 0.0000006;

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: getConfig().openaiApiKey });
  }
  return openaiClient;
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * PRICE_PER_INPUT_TOKEN + outputTokens * PRICE_PER_OUTPUT_TOKEN;
}

function buildUsage(inputTokens: number, outputTokens: number): DocumentIntentResult['usage'] {
  const totalTokens = inputTokens + outputTokens;
  return {
    provider: 'openai',
    totalTokens,
    costUSD: calculateCost(inputTokens, outputTokens),
  };
}

function mapOpenAiError(error: unknown): never {
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

export async function parseDocumentIntentFromText(text: string): Promise<DocumentIntentResult> {
  const openai = getClient();
  try {
    const response = await openai.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: DOCUMENT_INTENT_SYSTEM_PROMPT },
        { role: 'user', content: DOCUMENT_INTENT_TEXT_USER_PROMPT(text) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 600,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const usage = buildUsage(
      response.usage?.prompt_tokens || 0,
      response.usage?.completion_tokens || 0
    );
    return { intent: parseDocumentIntentJson(content), usage };
  } catch (error) {
    mapOpenAiError(error);
  }
}

export async function parseDocumentIntentFromAudio(
  audioBuffer: Buffer
): Promise<DocumentIntentResult> {
  const openai = getClient();
  const base64 = audioBuffer.toString('base64');

  try {
    const response = await openai.chat.completions.create({
      model: AUDIO_MODEL,
      modalities: ['text'],
      messages: [
        { role: 'system', content: DOCUMENT_INTENT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Parse the spoken request into document intent JSON.' },
            { type: 'input_audio', input_audio: { data: base64, format: 'ogg' } },
          ] as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[],
        },
      ],
      temperature: 0.1,
      max_tokens: 600,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI audio model');
    }

    const usage = buildUsage(
      response.usage?.prompt_tokens || 0,
      response.usage?.completion_tokens || 0
    );
    return { intent: parseDocumentIntentJson(content), usage };
  } catch (audioError) {
    logger.warn({ err: audioError }, 'OpenAI audio model failed, trying Whisper fallback');
    try {
      const file = new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' });
      const transcription = await openai.audio.transcriptions.create({
        model: WHISPER_MODEL,
        file,
        language: 'he',
      });
      const transcript = transcription.text?.trim();
      if (!transcript) {
        throw new Error('Whisper returned empty transcript');
      }
      const result = await parseDocumentIntentFromText(transcript);
      return {
        ...result,
        intent: { ...result.intent, transcript: result.intent.transcript || transcript },
        usage: {
          ...result.usage,
          fallbackReason: 'openai_audio_failed_whisper_text',
        },
      };
    } catch (error) {
      mapOpenAiError(error);
    }
  }
}

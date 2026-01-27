/**
 * Telegram Types & Schemas
 * Core Zod schemas for validating Telegram webhook payloads
 */

import { z } from 'zod';

/**
 * Zod schemas for Telegram types
 */
const TelegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

const TelegramChatSchema = z.object({
  id: z.number(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

const TelegramPhotoSizeSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  width: z.number(),
  height: z.number(),
  file_size: z.number().optional(),
});

const TelegramDocumentSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  file_name: z.string(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

const TelegramMessageSchema = z.object({
  message_id: z.number(),
  from: TelegramUserSchema.optional(),
  chat: TelegramChatSchema,
  date: z.number(),
  text: z.string().optional(),
  photo: z.array(TelegramPhotoSizeSchema).optional(),
  document: TelegramDocumentSchema.optional(),
  caption: z.string().optional(),
});

const TelegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: TelegramUserSchema,
  message: TelegramMessageSchema.optional(),
  chat_instance: z.string(),
  data: z.string().optional(),
});

const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: TelegramMessageSchema.optional(),
  edited_message: TelegramMessageSchema.optional(),
  channel_post: TelegramMessageSchema.optional(),
  edited_channel_post: TelegramMessageSchema.optional(),
  callback_query: TelegramCallbackQuerySchema.optional(),
});

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof TelegramMessageSchema>;
export type TelegramPhotoSize = z.infer<typeof TelegramPhotoSizeSchema>;
export type TelegramDocument = z.infer<typeof TelegramDocumentSchema>;
export type TelegramCallbackQuery = z.infer<typeof TelegramCallbackQuerySchema>;

/**
 * Validate and parse a Telegram update
 * Returns the validated update or null if invalid
 */
export function parseUpdate(data: unknown): TelegramUpdate | null {
  const result = TelegramUpdateSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validate that the update is a valid Telegram update object
 * @deprecated Use parseUpdate() for proper Zod validation
 */
export function isValidUpdate(update: unknown): update is TelegramUpdate {
  return parseUpdate(update) !== null;
}

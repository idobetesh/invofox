/**
 * Broadcast Service
 * Sends push notifications to customers via Telegram and stores history in Firestore.
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { BROADCAST_NOTIFICATIONS_COLLECTION } from '../../../../shared/collections';

export interface BroadcastResult {
  chatId: number;
  success: boolean;
  error?: string;
}

export interface BroadcastRecord {
  id: string;
  message: string;
  imageUrl?: string;
  targets: 'all' | number[];
  status: 'sending' | 'sent' | 'failed';
  createdAt: unknown;
  sentAt?: unknown;
  results: BroadcastResult[];
  successCount: number;
  failureCount: number;
}

export interface CreateBroadcastDto {
  message: string;
  imageUrl?: string;
  targets: 'all' | number[];
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export class BroadcastService {
  constructor(
    private db: Firestore,
    private telegramBotToken: string
  ) {}

  async listBroadcasts(): Promise<BroadcastRecord[]> {
    const snapshot = await this.db
      .collection(BROADCAST_NOTIFICATIONS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as BroadcastRecord);
  }

  /**
   * Create a broadcast record, send to all target chatIds, then update with results.
   */
  async sendBroadcast(dto: CreateBroadcastDto, allChatIds: number[]): Promise<BroadcastRecord> {
    const chatIds =
      dto.targets === 'all'
        ? allChatIds
        : (dto.targets as number[]).filter((id) => allChatIds.includes(id));

    const ref = await this.db.collection(BROADCAST_NOTIFICATIONS_COLLECTION).add({
      message: dto.message,
      ...(dto.imageUrl ? { imageUrl: dto.imageUrl } : {}),
      targets: dto.targets,
      status: 'sending',
      createdAt: FieldValue.serverTimestamp(),
      results: [],
      successCount: 0,
      failureCount: 0,
    });

    const results: BroadcastResult[] = [];

    // Telegram allows ~30 msg/sec globally. Send in batches of 25 with a 1 s
    // gap between batches to stay well within the limit.
    const BATCH_SIZE = 25;
    const BATCH_DELAY_MS = 1000;

    for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
      const batch = chatIds.slice(i, i + BATCH_SIZE);

      const settled = await Promise.allSettled(
        batch.map((chatId) =>
          dto.imageUrl
            ? this.sendPhoto(chatId, dto.imageUrl, dto.message)
            : this.sendMessage(chatId, dto.message)
        )
      );

      settled.forEach((outcome, idx) => {
        const chatId = batch[idx];
        if (outcome.status === 'fulfilled') {
          results.push({ chatId, success: true });
        } else {
          const error = outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error';
          results.push({ chatId, success: false, error });
        }
      });

      // Pause between batches (skip delay after the last batch)
      if (i + BATCH_SIZE < chatIds.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    const status = failureCount === results.length && results.length > 0 ? 'failed' : 'sent';

    await ref.update({
      status,
      sentAt: FieldValue.serverTimestamp(),
      results,
      successCount,
      failureCount,
    });

    const updated = await ref.get();
    return { id: ref.id, ...updated.data() } as BroadcastRecord;
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.telegramBotToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram sendMessage failed (${response.status}): ${body}`);
    }
  }

  private async sendPhoto(chatId: number, photoUrl: string, caption: string): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.telegramBotToken}/sendPhoto`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram sendPhoto failed (${response.status}): ${body}`);
    }
  }
}

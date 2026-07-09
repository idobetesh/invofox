/**
 * Voice message extractor tests
 */

import { extractInvoiceMessagePayload } from '../../src/services/telegram/telegram-invoice-extractors';
import type { TelegramUpdate } from '../../src/services/telegram/telegram-types';

describe('extractInvoiceMessagePayload voice', () => {
  it('extracts voice file id without text', () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 42, is_bot: false, first_name: 'Test', username: 'tester' },
        chat: { id: -1001, type: 'group' as const },
        date: 1700000000,
        voice: {
          file_id: 'voice-file-123',
          file_unique_id: 'unique-voice',
          duration: 3,
        },
      },
    } satisfies TelegramUpdate;

    const payload = extractInvoiceMessagePayload(update);
    expect(payload).not.toBeNull();
    expect(payload?.voiceFileId).toBe('voice-file-123');
    expect(payload?.text).toBeUndefined();
  });
});

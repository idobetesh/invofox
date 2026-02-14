/**
 * Tests for Telegram Invoice Extractors
 * CRITICAL: These tests verify callback routing works correctly
 */

import {
  isInvoiceCallback,
  extractInvoiceCallbackPayload,
} from '../../src/services/telegram/telegram-invoice-extractors';
import type { TelegramUpdate } from '../../src/services/telegram/telegram-types';

describe('Invoice Callback Recognition', () => {
  describe('isInvoiceCallback', () => {
    it('should recognize select_type action', () => {
      const data = JSON.stringify({ action: 'select_type', documentType: 'invoice' });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should recognize select_invoice action (legacy single-select)', () => {
      const data = JSON.stringify({ action: 'select_invoice', invoiceNumber: 'I-2026-100' });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should recognize toggle_invoice action (multi-select)', () => {
      const data = JSON.stringify({ action: 'toggle_invoice', invoiceNumber: 'I-2026-100' });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should recognize confirm_selection action (multi-select)', () => {
      const data = JSON.stringify({ action: 'confirm_selection' });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should recognize show_more action (pagination)', () => {
      const data = JSON.stringify({ action: 'show_more', offset: 10 });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should recognize select_payment action', () => {
      const data = JSON.stringify({ action: 'select_payment', paymentMethod: 'מזומן' });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should recognize confirm action', () => {
      const data = JSON.stringify({ action: 'confirm' });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should recognize cancel action', () => {
      const data = JSON.stringify({ action: 'cancel' });
      expect(isInvoiceCallback(data)).toBe(true);
    });

    it('should reject duplicate detection callbacks', () => {
      const data = JSON.stringify({ action: 'keep_both', chatId: 123, messageId: 456 });
      expect(isInvoiceCallback(data)).toBe(false);
    });

    it('should reject report callbacks', () => {
      const data = JSON.stringify({ action: 'confirm_report', reportId: 'abc123' });
      expect(isInvoiceCallback(data)).toBe(false);
    });

    it('should reject onboarding callbacks', () => {
      const data = JSON.stringify({ action: 'skip_logo' });
      expect(isInvoiceCallback(data)).toBe(false);
    });

    it('should reject invalid JSON', () => {
      const data = 'not valid json';
      expect(isInvoiceCallback(data)).toBe(false);
    });

    it('should reject callbacks without action field', () => {
      const data = JSON.stringify({ invoiceNumber: 'I-2026-100' });
      expect(isInvoiceCallback(data)).toBe(false);
    });

    it('should reject empty data', () => {
      expect(isInvoiceCallback('')).toBe(false);
    });
  });

  describe('extractInvoiceCallbackPayload', () => {
    const createMockUpdate = (
      callbackData: string,
      messageId = 123,
      chatId = 456,
      userId = 789
    ): TelegramUpdate => ({
      update_id: 1,
      callback_query: {
        id: 'callback-123',
        from: {
          id: userId,
          is_bot: false,
          first_name: 'Test',
          last_name: 'User',
          username: 'testuser',
        },
        message: {
          message_id: messageId,
          date: Date.now() / 1000,
          chat: {
            id: chatId,
            type: 'private',
          },
          from: {
            id: 999,
            is_bot: true,
            first_name: 'Bot',
          },
          text: 'Test message',
        },
        chat_instance: 'chat-instance-123',
        data: callbackData,
      },
    });

    it('should extract toggle_invoice callback payload', () => {
      const data = JSON.stringify({ action: 'toggle_invoice', invoiceNumber: 'I-2026-100' });
      const update = createMockUpdate(data);

      const payload = extractInvoiceCallbackPayload(update);

      expect(payload).toBeDefined();
      expect(payload?.callbackQueryId).toBe('callback-123');
      expect(payload?.chatId).toBe(456);
      expect(payload?.userId).toBe(789);
      expect(payload?.data).toBe(data);
      expect(payload?.messageId).toBe(123);
      expect(payload?.username).toBe('testuser');
    });

    it('should extract confirm_selection callback payload', () => {
      const data = JSON.stringify({ action: 'confirm_selection' });
      const update = createMockUpdate(data);

      const payload = extractInvoiceCallbackPayload(update);

      expect(payload).toBeDefined();
      expect(payload?.data).toBe(data);
    });

    it('should extract show_more callback payload with offset', () => {
      const data = JSON.stringify({ action: 'show_more', offset: 10 });
      const update = createMockUpdate(data);

      const payload = extractInvoiceCallbackPayload(update);

      expect(payload).toBeDefined();
      expect(payload?.data).toBe(data);
    });

    it('should handle user without username (use full name)', () => {
      const data = JSON.stringify({ action: 'toggle_invoice', invoiceNumber: 'I-2026-100' });
      const update = createMockUpdate(data);
      // Remove username
      if (update.callback_query?.from) {
        delete update.callback_query.from.username;
      }

      const payload = extractInvoiceCallbackPayload(update);

      expect(payload).toBeDefined();
      expect(payload?.username).toBe('Test User');
    });

    it('should return null if callback_query is missing', () => {
      const update = { update_id: 1 } as TelegramUpdate;
      const payload = extractInvoiceCallbackPayload(update);
      expect(payload).toBeNull();
    });

    it('should return null if callback data is missing', () => {
      const update = createMockUpdate('');
      if (update.callback_query) {
        update.callback_query.data = undefined;
      }
      const payload = extractInvoiceCallbackPayload(update);
      expect(payload).toBeNull();
    });

    it('should return null if message is missing', () => {
      const update = createMockUpdate('{}');
      if (update.callback_query) {
        update.callback_query.message = undefined;
      }
      const payload = extractInvoiceCallbackPayload(update);
      expect(payload).toBeNull();
    });
  });

  describe('Callback Action Coverage', () => {
    /**
     * THIS TEST ENSURES ALL INVOICE CALLBACK ACTIONS ARE RECOGNIZED
     * If you add a new action to the worker invoice controller,
     * YOU MUST UPDATE THIS TEST or the webhook-handler won't route it correctly!
     */
    it('should recognize ALL invoice callback actions used by worker', () => {
      const allInvoiceActions = [
        // Document type selection
        { action: 'select_type', documentType: 'invoice' },

        // Invoice selection (legacy single-select)
        { action: 'select_invoice', invoiceNumber: 'I-2026-100' },

        // Multi-invoice selection
        { action: 'toggle_invoice', invoiceNumber: 'I-2026-100' },
        { action: 'confirm_selection' },
        { action: 'show_more', offset: 10 },

        // Payment method selection
        { action: 'select_payment', paymentMethod: 'מזומן' },

        // Confirmation
        { action: 'confirm' },
        { action: 'cancel' },
      ];

      // CRITICAL: All these must return true, or production will break!
      allInvoiceActions.forEach((actionData) => {
        const data = JSON.stringify(actionData);
        const result = isInvoiceCallback(data);

        if (!result) {
          throw new Error(
            `CALLBACK ROUTING BUG: Action '${actionData.action}' is not recognized by webhook-handler! ` +
              `This will cause "Invalid callback payload" errors in production. ` +
              `Add '${actionData.action}' to the isInvoiceCallback() function.`
          );
        }

        expect(result).toBe(true);
      });
    });
  });
});

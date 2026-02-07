/**
 * Unit tests for Telegram Service
 */

import * as telegramService from '../../src/services/telegram.service';
import type { TelegramMessage } from '../../../../shared/types';

// Mock fetch globally
global.fetch = jest.fn();

// Mock config
jest.mock('../../src/config', () => ({
  getConfig: () => ({
    telegramBotToken: 'test-bot-token',
  }),
}));

describe('Telegram Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should send message and return message object', async () => {
      const mockMessage: TelegramMessage = {
        message_id: 12345,
        chat: { id: -123456, type: 'group', title: 'Test Chat' },
        date: 1234567890,
        text: 'Test message',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: mockMessage,
        }),
      });

      const result = await telegramService.sendMessage(-123456, 'Test message');

      expect(result).toEqual(mockMessage);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/sendMessage',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -123456,
            text: 'Test message',
          }),
        })
      );
    });

    it('should send message with reply markup', async () => {
      const mockMessage: TelegramMessage = {
        message_id: 12345,
        chat: { id: -123456, type: 'group', title: 'Test Chat' },
        date: 1234567890,
        text: 'Test message',
      };

      const keyboard = {
        inline_keyboard: [[{ text: 'Button', callback_data: 'data' }]],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: mockMessage,
        }),
      });

      await telegramService.sendMessage(-123456, 'Test message', { replyMarkup: keyboard });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/sendMessage',
        expect.objectContaining({
          body: JSON.stringify({
            chat_id: -123456,
            text: 'Test message',
            reply_markup: keyboard,
          }),
        })
      );
    });

    it('should handle API error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          description: 'Bad Request: message text is empty',
        }),
      });

      await expect(telegramService.sendMessage(-123456, '')).rejects.toThrow(
        'Failed to send message: Bad Request: message text is empty'
      );
    });
  });

  describe('deleteMessage', () => {
    it('should delete message successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: true,
        }),
      });

      await telegramService.deleteMessage(-123456, 12345);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/deleteMessage',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -123456,
            message_id: 12345,
          }),
        })
      );
    });

    it('should handle API error when deleting message', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          description: 'Bad Request: message to delete not found',
        }),
      });

      await expect(telegramService.deleteMessage(-123456, 99999)).rejects.toThrow(
        'Failed to delete message: Bad Request: message to delete not found'
      );
    });

    it('should handle network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(telegramService.deleteMessage(-123456, 12345)).rejects.toThrow('Network error');
    });
  });

  describe('editMessageText', () => {
    it('should edit message text successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: true,
        }),
      });

      await telegramService.editMessageText(-123456, 12345, 'Updated text');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/editMessageText',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -123456,
            message_id: 12345,
            text: 'Updated text',
          }),
        })
      );
    });

    it('should edit message with parse mode', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: true,
        }),
      });

      await telegramService.editMessageText(-123456, 12345, '*Bold text*', {
        parseMode: 'Markdown',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/editMessageText',
        expect.objectContaining({
          body: JSON.stringify({
            chat_id: -123456,
            message_id: 12345,
            text: '*Bold text*',
            parse_mode: 'Markdown',
          }),
        })
      );
    });
  });

  describe('answerCallbackQuery', () => {
    it('should answer callback query with text', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: true,
        }),
      });

      await telegramService.answerCallbackQuery('callback-123', { text: '✅ Success' });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/answerCallbackQuery',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: 'callback-123',
            text: '✅ Success',
          }),
        })
      );
    });

    it('should answer callback query with alert', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: true,
        }),
      });

      await telegramService.answerCallbackQuery('callback-123', {
        text: '❌ Error',
        showAlert: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/answerCallbackQuery',
        expect.objectContaining({
          body: JSON.stringify({
            callback_query_id: 'callback-123',
            text: '❌ Error',
            show_alert: true,
          }),
        })
      );
    });
  });

  describe('editMessageReplyMarkup', () => {
    it('should edit message reply markup', async () => {
      const newKeyboard = {
        inline_keyboard: [[{ text: 'New Button', callback_data: 'new_data' }]],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: true,
        }),
      });

      await telegramService.editMessageReplyMarkup(-123456, 12345, newKeyboard);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/editMessageReplyMarkup',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -123456,
            message_id: 12345,
            reply_markup: newKeyboard,
          }),
        })
      );
    });
  });
});

/**
 * Telegram Service Unit Tests
 */

import {
  isPhotoMessage,
  isDocumentMessage,
  isPdfDocument,
  isFileSizeValid,
  isCommand,
  isValidUpdate,
  getBestPhoto,
  extractTaskPayload,
  extractDocumentTaskPayload,
} from '../src/services/telegram.service';
import type { TelegramUpdate, TelegramDocument } from '../src/services/telegram.service';
import type { TelegramPhotoSize } from '../../../shared/types';

describe('Telegram Service', () => {
  // Shared test data
  const mockPhoto: TelegramPhotoSize = {
    file_id: 'photo_123',
    file_unique_id: 'unique_123',
    width: 1920,
    height: 1080,
    file_size: 500000,
  };

  const mockSmallPhoto: TelegramPhotoSize = {
    file_id: 'photo_small',
    file_unique_id: 'unique_small',
    width: 320,
    height: 240,
    file_size: 10000,
  };

  describe('Photo Handling', () => {
    describe('isPhotoMessage', () => {
      it('should return true for updates with photos', () => {
        const update: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'group', title: 'Test Group' },
            from: { id: 67890, is_bot: false, first_name: 'John', username: 'johndoe' },
            photo: [mockSmallPhoto, mockPhoto],
          },
        };
        expect(isPhotoMessage(update)).toBe(true);
      });

      it('should return false for updates without photos', () => {
        const textUpdate: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'private' },
            text: 'Hello',
          },
        };
        expect(isPhotoMessage(textUpdate)).toBe(false);
      });

      it('should return false for empty photo array', () => {
        const emptyPhotoUpdate: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'private' },
            photo: [],
          },
        };
        expect(isPhotoMessage(emptyPhotoUpdate)).toBe(false);
      });
    });

    describe('getBestPhoto', () => {
      it('should return the largest photo by file_size', () => {
        const photos = [mockSmallPhoto, mockPhoto];
        expect(getBestPhoto(photos)).toBe(mockPhoto);
      });

      it('should throw for empty array', () => {
        expect(() => getBestPhoto([])).toThrow('No photos provided');
      });

      it('should use dimensions if file_size not available', () => {
        const photoNoSize: TelegramPhotoSize = {
          file_id: 'photo_big',
          file_unique_id: 'unique_big',
          width: 3840,
          height: 2160,
        };
        const photos = [mockSmallPhoto, photoNoSize];
        expect(getBestPhoto(photos)).toBe(photoNoSize);
      });
    });

    describe('extractTaskPayload', () => {
      it('should extract payload from photo message', () => {
        const update: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'group', title: 'Test Group' },
            from: { id: 67890, is_bot: false, first_name: 'John', username: 'johndoe' },
            photo: [mockSmallPhoto, mockPhoto],
          },
        };
        const payload = extractTaskPayload(update);
        expect(payload).toEqual({
          chatId: 12345,
          messageId: 1,
          fileId: 'photo_123',
          uploaderUsername: 'johndoe',
          uploaderFirstName: 'John',
          chatTitle: 'Test Group',
          receivedAt: '2024-01-01T00:00:00.000Z',
        });
      });

      it('should return null for non-photo messages', () => {
        const textUpdate: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'private' },
            text: 'Hello',
          },
        };
        expect(extractTaskPayload(textUpdate)).toBeNull();
      });

      it('should handle missing user info', () => {
        const anonymousUpdate: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'group', title: 'Test' },
            photo: [mockPhoto],
          },
        };
        const payload = extractTaskPayload(anonymousUpdate);
        expect(payload?.uploaderUsername).toBe('unknown');
        expect(payload?.uploaderFirstName).toBe('Unknown');
      });
    });
  });

  describe('Document Handling', () => {
    describe('isDocumentMessage', () => {
      it('should return true for message with document', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1234567890,
            document: {
              file_id: 'doc123',
              file_unique_id: 'unique123',
              file_name: 'invoice.pdf',
              mime_type: 'application/pdf',
              file_size: 1024000,
            },
          },
        };

        expect(isDocumentMessage(update)).toBe(true);
      });

      it('should return false for photo message', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1234567890,
            photo: [mockPhoto],
          },
        };

        expect(isDocumentMessage(update)).toBe(false);
      });

      it('should return false for text message', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1234567890,
            text: 'Hello world',
          },
        };

        expect(isDocumentMessage(update)).toBe(false);
      });

      it('should return false for channel_post with no document', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          channel_post: {
            message_id: 456,
            chat: { id: 789, type: 'channel' },
            date: 1234567890,
            text: 'Channel message',
          },
        };

        expect(isDocumentMessage(update)).toBe(false);
      });
    });

    describe('isPdfDocument', () => {
      it('should return true for PDF with correct MIME type', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1234567890,
            document: {
              file_id: 'doc123',
              file_unique_id: 'unique123',
              file_name: 'invoice.pdf',
              mime_type: 'application/pdf',
              file_size: 1024000,
            },
          },
        };

        expect(isPdfDocument(update)).toBe(true);
      });

      it('should return true for PDF with .pdf extension (fallback)', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1234567890,
            document: {
              file_id: 'doc123',
              file_unique_id: 'unique123',
              file_name: 'Invoice.PDF', // uppercase extension
              // No mime_type
              file_size: 1024000,
            },
          },
        };

        expect(isPdfDocument(update)).toBe(true);
      });

      it('should return false for non-PDF document', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1234567890,
            document: {
              file_id: 'doc123',
              file_unique_id: 'unique123',
              file_name: 'document.docx',
              mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              file_size: 1024000,
            },
          },
        };

        expect(isPdfDocument(update)).toBe(false);
      });

      it('should return false for photo message', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1234567890,
            photo: [mockPhoto],
          },
        };

        expect(isPdfDocument(update)).toBe(false);
      });
    });

    describe('isFileSizeValid', () => {
      it('should return true for file under 5MB', () => {
        const document: TelegramDocument = {
          file_id: 'doc123',
          file_unique_id: 'unique123',
          file_name: 'invoice.pdf',
          mime_type: 'application/pdf',
          file_size: 4 * 1024 * 1024,
        };

        expect(isFileSizeValid(document)).toBe(true);
      });

      it('should return true for file exactly at 5MB limit', () => {
        const document: TelegramDocument = {
          file_id: 'doc123',
          file_unique_id: 'unique123',
          file_name: 'invoice.pdf',
          mime_type: 'application/pdf',
          file_size: 5 * 1024 * 1024,
        };

        expect(isFileSizeValid(document)).toBe(true);
      });

      it('should return false for file over 5MB', () => {
        const document: TelegramDocument = {
          file_id: 'doc123',
          file_unique_id: 'unique123',
          file_name: 'invoice.pdf',
          mime_type: 'application/pdf',
          file_size: 6 * 1024 * 1024,
        };

        expect(isFileSizeValid(document)).toBe(false);
      });

      it('should return true if file_size is not provided', () => {
        const document: TelegramDocument = {
          file_id: 'doc123',
          file_unique_id: 'unique123',
          file_name: 'invoice.pdf',
          mime_type: 'application/pdf',
        };

        expect(isFileSizeValid(document)).toBe(true);
      });
    });

    describe('extractDocumentTaskPayload', () => {
      it('should extract payload from document message', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            from: {
              id: 111,
              is_bot: false,
              first_name: 'John',
              last_name: 'Doe',
              username: 'johndoe',
            },
            chat: {
              id: 789,
              type: 'private',
              first_name: 'John',
            },
            date: 1704067200,
            document: {
              file_id: 'doc123',
              file_unique_id: 'unique123',
              file_name: 'invoice.pdf',
              mime_type: 'application/pdf',
              file_size: 1024000,
            },
          },
        };

        const payload = extractDocumentTaskPayload(update);

        expect(payload).not.toBeNull();
        expect(payload?.chatId).toBe(789);
        expect(payload?.messageId).toBe(456);
        expect(payload?.fileId).toBe('doc123');
        expect(payload?.uploaderUsername).toBe('johndoe');
        expect(payload?.uploaderFirstName).toBe('John');
        expect(payload?.chatTitle).toBe('John');
        expect(payload?.receivedAt).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should handle group chat', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            from: {
              id: 111,
              is_bot: false,
              first_name: 'John',
            },
            chat: {
              id: 789,
              type: 'group',
              title: 'Finance Team',
            },
            date: 1704067200,
            document: {
              file_id: 'doc123',
              file_unique_id: 'unique123',
              file_name: 'invoice.pdf',
            },
          },
        };

        const payload = extractDocumentTaskPayload(update);

        expect(payload).not.toBeNull();
        expect(payload?.chatTitle).toBe('Finance Team');
        expect(payload?.uploaderUsername).toBe('John');
      });

      it('should return null for non-document message', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          message: {
            message_id: 456,
            chat: { id: 789, type: 'private' },
            date: 1704067200,
            text: 'Hello',
          },
        };

        const payload = extractDocumentTaskPayload(update);

        expect(payload).toBeNull();
      });

      it('should handle channel_post with document', () => {
        const update: TelegramUpdate = {
          update_id: 123,
          channel_post: {
            message_id: 456,
            chat: {
              id: 789,
              type: 'channel',
              title: 'Invoices Channel',
            },
            date: 1704067200,
            document: {
              file_id: 'doc123',
              file_unique_id: 'unique123',
              file_name: 'invoice.pdf',
            },
          },
        };

        const payload = extractDocumentTaskPayload(update);

        expect(payload).not.toBeNull();
        expect(payload?.chatId).toBe(789);
        expect(payload?.chatTitle).toBe('Invoices Channel');
        expect(payload?.uploaderFirstName).toBe('Unknown');
      });
    });
  });

  describe('Utilities', () => {
    describe('isCommand', () => {
      it('should return true for command messages', () => {
        const commandUpdate: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'private' },
            text: '/start',
          },
        };
        expect(isCommand(commandUpdate)).toBe(true);
      });

      it('should return false for regular text', () => {
        const textUpdate: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'private' },
            text: 'Hello',
          },
        };
        expect(isCommand(textUpdate)).toBe(false);
      });
    });

    describe('isValidUpdate', () => {
      it('should return true for valid update', () => {
        const update: TelegramUpdate = {
          update_id: 123456,
          message: {
            message_id: 1,
            date: 1704067200,
            chat: { id: 12345, type: 'group', title: 'Test Group' },
            from: { id: 67890, is_bot: false, first_name: 'John', username: 'johndoe' },
            photo: [mockPhoto],
          },
        };
        expect(isValidUpdate(update)).toBe(true);
      });

      it('should return false for null', () => {
        expect(isValidUpdate(null)).toBe(false);
      });

      it('should return false for non-object', () => {
        expect(isValidUpdate('string')).toBe(false);
        expect(isValidUpdate(123)).toBe(false);
      });

      it('should return false for object without update_id', () => {
        expect(isValidUpdate({ message: {} })).toBe(false);
      });
    });
  });
});

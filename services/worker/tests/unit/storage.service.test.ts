/**
 * Storage Service Tests
 * Tests for Cloud Storage path generation and per-customer isolation
 */

import { uploadInvoiceImage, getMimeType } from '../../src/services/storage.service';

// Mock dependencies
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockFile = jest.fn((_path: string) => ({
  save: mockSave,
}));
const mockBucket = jest.fn((_bucketName: string) => ({
  file: mockFile,
}));
const mockStorage = jest.fn(() => ({
  bucket: mockBucket,
}));

jest.mock('@google-cloud/storage', () => {
  return {
    Storage: jest.fn(() => mockStorage()),
  };
});

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({
    storageBucket: 'test-bucket',
  })),
}));

describe('Storage Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMimeType', () => {
    it('should return correct MIME type for JPEG', () => {
      expect(getMimeType('jpg')).toBe('image/jpeg');
      expect(getMimeType('jpeg')).toBe('image/jpeg');
    });

    it('should return correct MIME type for PNG', () => {
      expect(getMimeType('png')).toBe('image/png');
    });

    it('should return correct MIME type for WebP', () => {
      expect(getMimeType('webp')).toBe('image/webp');
    });

    it('should return correct MIME type for HEIC', () => {
      expect(getMimeType('heic')).toBe('image/heic');
      expect(getMimeType('heif')).toBe('image/heif');
    });

    it('should return correct MIME type for PDF', () => {
      expect(getMimeType('pdf')).toBe('application/pdf');
    });

    it('should return default MIME type for unknown extensions', () => {
      expect(getMimeType('unknown')).toBe('application/octet-stream');
    });

    it('should handle case-insensitive extensions', () => {
      expect(getMimeType('JPG')).toBe('image/jpeg');
      expect(getMimeType('PNG')).toBe('image/png');
    });
  });

  describe('uploadInvoiceImage', () => {
    const buffer = Buffer.from('test-image-data');
    const chatId = -1001234567;
    const messageId = 12345;
    const receivedAt = '2026-01-18T10:00:00.000Z';

    it('should upload image with per-customer path isolation', async () => {
      const result = await uploadInvoiceImage(buffer, 'jpg', chatId, messageId, receivedAt);

      // Verify file path includes chatId for customer isolation
      const actualPath = mockFile.mock.calls[0][0] as string;
      expect(actualPath).toMatch(
        /^invoices\/-1001234567\/2026\/01\/invoice_-1001234567_12345_\d+\.jpg$/
      );
      expect(actualPath).toContain('invoices/-1001234567/');
      expect(actualPath).toContain('/2026/01/');

      // Verify returned values
      expect(result.fileId).toBe(actualPath);
      expect(result.webViewLink).toBe(`https://storage.googleapis.com/test-bucket/${actualPath}`);
    });

    it('should include filenameSuffix in path when provided', async () => {
      const suffix = 'page_1_of_3';
      await uploadInvoiceImage(buffer, 'jpg', chatId, messageId, receivedAt, suffix);

      const actualPath = mockFile.mock.calls[0][0] as string;
      expect(actualPath).toMatch(
        /^invoices\/-1001234567\/2026\/01\/invoice_-1001234567_12345_\d+_page_1_of_3\.jpg$/
      );
      expect(actualPath).toContain('_page_1_of_3');
    });

    it('should create different paths for different customers', async () => {
      const chatIdA = -1001111111;
      const chatIdB = -1002222222;

      // Upload for Customer A
      await uploadInvoiceImage(buffer, 'jpg', chatIdA, messageId, receivedAt);
      const pathA = mockFile.mock.calls[0][0] as string;

      // Upload for Customer B
      await uploadInvoiceImage(buffer, 'jpg', chatIdB, messageId, receivedAt);
      const pathB = mockFile.mock.calls[1][0] as string;

      // Verify different paths
      expect(pathA).toContain('invoices/-1001111111/');
      expect(pathB).toContain('invoices/-1002222222/');
      expect(pathA).not.toBe(pathB);
    });

    it('should handle PDF files correctly', async () => {
      await uploadInvoiceImage(buffer, 'pdf', chatId, messageId, receivedAt);

      const path = mockFile.mock.calls[0][0] as string;
      expect(path).toMatch(/\.pdf$/);
      expect(path).toContain(`invoices/${chatId}/`);
    });

    it('should handle HEIC files correctly', async () => {
      await uploadInvoiceImage(buffer, 'heic', chatId, messageId, receivedAt);

      const path = mockFile.mock.calls[0][0] as string;
      expect(path).toMatch(/\.heic$/);
      expect(path).toContain(`invoices/${chatId}/`);
    });

    it('should include metadata in uploaded file', async () => {
      await uploadInvoiceImage(buffer, 'jpg', chatId, messageId, receivedAt);

      expect(mockSave).toHaveBeenCalledWith(buffer, {
        metadata: {
          contentType: 'image/jpeg',
          metadata: {
            telegram_chat_id: chatId.toString(),
            telegram_message_id: messageId.toString(),
            received_at: receivedAt,
          },
        },
      });
    });
  });
});

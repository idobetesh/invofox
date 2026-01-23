/**
 * Business Config Service Tests
 * Tests for uploadLogo with updateConfig parameter
 */

import { uploadLogo } from '../../src/services/business-config/config.service';

// Mock Storage
const mockSave = jest.fn();
const mockFile = jest.fn(() => ({
  save: mockSave,
}));
const mockBucket = jest.fn(() => ({
  file: mockFile,
}));

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({
    bucket: mockBucket,
  })),
}));

// Mock Firestore
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockDoc = jest.fn(() => ({
  set: mockSet,
  update: mockUpdate,
}));
const mockCollection = jest.fn(() => ({
  doc: mockDoc,
}));

jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => ({
    collection: mockCollection,
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => ({ _methodName: 'serverTimestamp' })),
  },
}));

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

describe('uploadLogo', () => {
  const buffer = Buffer.from('test image data');
  const filename = 'logo.png';
  const bucketName = 'test-bucket';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
    mockSet.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  describe('with updateConfig=true (default)', () => {
    it('should upload logo and update business_config', async () => {
      const chatId = 123456;

      const url = await uploadLogo(buffer, filename, bucketName, chatId);

      // Should upload to storage
      expect(mockBucket).toHaveBeenCalledWith(bucketName);
      expect(mockFile).toHaveBeenCalledWith(`logos/${chatId}/${filename}`);
      expect(mockSave).toHaveBeenCalledWith(buffer, {
        contentType: 'image/png',
      });

      // Should return correct URL
      expect(url).toBe(`https://storage.googleapis.com/${bucketName}/logos/${chatId}/${filename}`);

      // Should update business_config
      expect(mockCollection).toHaveBeenCalledWith('business_config');
      expect(mockDoc).toHaveBeenCalledWith(`chat_${chatId}`);
      expect(mockSet).toHaveBeenCalledWith(
        {
          business: { logoUrl: url },
          updatedAt: { _methodName: 'serverTimestamp' },
        },
        { merge: true }
      );
    });

    it('should upload logo without chatId and update default config', async () => {
      await uploadLogo(buffer, filename, bucketName);

      // Should upload to default logo folder
      expect(mockFile).toHaveBeenCalledWith(`logos/${filename}`);

      // Should update default business_config
      expect(mockDoc).toHaveBeenCalledWith('default');
      expect(mockSet).toHaveBeenCalled();
    });

    it('should handle JPEG files', async () => {
      const jpegFilename = 'logo.jpeg';

      await uploadLogo(buffer, jpegFilename, bucketName, 123456);

      expect(mockSave).toHaveBeenCalledWith(buffer, {
        contentType: 'image/jpeg',
      });
    });

    it('should handle JPG files', async () => {
      const jpgFilename = 'logo.jpg';

      await uploadLogo(buffer, jpgFilename, bucketName, 123456);

      expect(mockSave).toHaveBeenCalledWith(buffer, {
        contentType: 'image/jpeg',
      });
    });
  });

  describe('with updateConfig=false (onboarding)', () => {
    it('should upload logo but skip business_config update', async () => {
      const chatId = 123456;

      const url = await uploadLogo(buffer, filename, bucketName, chatId, false);

      // Should upload to storage
      expect(mockBucket).toHaveBeenCalledWith(bucketName);
      expect(mockFile).toHaveBeenCalledWith(`logos/${chatId}/${filename}`);
      expect(mockSave).toHaveBeenCalledWith(buffer, {
        contentType: 'image/png',
      });

      // Should return correct URL
      expect(url).toBe(`https://storage.googleapis.com/${bucketName}/logos/${chatId}/${filename}`);

      // Should NOT update business_config
      expect(mockCollection).not.toHaveBeenCalled();
      expect(mockDoc).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should skip config update even without chatId', async () => {
      await uploadLogo(buffer, filename, bucketName, undefined, false);

      // Should upload to storage
      expect(mockSave).toHaveBeenCalled();

      // Should NOT update business_config
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should handle different file types when skipping config update', async () => {
      await uploadLogo(buffer, 'logo.jpg', bucketName, 123456, false);

      expect(mockSave).toHaveBeenCalledWith(buffer, {
        contentType: 'image/jpeg',
      });
      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should propagate storage upload errors', async () => {
      mockSave.mockRejectedValue(new Error('Storage upload failed'));

      await expect(uploadLogo(buffer, filename, bucketName, 123456)).rejects.toThrow(
        'Storage upload failed'
      );
    });

    it('should propagate Firestore update errors when updateConfig=true', async () => {
      mockSet.mockRejectedValue(new Error('Firestore update failed'));

      await expect(uploadLogo(buffer, filename, bucketName, 123456, true)).rejects.toThrow(
        'Firestore update failed'
      );
    });

    it('should not throw Firestore errors when updateConfig=false', async () => {
      mockSet.mockRejectedValue(new Error('Firestore update failed'));

      // Should succeed because we skip the Firestore update
      await expect(uploadLogo(buffer, filename, bucketName, 123456, false)).resolves.toBeTruthy();
    });
  });
});

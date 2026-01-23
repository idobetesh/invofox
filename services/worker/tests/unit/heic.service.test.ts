/**
 * HEIC Service Unit Tests
 */

import { convertHEICToJPEG, isHEICBuffer } from '../../src/services/heic.service';

describe('HEIC Service', () => {
  describe('isHEICBuffer', () => {
    it('should return true for HEIC buffer with "heic" brand', () => {
      // Create a mock HEIC buffer with proper magic bytes
      // HEIC files start with: [size][ftyp][brand]
      const buffer = Buffer.alloc(12);
      buffer.write('....ftyp', 0); // size placeholder + ftyp
      buffer.write('heic', 8); // brand

      expect(isHEICBuffer(buffer)).toBe(true);
    });

    it('should return true for HEIC buffer with "heif" brand', () => {
      const buffer = Buffer.alloc(12);
      buffer.write('....ftyp', 0);
      buffer.write('heif', 8);

      expect(isHEICBuffer(buffer)).toBe(true);
    });

    it('should return true for HEIC buffer with "mif1" brand', () => {
      const buffer = Buffer.alloc(12);
      buffer.write('....ftyp', 0);
      buffer.write('mif1', 8);

      expect(isHEICBuffer(buffer)).toBe(true);
    });

    it('should return true for HEIC buffer with "msf1" brand', () => {
      const buffer = Buffer.alloc(12);
      buffer.write('....ftyp', 0);
      buffer.write('msf1', 8);

      expect(isHEICBuffer(buffer)).toBe(true);
    });

    it('should return false for non-HEIC buffer', () => {
      // JPEG magic bytes
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

      expect(isHEICBuffer(buffer)).toBe(false);
    });

    it('should return false for buffer too small', () => {
      const buffer = Buffer.alloc(8); // Less than 12 bytes

      expect(isHEICBuffer(buffer)).toBe(false);
    });

    it('should return false for buffer with wrong ftyp', () => {
      const buffer = Buffer.alloc(12);
      buffer.write('....xxxx', 0); // wrong ftyp
      buffer.write('heic', 8);

      expect(isHEICBuffer(buffer)).toBe(false);
    });
  });

  describe('convertHEICToJPEG', () => {
    // Note: These tests require actual HEIC files or mocks
    // For now, we'll test error handling

    it('should throw error for invalid buffer', async () => {
      const invalidBuffer = Buffer.from('not a valid image');

      await expect(convertHEICToJPEG(invalidBuffer)).rejects.toThrow(
        /Failed to convert HEIC image/
      );
    });

    it('should throw error for non-HEIC buffer', async () => {
      // Create a JPEG buffer (starts with 0xFFD8)
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      await expect(convertHEICToJPEG(jpegBuffer)).rejects.toThrow(/Failed to convert HEIC image/);
    });

    // If you have a sample HEIC file for testing, uncomment and adjust:
    /*
    it('should convert HEIC to JPEG successfully', async () => {
      const heicPath = path.join(__dirname, 'fixtures', 'sample.heic');
      const heicBuffer = fs.readFileSync(heicPath);

      const result = await convertHEICToJPEG(heicBuffer);

      expect(result.extension).toBe('jpeg');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);

      // Verify it's a valid JPEG (starts with 0xFFD8)
      expect(result.buffer[0]).toBe(0xff);
      expect(result.buffer[1]).toBe(0xd8);
    });

    it('should maintain good quality after conversion', async () => {
      const heicPath = path.join(__dirname, 'fixtures', 'sample.heic');
      const heicBuffer = fs.readFileSync(heicPath);

      const result = await convertHEICToJPEG(heicBuffer);

      // Check that the converted size is reasonable (not too compressed)
      // This depends on your source image, adjust as needed
      expect(result.buffer.length).toBeGreaterThan(10000); // At least 10KB
    });
    */
  });
});

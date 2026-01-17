/**
 * HEIC/HEIF image conversion service
 * Converts HEIC/HEIF images to JPEG for LLM compatibility
 */

import sharp from 'sharp';
import logger from '../logger';

export interface ConvertedImage {
  buffer: Buffer;
  extension: string; // 'jpeg'
}

/**
 * Convert HEIC/HEIF image to JPEG
 * Maintains quality while ensuring compatibility with both Gemini and OpenAI
 */
export async function convertHEICToJPEG(heicBuffer: Buffer): Promise<ConvertedImage> {
  const log = logger.child({ function: 'convertHEICToJPEG' });

  try {
    log.info('Converting HEIC/HEIF image to JPEG');

    // Convert to JPEG with high quality
    const jpegBuffer = await sharp(heicBuffer)
      .jpeg({
        quality: 95, // High quality for invoice text clarity
        mozjpeg: true, // Use mozjpeg for better compression
      })
      .toBuffer();

    log.info(
      {
        originalSize: heicBuffer.length,
        convertedSize: jpegBuffer.length,
        compressionRatio: (jpegBuffer.length / heicBuffer.length).toFixed(2),
      },
      'HEIC conversion complete'
    );

    return {
      buffer: jpegBuffer,
      extension: 'jpeg',
    };
  } catch (error) {
    log.error({ error }, 'Failed to convert HEIC image');
    throw new Error(`Failed to convert HEIC image: ${error}`);
  }
}

/**
 * Check if a buffer is a HEIC/HEIF image by inspecting its magic bytes
 */
export function isHEICBuffer(buffer: Buffer): boolean {
  // HEIC files start with specific magic bytes
  // ftyp box at offset 4-8 should contain 'heic' or 'heif' or 'mif1'
  if (buffer.length < 12) {
    return false;
  }

  const ftyp = buffer.toString('ascii', 4, 8);
  const brand = buffer.toString('ascii', 8, 12);

  return (
    ftyp === 'ftyp' &&
    (brand === 'heic' || brand === 'heif' || brand === 'mif1' || brand === 'msf1')
  );
}

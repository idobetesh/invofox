/**
 * Logo processing service
 * Converts square/rectangular logos to circular PNGs with transparent backgrounds
 */

import sharp from 'sharp';
import logger from '../../logger';

/**
 * Process logo to make it circular
 * Crops the image into a perfect circle with transparent background
 * @param buffer - Original image buffer
 * @returns Processed circular image buffer
 */
export async function processLogoForCircularDisplay(buffer: Buffer): Promise<Buffer> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      // Can't process, return original
      return buffer;
    }

    // Use the smaller dimension to ensure the entire image fits in the circle
    const size = Math.min(metadata.width, metadata.height);

    // Create circular mask SVG
    const circleMask = Buffer.from(
      `<svg width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
      </svg>`
    );

    // Resize image to square if needed
    const squareImage = await image
      .resize(size, size, {
        fit: 'cover',
        position: 'center',
      })
      .toBuffer();

    // Apply circular mask
    const circularLogo = await sharp(squareImage)
      .composite([
        {
          input: circleMask,
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();

    logger.info(
      { originalSize: `${metadata.width}x${metadata.height}`, circularSize: size },
      'Processed logo into circular shape'
    );
    return circularLogo;
  } catch (error) {
    logger.warn({ error }, 'Failed to process logo, using original');
    return buffer;
  }
}

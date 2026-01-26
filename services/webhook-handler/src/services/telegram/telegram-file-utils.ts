/**
 * Telegram File Utilities
 * Helper functions for working with Telegram files (photos, documents)
 */

import type { TelegramPhotoSize, TelegramDocument } from './telegram-types';

/**
 * Get the best quality photo from the array
 * Telegram sends multiple sizes, we want the largest one
 */
export function getBestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  if (photos.length === 0) {
    throw new Error('No photos provided');
  }

  // Sort by file_size descending (largest first), fallback to dimensions
  return photos.reduce((best, current) => {
    const bestSize = best.file_size || best.width * best.height;
    const currentSize = current.file_size || current.width * current.height;
    return currentSize > bestSize ? current : best;
  });
}

/**
 * Validate if document file size is within limits
 * Maximum: 5 MB
 */
export function isFileSizeValid(document: TelegramDocument): boolean {
  const MAX_FILE_SIZE_MB = 5;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  if (!document.file_size) {
    // If size not available, allow (will be checked after download)
    return true;
  }
  return document.file_size <= MAX_FILE_SIZE_BYTES;
}

/**
 * PDF processing service
 * Handles PDF metadata extraction, encryption detection, and conversion to images
 */

import { PDFDocument } from 'pdf-lib';
import { fromBuffer } from 'pdf2pic';
import logger from '../logger';

const MAX_PAGES = 5;

export interface PDFInfo {
  pageCount: number;
  isEncrypted: boolean;
  title?: string;
}

export interface ConvertedPage {
  pageNumber: number;
  buffer: Buffer;
  extension: string; // 'png'
}

/**
 * Get PDF metadata without loading full content
 * Detects encryption and page count
 */
export async function getPDFInfo(pdfBuffer: Buffer): Promise<PDFInfo> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, {
      ignoreEncryption: false,
      updateMetadata: false,
    });

    return {
      pageCount: pdfDoc.getPageCount(),
      isEncrypted: false, // If we got here, it's not encrypted
      title: pdfDoc.getTitle(),
    };
  } catch (error) {
    // Check if error is due to encryption
    if (error instanceof Error && error.message.toLowerCase().includes('encrypt')) {
      logger.warn('PDF is encrypted');
      return {
        pageCount: 0,
        isEncrypted: true,
      };
    }
    throw error;
  }
}

/**
 * Convert PDF pages to PNG images
 * Only converts up to MAX_PAGES (5 pages)
 */
export async function convertPDFToImages(
  pdfBuffer: Buffer,
  maxPages: number = MAX_PAGES
): Promise<ConvertedPage[]> {
  const log = logger.child({ function: 'convertPDFToImages' });

  // Configure pdf2pic
  const converter = fromBuffer(pdfBuffer, {
    density: 200, // DPI (200 is good balance of quality/size)
    format: 'png', // Output format
    width: 2000, // Max width (maintains aspect ratio)
    height: 2000, // Max height
  });

  const pagesToConvert = Math.min(maxPages, MAX_PAGES);
  log.info({ pagesToConvert }, 'Converting PDF pages to images');

  const convertedPages: ConvertedPage[] = [];

  for (let pageNum = 1; pageNum <= pagesToConvert; pageNum++) {
    try {
      const result = await converter(pageNum, { responseType: 'buffer' });

      if (result.buffer) {
        convertedPages.push({
          pageNumber: pageNum,
          buffer: result.buffer,
          extension: 'png',
        });

        log.debug({ pageNum, bufferSize: result.buffer.length }, 'Page converted');
      }
    } catch (error) {
      log.error({ pageNum, error }, 'Failed to convert page');
      throw new Error(`Failed to convert page ${pageNum}: ${error}`);
    }
  }

  log.info({ pagesConverted: convertedPages.length }, 'PDF conversion complete');
  return convertedPages;
}

/**
 * PDF Service Unit Tests
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfService from '../src/services/pdf.service';

// Mock pdf2pic since it requires GraphicsMagick/ImageMagick installed on the system
const mockFromBuffer = jest.fn();
jest.mock('pdf2pic', () => ({
  fromBuffer: (buffer: Buffer) => mockFromBuffer(buffer),
}));

// Default mock implementation for valid PDFs
beforeEach(() => {
  mockFromBuffer.mockImplementation(() => {
    return jest.fn((pageNum: number) => {
      // Return a fake PNG buffer (PNG magic bytes + minimal data)
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return Promise.resolve({
        buffer: Buffer.concat([pngMagic, Buffer.from(`page-${pageNum}`)]),
        name: `page-${pageNum}.png`,
        size: 100,
      });
    });
  });
});

describe('PDF Service', () => {
  describe('getPDFInfo', () => {
    it('should extract metadata from valid PDF', async () => {
      // Create a simple test PDF
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([600, 400]);
      page.drawText('Test Invoice', { x: 50, y: 350, size: 30 });
      pdfDoc.setTitle('Test Invoice Title');

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      const info = await pdfService.getPDFInfo(pdfBuffer);

      expect(info.isEncrypted).toBe(false);
      expect(info.pageCount).toBe(1);
      expect(info.title).toBe('Test Invoice Title');
    });

    it('should detect encrypted PDF', async () => {
      // Create an encrypted PDF
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([600, 400]);

      // Note: pdf-lib doesn't directly support encryption, so we'll simulate
      // the error by testing with a malformed buffer that triggers encryption error
      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      // Mock the PDFDocument.load to throw encryption error
      const mockLoad = jest.spyOn(PDFDocument, 'load').mockRejectedValueOnce(
        new Error('PDF is encrypted')
      );

      const info = await pdfService.getPDFInfo(pdfBuffer);

      expect(info.isEncrypted).toBe(true);
      expect(info.pageCount).toBe(0);

      mockLoad.mockRestore();
    });

    it('should handle multi-page PDFs', async () => {
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([600, 400]); // Page 1
      pdfDoc.addPage([600, 400]); // Page 2
      pdfDoc.addPage([600, 400]); // Page 3

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      const info = await pdfService.getPDFInfo(pdfBuffer);

      expect(info.isEncrypted).toBe(false);
      expect(info.pageCount).toBe(3);
    });
  });

  describe('convertPDFToImages', () => {
    it('should convert single page PDF to PNG', async () => {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([600, 400]);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      page.drawText('Invoice #12345', { x: 50, y: 350, size: 20, font });

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      const convertedPages = await pdfService.convertPDFToImages(pdfBuffer, 1);

      expect(convertedPages).toHaveLength(1);
      expect(convertedPages[0].pageNumber).toBe(1);
      expect(convertedPages[0].extension).toBe('png');
      expect(convertedPages[0].buffer).toBeInstanceOf(Buffer);
      expect(convertedPages[0].buffer.length).toBeGreaterThan(0);
    });

    it('should convert multi-page PDF to multiple PNGs', async () => {
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([600, 400]); // Page 1
      pdfDoc.addPage([600, 400]); // Page 2
      pdfDoc.addPage([600, 400]); // Page 3

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      const convertedPages = await pdfService.convertPDFToImages(pdfBuffer, 3);

      expect(convertedPages).toHaveLength(3);
      expect(convertedPages[0].pageNumber).toBe(1);
      expect(convertedPages[1].pageNumber).toBe(2);
      expect(convertedPages[2].pageNumber).toBe(3);

      // All should be PNG buffers
      convertedPages.forEach((page) => {
        expect(page.extension).toBe('png');
        expect(page.buffer).toBeInstanceOf(Buffer);
        expect(page.buffer.length).toBeGreaterThan(0);
      });
    });

    it('should respect page limit of 5', async () => {
      const pdfDoc = await PDFDocument.create();
      // Create 10 pages
      for (let i = 0; i < 10; i++) {
        pdfDoc.addPage([600, 400]);
      }

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      // Request 10 pages but should only get 5 (MAX_PAGES limit)
      const convertedPages = await pdfService.convertPDFToImages(pdfBuffer, 10);

      expect(convertedPages).toHaveLength(5);
      expect(convertedPages[4].pageNumber).toBe(5);
    });

    it('should handle maxPages parameter less than 5', async () => {
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([600, 400]);
      pdfDoc.addPage([600, 400]);
      pdfDoc.addPage([600, 400]);

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      const convertedPages = await pdfService.convertPDFToImages(pdfBuffer, 2);

      expect(convertedPages).toHaveLength(2);
    });

    it('should throw error for invalid PDF buffer', async () => {
      const invalidBuffer = Buffer.from('not a valid pdf');

      // Mock pdf2pic to throw for invalid input
      mockFromBuffer.mockImplementation(() => {
        return jest.fn(() => {
          return Promise.reject(new Error('Invalid PDF'));
        });
      });

      await expect(pdfService.convertPDFToImages(invalidBuffer, 1)).rejects.toThrow();
    });
  });
});

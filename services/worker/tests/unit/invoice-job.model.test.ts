/**
 * Unit tests for Invoice Job Model
 * Tests Zod schema validation for invoice_jobs collection
 */

import { InvoiceJobSchema } from '../../src/models/invoice-job.model';
import { Timestamp } from '@google-cloud/firestore';

describe('Invoice Job Model', () => {
  const baseInvoiceJob = {
    telegramChatId: -123456,
    telegramMessageId: 789,
    telegramFileId: 'file_123',
    status: 'processed' as const,
    attempts: 1,
    currency: 'ILS',
    receivedAt: '2026-01-27T10:00:00Z',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  describe('vatAmount field', () => {
    it('should accept vatAmount as number', () => {
      const data = {
        ...baseInvoiceJob,
        vatAmount: 17.5,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vatAmount).toBe(17.5);
      }
    });

    it('should accept vatAmount as null', () => {
      const data = {
        ...baseInvoiceJob,
        vatAmount: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vatAmount).toBeNull();
      }
    });

    it('should accept vatAmount as undefined', () => {
      const data = {
        ...baseInvoiceJob,
        vatAmount: undefined,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vatAmount).toBeUndefined();
      }
    });

    it('should accept missing vatAmount field', () => {
      const data = {
        ...baseInvoiceJob,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vatAmount).toBeUndefined();
      }
    });

    it('should reject vatAmount as string', () => {
      const data = {
        ...baseInvoiceJob,
        vatAmount: '17.5',
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('optional nullable fields', () => {
    it('should accept vendorName as null', () => {
      const data = {
        ...baseInvoiceJob,
        vendorName: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vendorName).toBeNull();
      }
    });

    it('should accept totalAmount as null', () => {
      const data = {
        ...baseInvoiceJob,
        totalAmount: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalAmount).toBeNull();
      }
    });

    it('should accept currency as null (with default)', () => {
      const data = {
        ...baseInvoiceJob,
        currency: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      // Note: null is accepted but default is not applied when value is explicitly null
    });

    it('should accept invoiceDate as null', () => {
      const data = {
        ...baseInvoiceJob,
        invoiceDate: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoiceDate).toBeNull();
      }
    });

    it('should accept invoiceNumber as null', () => {
      const data = {
        ...baseInvoiceJob,
        invoiceNumber: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoiceNumber).toBeNull();
      }
    });

    it('should accept category as null', () => {
      const data = {
        ...baseInvoiceJob,
        category: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.category).toBeNull();
      }
    });

    it('should accept confidence as null', () => {
      const data = {
        ...baseInvoiceJob,
        confidence: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.confidence).toBeNull();
      }
    });

    it('should accept driveFileId as null', () => {
      const data = {
        ...baseInvoiceJob,
        driveFileId: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.driveFileId).toBeNull();
      }
    });

    it('should accept driveLink as null', () => {
      const data = {
        ...baseInvoiceJob,
        driveLink: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.driveLink).toBeNull();
      }
    });

    it('should accept sheetRowId as null', () => {
      const data = {
        ...baseInvoiceJob,
        sheetRowId: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sheetRowId).toBeNull();
      }
    });

    it('should accept chatTitle as null', () => {
      const data = {
        ...baseInvoiceJob,
        chatTitle: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chatTitle).toBeNull();
      }
    });

    it('should accept uploaderUsername as null', () => {
      const data = {
        ...baseInvoiceJob,
        uploaderUsername: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uploaderUsername).toBeNull();
      }
    });

    it('should accept uploaderFirstName as null', () => {
      const data = {
        ...baseInvoiceJob,
        uploaderFirstName: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uploaderFirstName).toBeNull();
      }
    });

    it('should accept all optional fields as null', () => {
      const data = {
        ...baseInvoiceJob,
        vendorName: null,
        totalAmount: null,
        vatAmount: null,
        currency: null,
        invoiceNumber: null,
        invoiceDate: null,
        category: null,
        confidence: null,
        driveFileId: null,
        driveLink: null,
        sheetRowId: null,
        chatTitle: null,
        uploaderUsername: null,
        uploaderFirstName: null,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields as undefined', () => {
      const data = {
        ...baseInvoiceJob,
        vendorName: undefined,
        totalAmount: undefined,
        vatAmount: undefined,
        invoiceNumber: undefined,
        invoiceDate: undefined,
        category: undefined,
        confidence: undefined,
        driveFileId: undefined,
        driveLink: undefined,
        sheetRowId: undefined,
        chatTitle: undefined,
        uploaderUsername: undefined,
        uploaderFirstName: undefined,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('required fields', () => {
    it('should require telegramChatId', () => {
      const data = {
        ...baseInvoiceJob,
        telegramChatId: undefined,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should require status', () => {
      const data = {
        ...baseInvoiceJob,
        status: undefined,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const data = {
        ...baseInvoiceJob,
        status: 'invalid_status',
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('complete invoice with all fields', () => {
    it('should accept fully populated invoice', () => {
      const data = {
        ...baseInvoiceJob,
        vendorName: 'Test Vendor',
        totalAmount: 1000,
        vatAmount: 170,
        invoiceNumber: 'INV-001',
        invoiceDate: '2026-01-27',
        category: 'Office Supplies',
        confidence: 0.95,
        driveFileId: 'drive_123',
        driveLink: 'https://drive.google.com/file/d/123',
        sheetRowId: 5,
        chatTitle: 'Test Group',
        uploaderUsername: 'testuser',
        uploaderFirstName: 'Test',
        lastStep: 'ack' as const,
      };

      const result = InvoiceJobSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vendorName).toBe('Test Vendor');
        expect(result.data.totalAmount).toBe(1000);
        expect(result.data.vatAmount).toBe(170);
      }
    });
  });
});

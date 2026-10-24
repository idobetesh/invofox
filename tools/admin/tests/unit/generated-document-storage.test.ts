import { InvoiceService } from '../../src/services/invoice.service';
import { InvoiceReceiptService } from '../../src/services/invoice-receipt.service';
import { ReceiptService } from '../../src/services/receipt.service';
import {
  BUSINESS_CONFIG_COLLECTION,
  GENERATED_INVOICES_COLLECTION,
  GENERATED_RECEIPTS_COLLECTION,
  GENERATED_INVOICE_RECEIPTS_COLLECTION,
} from '../../../../shared/collections';

// Exercise the real creation/upload helpers with in-memory Firestore and Storage.
const mockRecords = new Map<string, Record<string, any>>();
const mockFileSave = jest.fn().mockResolvedValue(undefined);
const mockFile = jest.fn((_path: string) => ({ save: mockFileSave }));
const mockStorage = { bucket: jest.fn(() => ({ file: mockFile })) };

function mockRef(collection: string, id: string) {
  const key = `${collection}/${id}`;
  return {
    id,
    get: async () => ({ exists: mockRecords.has(key), id, data: () => mockRecords.get(key) }),
    set: async (data: Record<string, any>) => {
      mockRecords.set(key, { ...data });
    },
    update: async (data: Record<string, any>) => {
      mockRecords.set(key, { ...mockRecords.get(key), ...data });
    },
  };
}

const mockFirestore = {
  collection: (name: string) => {
    const filters: Array<[string, string, any]> = [];
    let limit = Infinity;
    const query = {
      doc: (id: string) => mockRef(name, id),
      where: (field: string, op: string, value: any) => {
        filters.push([field, op, value]);
        return query;
      },
      limit: (value: number) => {
        limit = value;
        return query;
      },
      get: async () => {
        const docs = [...mockRecords.entries()]
          .filter(
            ([key, data]) =>
              key.startsWith(name + '/') &&
              filters.every(([field, op, value]) =>
                op === 'in' ? value.includes(data[field]) : data[field] === value
              )
          )
          .slice(0, limit)
          .map(([key, data]) => ({ id: key.slice(name.length + 1), data: () => data }));
        return { empty: docs.length === 0, docs };
      },
    };
    return query;
  },
  runTransaction: async (callback: (transaction: any) => Promise<any>) =>
    callback({
      get: (ref: any) => ref.get(),
      set: (ref: any, data: any) => ref.set(data),
      update: (ref: any, data: any) => ref.update(data),
    }),
};

jest.mock('../../src/services/gcp-clients.service', () => ({
  getFirestoreClient: () => mockFirestore,
  getStorageClient: () => mockStorage,
}));
jest.mock('../../src/services/counter.service', () => ({
  CounterService: jest.fn(() => ({
    getNextDocumentNumber: async (_chatId: number, type: string) =>
      ({ invoice: 'I-2026-3', invoice_receipt: 'IR-2026-3', receipt: 'R-2026-3' })[type],
  })),
}));
jest.mock('../../src/services/invoice-pdf.service', () => ({
  InvoicePDFService: jest.fn(() => ({ generateInvoicePDF: async () => Buffer.from('pdf') })),
}));
jest.mock('../../src/services/invoice-receipt-pdf.service', () => ({
  InvoiceReceiptPDFService: jest.fn(() => ({
    generateInvoiceReceiptPDF: async () => Buffer.from('pdf'),
  })),
}));
jest.mock('../../src/services/receipt-pdf.service', () => ({
  ReceiptPDFService: jest.fn(() => ({ generateReceiptPDF: async () => Buffer.from('pdf') })),
}));

describe('Admin generated document storage', () => {
  const chatId = 12345;
  const params = {
    chatId,
    customerName: 'Customer',
    description: 'Service',
    amount: 100,
    currency: 'ILS',
    date: '2026-10-24',
    paymentMethod: 'cash',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockRecords.clear();
    mockRecords.set(`${BUSINESS_CONFIG_COLLECTION}/chat_${chatId}`, {
      business: { name: 'Business' },
    });
    for (const number of ['I-2025-1', 'I-2025-2']) {
      mockRecords.set(`${GENERATED_INVOICES_COLLECTION}/chat_${chatId}_${number}`, {
        ...params,
        invoiceNumber: number,
        documentType: 'invoice',
        customerTaxId: '123456789',
        paidAmount: 0,
        remainingBalance: 100,
        paymentStatus: 'unpaid',
        relatedReceiptIds: [],
        storagePath: `${chatId}/2025/${number}.pdf`,
        storageUrl: `https://storage.googleapis.com/legacy/${chatId}/2025/${number}.pdf`,
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['invoice', 'invoice_receipt', 'receipt', 'multi_invoice_receipt'])(
    'uploads %s to the same UUID path saved in Firestore, preserving legacy PDFs',
    async (type) => {
      let collection: string;
      let number: string;
      let result: { pdfUrl: string };
      if (type === 'invoice') {
        collection = GENERATED_INVOICES_COLLECTION;
        number = 'I-2026-3';
        result = await new InvoiceService().generateInvoice(params);
      } else if (type === 'invoice_receipt') {
        collection = GENERATED_INVOICE_RECEIPTS_COLLECTION;
        number = 'IR-2026-3';
        result = await new InvoiceReceiptService().generateInvoiceReceipt(params);
      } else {
        collection = GENERATED_RECEIPTS_COLLECTION;
        number = 'R-2026-3';
        const service = new ReceiptService();
        result =
          type === 'receipt'
            ? await service.generateReceiptForInvoice({
                chatId,
                invoiceNumber: 'I-2025-1',
                paymentAmount: 50,
                paymentMethod: 'cash',
                date: params.date,
              })
            : await service.generateMultiInvoiceReceipt({
                chatId,
                invoiceNumbers: ['I-2025-1', 'I-2025-2'],
                paymentMethod: 'cash',
                date: params.date,
              });
      }

      const record = mockRecords.get(`${collection}/chat_${chatId}_${number}`)!;
      expect(record.invoiceNumber).toBe(number);
      expect(record.storagePath).toMatch(
        /^12345\/\d{4}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/
      );
      expect(mockFile).toHaveBeenCalledTimes(1);
      expect(mockFile).toHaveBeenCalledWith(record.storagePath);
      expect(mockFileSave).toHaveBeenCalled();
      expect(result.pdfUrl).toBe(record.storageUrl);
      expect(result.pdfUrl.endsWith('/' + record.storagePath)).toBe(true);
      for (const number of ['I-2025-1', 'I-2025-2']) {
        const legacy = mockRecords.get(
          `${GENERATED_INVOICES_COLLECTION}/chat_${chatId}_${number}`
        )!;
        expect(legacy.storagePath).toBe(`${chatId}/2025/${number}.pdf`);
        expect(legacy.storageUrl).toBe(
          `https://storage.googleapis.com/legacy/${chatId}/2025/${number}.pdf`
        );
      }
    }
  );
});

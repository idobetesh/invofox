/**
 * Idempotent append: transient client errors must not create duplicate sheet rows.
 */

const mockValuesGet = jest.fn();
const mockValuesAppend = jest.fn();
const mockSpreadsheetsGet = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn(() => ({})),
    },
    sheets: jest.fn(() => ({
      spreadsheets: {
        values: {
          get: mockValuesGet,
          update: jest.fn().mockResolvedValue({ data: {} }),
          append: mockValuesAppend,
        },
        get: mockSpreadsheetsGet,
        batchUpdate: jest.fn().mockResolvedValue({ data: {} }),
      },
    })),
  },
}));

jest.mock('../../src/services/business-config/config.service', () => ({
  getBusinessConfig: jest.fn().mockResolvedValue({
    business: { sheetId: 'test-sheet-id' },
  }),
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({ adminSheetId: undefined })),
}));

import type { GeneratedInvoiceSheetRow } from '../../../../shared/types';
import { appendGeneratedInvoiceRow } from '../../src/services/sheets.service';

const streamError = Object.assign(new Error('Premature close'), {
  code: 'ERR_STREAM_PREMATURE_CLOSE',
});

const sampleGeneratedRow: GeneratedInvoiceSheetRow = {
  invoice_number: 'IR-2026-5',
  document_type: 'חשבונית-קבלה',
  date: '10/07/2026',
  customer_name: 'בידרקה',
  customer_tax_id: '',
  description: 'ספר',
  amount: 1234,
  payment_method: '',
  generated_by: 'user',
  generated_at: '2026-07-10T12:00:00.000Z',
  pdf_link: 'https://example.com/IR-2026-5.pdf',
  currency: 'ILS',
  related_invoice: '',
  input_method: 'Voice',
};

function mockGeneratedTabReady(): void {
  mockSpreadsheetsGet.mockResolvedValue({
    data: { sheets: [{ properties: { title: 'Generated Invoices' } }] },
  });
  mockValuesGet.mockImplementation(({ range }: { range: string }) => {
    if (range === "'Generated Invoices'!A:A") {
      return Promise.resolve({
        data: { values: [['Invoice #'], [sampleGeneratedRow.invoice_number]] },
      });
    }
    return Promise.resolve({
      data: { values: [['Invoice #', 'Type', 'Date']] },
    });
  });
}

describe('append idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('appendGeneratedInvoiceRow does not duplicate when append flakes but row was written', async () => {
    mockGeneratedTabReady();
    mockValuesAppend.mockRejectedValue(streamError);

    const rowId = await appendGeneratedInvoiceRow(-1001234567, sampleGeneratedRow);

    expect(rowId).toBe(2);
    expect(mockValuesAppend).toHaveBeenCalledTimes(1);
  });
});

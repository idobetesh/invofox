/**
 * ensureInvoicesTab regression: when values.get flakes but Invoices tab exists,
 * appendRow must still succeed (metadata check skips header sync).
 */

const mockValuesGet = jest.fn();
const mockValuesAppend = jest.fn();
const mockSpreadsheetsGet = jest.fn();
const mockBatchUpdate = jest.fn();

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
        batchUpdate: mockBatchUpdate,
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

import type { SheetRow } from '../../../../shared/processing.types';
import { appendRow } from '../../src/services/sheets.service';

const streamError = Object.assign(new Error('Premature close'), {
  code: 'ERR_STREAM_PREMATURE_CLOSE',
});

const sampleRow: SheetRow = {
  received_at: "'09/07/2026, 12:00:00",
  invoice_date: "'09/07/2026",
  amount: '100',
  currency: 'ILS',
  invoice_number: 'INV-1',
  vendor_name: 'Acme',
  category: 'services',
  uploader: 'user',
  chat_name: 'Test Chat',
  drive_link: 'https://example.com/file.pdf',
  status: 'processed',
  llm_provider: 'openai' as const,
  total_tokens: 10,
  cost_usd: 0.001,
};

describe('ensureInvoicesTab metadata fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValuesAppend.mockResolvedValue({
      data: { updates: { updatedRange: 'Invoices!A2:K2' } },
    });
  });

  it('appendRow succeeds when values.get flakes but Invoices tab exists in metadata', async () => {
    jest.useFakeTimers();
    try {
      mockValuesGet.mockRejectedValue(streamError);
      mockSpreadsheetsGet.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Invoices' } }, { properties: { title: 'Other' } }],
        },
      });

      const rowIdPromise = appendRow(-1001234567, sampleRow);
      await jest.runAllTimersAsync();
      const rowId = await rowIdPromise;

      expect(rowId).toBe(2);
      expect(mockValuesGet).toHaveBeenCalledTimes(5);
      expect(mockSpreadsheetsGet).toHaveBeenCalled();
      expect(mockBatchUpdate).not.toHaveBeenCalled();
      expect(mockValuesAppend).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('appendRow tries to create tab when values.get fails and metadata has no Invoices tab', async () => {
    mockValuesGet.mockRejectedValue(
      Object.assign(new Error('Unable to parse range'), { code: 400 })
    );
    mockSpreadsheetsGet.mockResolvedValue({
      data: { sheets: [{ properties: { title: 'Sheet1' } }] },
    });
    mockBatchUpdate.mockResolvedValue({ data: {} });

    await appendRow(-1001234567, sampleRow);

    expect(mockBatchUpdate).toHaveBeenCalled();
    expect(mockValuesAppend).toHaveBeenCalled();
  });

  it('appendRow does not duplicate when append flakes but row was written', async () => {
    mockValuesGet.mockImplementation(({ range }: { range: string }) => {
      if (range === 'Invoices!J:J') {
        return Promise.resolve({
          data: { values: [['Link'], [sampleRow.drive_link]] },
        });
      }
      return Promise.resolve({
        data: { values: [['Received At', 'Invoice Date', 'Amount']] },
      });
    });
    mockSpreadsheetsGet.mockResolvedValue({
      data: { sheets: [{ properties: { title: 'Invoices' } }] },
    });
    mockValuesAppend.mockRejectedValue(streamError);

    const rowId = await appendRow(-1001234567, sampleRow);

    expect(rowId).toBe(2);
    expect(mockValuesAppend).toHaveBeenCalledTimes(1);
  });
});

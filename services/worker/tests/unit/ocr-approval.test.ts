import { processInvoice } from '../../src/services/invoice.service';
import * as store from '../../src/services/firestore.service';
import * as telegram from '../../src/services/telegram.service';
import * as storage from '../../src/services/storage.service';
import * as llm from '../../src/services/llm.service';

jest.mock('../../src/services/firestore.service');
jest.mock('../../src/services/telegram.service');
jest.mock('../../src/services/storage.service');
jest.mock('../../src/services/llm.service');
jest.mock('../../src/services/sheets.service');
jest.mock('../../src/services/pdf.service');
jest.mock('../../src/services/heic.service');
jest.mock('../../src/services/feature-flags', () => ({ featureFlags: { getValue: jest.fn() } }));

const mockGetApproval = jest.fn();
const payload = {
  chatId: 123,
  messageId: 1,
  fileId: 'test-file',
  uploaderUsername: 'test',
  uploaderFirstName: 'Test',
  chatTitle: 'Test',
  receivedAt: '2026-10-24T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (store.getFirestore as jest.Mock).mockReturnValue({
    collection: () => ({ doc: () => ({ get: mockGetApproval }) }),
  });
});

it.each([undefined, 'suspended', 'banned', 'unknown'])(
  'blocks OCR before any side effects when approval is %s',
  async (status) => {
    mockGetApproval.mockResolvedValue({ exists: status !== undefined, data: () => ({ status }) });
    expect(await processInvoice(payload)).toEqual({
      success: false,
      alreadyProcessed: false,
      rejectionReason: 'unapproved_chat',
    });
    expect(store.claimJob).not.toHaveBeenCalled();
    expect(store.markJobPendingRetry).not.toHaveBeenCalled();
    expect(telegram.downloadFileById).not.toHaveBeenCalled();
    expect(storage.uploadInvoiceImage).not.toHaveBeenCalled();
    expect(llm.extractInvoiceData).not.toHaveBeenCalled();
    expect(llm.extractInvoiceDataMulti).not.toHaveBeenCalled();
  }
);

it('permits approved OCR and rechecks approval on the next task after revocation', async () => {
  mockGetApproval.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) });
  (store.claimJob as jest.Mock).mockResolvedValue({ claimed: false });
  expect(await processInvoice(payload)).toMatchObject({ alreadyProcessed: true });
  expect(store.claimJob).toHaveBeenCalledTimes(1);
  mockGetApproval.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'banned' }) });
  expect(await processInvoice({ ...payload, messageId: 2 })).toMatchObject({
    rejectionReason: 'unapproved_chat',
  });
  expect(store.claimJob).toHaveBeenCalledTimes(1);
});

it('fails closed on approval lookup failure without starting the pipeline', async () => {
  mockGetApproval.mockRejectedValueOnce(new Error('Firestore unavailable'));
  await expect(processInvoice(payload)).rejects.toThrow('Firestore unavailable');
  expect(store.claimJob).not.toHaveBeenCalled();
  expect(telegram.downloadFileById).not.toHaveBeenCalled();
});

import { getFirestore } from '../../src/services/firestore.service';

jest.mock('../../src/services/firestore.service');
jest.mock('../../src/logger', () => ({ info: jest.fn(), error: jest.fn() }));

describe('Upload chat approval', () => {
  let isChatApproved: (chatId: number) => Promise<boolean>;
  const mockGet = jest.fn();

  beforeAll(() => {
    jest.useFakeTimers();
    // Load after fake timers so the cache maintenance interval cannot hold Jest open.
    isChatApproved = require('../../src/services/approved-chats.service').isChatApproved;
    (getFirestore as jest.Mock).mockReturnValue({
      collection: () => ({ doc: () => ({ get: mockGet }) }),
    });
  });

  afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each([
    [1, undefined, false],
    [2, 'suspended', false],
    [3, 'banned', false],
    [4, 'active', true],
  ] as const)('checks active status for chat %s', async (chatId, status, allowed) => {
    mockGet.mockResolvedValueOnce({ exists: status !== undefined, data: () => ({ status }) });
    expect(await isChatApproved(chatId)).toBe(allowed);
  });

  it('fails closed if approval lookup fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('unavailable'));
    expect(await isChatApproved(5)).toBe(false);
  });
});

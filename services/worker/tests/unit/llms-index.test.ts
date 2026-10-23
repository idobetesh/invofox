import * as openai from '../../src/services/llms/openai';
import { extractInvoiceData } from '../../src/services/llms/index';

jest.mock('../../src/services/llms/openai', () => ({
  extractInvoiceData: jest.fn(),
  extractInvoiceDataMulti: jest.fn(),
}));

describe('llms/index orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses OpenAI directly without fallback metadata', async () => {
    const mockResult = {
      extraction: {
        is_invoice: true,
        vendor_name: 'Test',
        total_amount: 10,
        confidence: 0.9,
      },
      usage: {
        provider: 'openai' as const,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costUSD: 0.001,
      },
    };
    (openai.extractInvoiceData as jest.Mock).mockResolvedValue(mockResult);

    const buffer = Buffer.from('fake-image');
    const result = await extractInvoiceData(buffer, 'jpg');

    expect(openai.extractInvoiceData).toHaveBeenCalledTimes(1);
    expect(openai.extractInvoiceData).toHaveBeenCalledWith(buffer, 'jpg');
    expect(result.usage.fallbackFrom).toBeUndefined();
    expect(result.extraction.vendor_name).toBe('Test');
  });

  it('propagates OpenAI errors when no fallback is configured', async () => {
    (openai.extractInvoiceData as jest.Mock).mockRejectedValue(new Error('OpenAI down'));

    await expect(extractInvoiceData(Buffer.from('x'), 'jpg')).rejects.toThrow('OpenAI down');
  });
});

import OpenAI from 'openai';
import { isTransientOpenAiError, withOpenAiRetry } from '../../src/services/llms/retry';

describe('isTransientOpenAiError', () => {
  it('treats Premature close as transient', () => {
    const err = new Error(
      'Invalid response body while trying to fetch https://api.openai.com/v1/chat/completions: Premature close'
    );
    expect(isTransientOpenAiError(err)).toBe(true);
  });

  it('treats 502 APIError as transient', () => {
    const err = new OpenAI.APIError(502, undefined, 'Bad Gateway', undefined);
    expect(isTransientOpenAiError(err)).toBe(true);
  });

  it('does not retry 401', () => {
    const err = new OpenAI.APIError(401, undefined, 'Unauthorized', undefined);
    expect(isTransientOpenAiError(err)).toBe(false);
  });

  it('treats validation-style errors as non-transient', () => {
    expect(isTransientOpenAiError(new Error('No response from OpenAI'))).toBe(false);
  });
});

describe('withOpenAiRetry', () => {
  it('retries on Premature close then succeeds', async () => {
    jest.useFakeTimers();
    const transient = new Error(
      'Invalid response body while trying to fetch https://api.openai.com/v1/chat/completions: Premature close'
    );
    const fn = jest.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce('ok');

    const promise = withOpenAiRetry(fn, 'test');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

import { ASK_CANCELLED_MESSAGE, askErrorTitle, isAbortError } from './askErrors';
import { ASK_TIMEOUT_MESSAGE } from './dotaiApi';

describe('askErrorTitle', () => {
  test('timeout', () => {
    expect(askErrorTitle(ASK_TIMEOUT_MESSAGE, 502)).toBe('Ask timed out');
    expect(askErrorTitle('context deadline exceeded', 504)).toBe('Ask timed out');
  });

  test('auth and not found', () => {
    expect(askErrorTitle('HTTP 401: UNAUTHORIZED', 502)).toBe('Authentication failed');
    expect(askErrorTitle('HTTP 403: FORBIDDEN', 502)).toBe('Permission denied');
    expect(askErrorTitle('HTTP 404', 404)).toBe('Not found');
  });

  test('unreachable and cancel', () => {
    expect(askErrorTitle('dot-ai unreachable (502): connection refused', 502)).toBe('dot-ai unreachable');
    expect(askErrorTitle(ASK_CANCELLED_MESSAGE, 0)).toBe('Ask cancelled');
  });

  test('fallback', () => {
    expect(askErrorTitle('llm unavailable', 500)).toBe('Request failed');
  });
});

describe('isAbortError', () => {
  test('AbortError name', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });
});

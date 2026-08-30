import { extractErrorMessage, extractSummary } from './dotaiApi';

describe('dotaiApi extractors', () => {
  test('extractSummary prefers data.result.summary', () => {
    expect(
      extractSummary({
        success: true,
        data: { result: { summary: 'cluster looks fine' } },
      })
    ).toBe('cluster looks fine');
  });

  test('extractSummary falls back to analysis', () => {
    expect(extractSummary({ data: { result: { analysis: 'pod crash loop' } } })).toBe('pod crash loop');
  });

  test('extractErrorMessage reads error.code + message', () => {
    expect(
      extractErrorMessage(
        {
          success: false,
          error: { code: 'EXECUTION_ERROR', message: 'llm down' },
        },
        'fallback'
      )
    ).toBe('EXECUTION_ERROR: llm down');
  });
});

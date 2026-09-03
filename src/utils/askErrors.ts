export const ASK_CANCELLED_MESSAGE = 'Ask cancelled.';

export function askErrorTitle(message: string, status = 0): string {
  if (message === ASK_CANCELLED_MESSAGE || /cancelled/i.test(message)) {
    return 'Ask cancelled';
  }
  if (/120s plugin limit|timed out|timeout|deadline exceeded/i.test(message) || status === 504) {
    return 'Ask timed out';
  }
  if (status === 401 || /HTTP 401|\bunauthori[sz]ed\b|auth token/i.test(message)) {
    return 'Authentication failed';
  }
  if (status === 403 || /HTTP 403|\bforbidden\b/i.test(message)) {
    return 'Permission denied';
  }
  if (status === 404 || /HTTP 404|\bnot found\b/i.test(message)) {
    return 'Not found';
  }
  if (/unreachable|connection refused|failed to dial|network/i.test(message)) {
    return 'dot-ai unreachable';
  }
  return 'Request failed';
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const name = 'name' in err && typeof err.name === 'string' ? err.name : '';
  const message = 'message' in err && typeof err.message === 'string' ? err.message : '';
  return name === 'AbortError' || name === 'TimeoutError' || /aborted|cancelled/i.test(message);
}

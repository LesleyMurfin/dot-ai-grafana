/** Replacement used for every secret-shaped match (client + backend contract). */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Secret-shaped patterns redacted before pack / proxy / ask-log preview.
 * Order is intentional: multi-line PEM first, then keyword values, then bare tokens.
 * Applied repeatedly until stable so nested forms (e.g. authorization: Bearer …) collapse.
 */
const SECRET_PATTERNS: RegExp[] = [
  // PEM blocks (PRIVATE KEY, RSA PRIVATE KEY, CERTIFICATE, …)
  /-----BEGIN [A-Z0-9][A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9][A-Z0-9 ]*-----/g,
  // Bearer <token>
  /\bBearer\s+\S+/gi,
  // api_key / apiKey / apikey =|: value
  /\b(?:api_key|apiKey|apikey)\s*[=:]\s*\S+/gi,
  // password / passwd / secret =|: value
  /\b(?:password|passwd|secret)\s*[=:]\s*\S+/gi,
  // authorization =|: rest of line (scheme + token, e.g. "Basic …" / "Token …")
  /\bauthorization\s*[=:]\s*[^\n]+/gi,
  // JWT (three base64url parts, header starts with eyJ)
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // AWS access key id
  /\bAKIA[A-Z0-9]{16}\b/g,
];

/**
 * Mask credential-shaped substrings in free text.
 * Safe on empty / plain prose; returns a new string when anything matches.
 */
export function redactSecretShaped(text: string): string {
  if (!text) {
    return text;
  }
  let out = text;
  // Repeat until stable so e.g. "authorization: Bearer tok" fully collapses.
  for (let pass = 0; pass < 8; pass++) {
    let next = out;
    for (const pattern of SECRET_PATTERNS) {
      // RegExp with /g retains lastIndex; rebuild from source each use.
      const re = new RegExp(pattern.source, pattern.flags);
      next = next.replace(re, REDACTED_PLACEHOLDER);
    }
    if (next === out) {
      return out;
    }
    out = next;
  }
  return out;
}

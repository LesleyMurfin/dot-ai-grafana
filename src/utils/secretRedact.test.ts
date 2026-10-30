import { REDACTED_PLACEHOLDER, redactSecretShaped } from './secretRedact';

describe('redactSecretShaped', () => {
  test('placeholder constant is [REDACTED]', () => {
    expect(REDACTED_PLACEHOLDER).toBe('[REDACTED]');
  });

  test('plain text unchanged', () => {
    const plain = 'pod/checkout-api is CrashLooping in ns/prod';
    expect(redactSecretShaped(plain)).toBe(plain);
  });

  test('empty and short strings pass through', () => {
    expect(redactSecretShaped('')).toBe('');
    expect(redactSecretShaped('ok')).toBe('ok');
  });

  test('Bearer token', () => {
    expect(redactSecretShaped('Authorization header Bearer super-secret-token trailing')).toBe(
      `Authorization header ${REDACTED_PLACEHOLDER} trailing`
    );
    expect(redactSecretShaped('bearer AbC.123_xyz')).toBe(REDACTED_PLACEHOLDER);
  });

  test('apiKey= and api_key:', () => {
    expect(redactSecretShaped('cfg apiKey=sekrit-value end')).toBe(`cfg ${REDACTED_PLACEHOLDER} end`);
    expect(redactSecretShaped('api_key: abc123')).toBe(REDACTED_PLACEHOLDER);
    expect(redactSecretShaped('apikey=xyz')).toBe(REDACTED_PLACEHOLDER);
  });

  test('password= and secret:', () => {
    expect(redactSecretShaped('db password=hunter2 ok')).toBe(`db ${REDACTED_PLACEHOLDER} ok`);
    expect(redactSecretShaped('passwd: s3cret')).toBe(REDACTED_PLACEHOLDER);
    expect(redactSecretShaped('secret=topsecret')).toBe(REDACTED_PLACEHOLDER);
  });

  test('PEM block', () => {
    const pem = [
      'before',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZv89z',
      '-----END RSA PRIVATE KEY-----',
      'after',
    ].join('\n');
    const got = redactSecretShaped(pem);
    expect(got).toBe(`before\n${REDACTED_PLACEHOLDER}\nafter`);
    expect(got).not.toContain('PRIVATE KEY');
    expect(got).not.toContain('MIIEowIBAAKCAQEA');
  });

  test('JWT three-part eyJ…', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart';
    expect(redactSecretShaped(`token ${jwt} end`)).toBe(`token ${REDACTED_PLACEHOLDER} end`);
  });

  test('AWS AKIA key id', () => {
    expect(redactSecretShaped('key AKIAAABBCCDDEEFFGGHH used')).toBe(
      `key ${REDACTED_PLACEHOLDER} used`
    );
    // Too short — not an access key id
    expect(redactSecretShaped('AKIASHORT')).toBe('AKIASHORT');
  });

  test('authorization= / authorization:', () => {
    expect(redactSecretShaped('authorization=Basic dXNlcjpwYXNz')).toBe(REDACTED_PLACEHOLDER);
    expect(redactSecretShaped('Authorization: Token abc')).toBe(REDACTED_PLACEHOLDER);
  });

  test('nested authorization Bearer collapses fully', () => {
    const got = redactSecretShaped('authorization: Bearer nested-secret');
    expect(got).toBe(REDACTED_PLACEHOLDER);
    expect(got).not.toContain('nested-secret');
    expect(got).not.toContain('Bearer');
  });
});

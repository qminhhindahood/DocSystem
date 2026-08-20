/**
 * Real AES-256-GCM round-trip for BYOK key storage. No mocks: the actual
 * crypto module encrypts and decrypts, and tampering must be detected.
 */
import { encryptApiKey, decryptApiKey, encrypt, decrypt } from './encryption';

describe('AES-256-GCM API key encryption', () => {
  it('round-trips a realistic Gemini key', () => {
    const key = 'AIzaSyA' + 'x'.repeat(32);
    const { encryptedApiKey, apiKeyIv, apiKeyAuthTag } = encryptApiKey(key);
    expect(encryptedApiKey).not.toContain(key);
    expect(decryptApiKey(encryptedApiKey, apiKeyIv, apiKeyAuthTag)).toBe(key);
  });

  it('round-trips unicode and empty-ish payloads', () => {
    for (const value of ['khóa-api-tiếng-việt', 'a', ' '.repeat(64)]) {
      const payload = encrypt(value);
      expect(decrypt(payload)).toBe(value);
    }
  });

  it('produces a fresh IV per encryption', () => {
    const a = encryptApiKey('same-key');
    const b = encryptApiKey('same-key');
    expect(a.apiKeyIv).not.toBe(b.apiKeyIv);
    expect(a.encryptedApiKey).not.toBe(b.encryptedApiKey);
  });

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const { encryptedApiKey, apiKeyIv, apiKeyAuthTag } = encryptApiKey('secret-key');
    const raw = Buffer.from(encryptedApiKey, 'base64');
    raw[0] = raw[0] ^ 0xff; // flip a byte
    expect(() => decryptApiKey(raw.toString('base64'), apiKeyIv, apiKeyAuthTag))
      .toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const { encryptedApiKey, apiKeyIv, apiKeyAuthTag } = encryptApiKey('secret-key');
    const tag = Buffer.from(apiKeyAuthTag, 'base64');
    tag[0] = tag[0] ^ 0xff;
    expect(() => decryptApiKey(encryptedApiKey, apiKeyIv, tag.toString('base64')))
      .toThrow();
  });

  it('rejects a swapped IV', () => {
    const a = encryptApiKey('key-one');
    const b = encryptApiKey('key-two');
    expect(() => decryptApiKey(a.encryptedApiKey, b.apiKeyIv, a.apiKeyAuthTag))
      .toThrow();
  });
});

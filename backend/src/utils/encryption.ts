/**
 * AES-256-GCM encryption for sensitive data (API keys, etc.)
 * Uses LLM_CONFIG_ENCRYPTION_KEY from environment (32-byte hex string).
 * Never derives key from JWT_SECRET — separate key for LLM config encryption.
 */

import crypto from 'crypto';

const ENCRYPTION_KEY_HEX = process.env.LLM_CONFIG_ENCRYPTION_KEY;

function getKey(): Buffer {
  if (!ENCRYPTION_KEY_HEX) {
    throw new Error('LLM_CONFIG_ENCRYPTION_KEY environment variable is not set');
  }
  const key = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
  if (key.length !== 32) {
    throw new Error('LLM_CONFIG_ENCRYPTION_KEY must be 32 bytes (64 hex chars) for AES-256');
  }
  return key;
}

export interface EncryptedPayload {
  encryptedData: string;  // base64 ciphertext
  iv: string;             // base64 IV (12 bytes)
  authTag: string;        // base64 auth tag (16 bytes)
}

/**
 * Encrypt plaintext string → { encryptedData, iv, authTag }
 */
export function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt { encryptedData, iv, authTag } → plaintext string
 */
export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const ciphertext = Buffer.from(payload.encryptedData, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Encrypt and split into DB columns: encryptedApiKey, apiKeyIv, apiKeyAuthTag
 */
export function encryptApiKey(apiKey: string): {
  encryptedApiKey: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
} {
  const result = encrypt(apiKey);
  return {
    encryptedApiKey: result.encryptedData,
    apiKeyIv: result.iv,
    apiKeyAuthTag: result.authTag,
  };
}

/**
 * Decrypt DB columns back to plaintext API key
 */
export function decryptApiKey(
  encryptedApiKey: string,
  apiKeyIv: string,
  apiKeyAuthTag: string,
): string {
  return decrypt({
    encryptedData: encryptedApiKey,
    iv: apiKeyIv,
    authTag: apiKeyAuthTag,
  });
}

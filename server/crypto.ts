import crypto from 'node:crypto';

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TOKEN_FORMAT_PREFIX = 'v1';

/**
 * Resolves the 256-bit symmetric key used for AES-256-GCM token encryption.
 * Accepts either a 64-character hex string or a 32-byte base64 string.
 */
export function resolveTokenEncryptionKey(keyOverride?: string): Buffer {
  const raw = (keyOverride ?? process.env.TOKEN_ENCRYPTION_KEY)?.trim();
  if (!raw) {
    throw new Error('Server TOKEN_ENCRYPTION_KEY is not configured.');
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === KEY_LENGTH_BYTES) {
    return b64;
  }

  throw new Error(
    'Invalid TOKEN_ENCRYPTION_KEY format: expected 32-byte base64 or 64-character hex.'
  );
}

export function isTokenEncryptionConfigured(): boolean {
  try {
    resolveTokenEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, keyOverride?: string): string {
  const key = resolveTokenEncryptionKey(keyOverride);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_FORMAT_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(encoded: string, keyOverride?: string): string {
  const key = resolveTokenEncryptionKey(keyOverride);
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== TOKEN_FORMAT_PREFIX) {
    throw new Error('Unsupported encrypted secret envelope format.');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  if (iv.length !== IV_LENGTH_BYTES || tag.length !== 16) {
    throw new Error('Malformed encrypted secret envelope parameters.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function generateOAuthStateNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Redacts Bearer tokens, Basic credentials, API keys, and query/form secrets
 * before storing or returning diagnostic messages.
 */
export function redactSensitiveText(input: string): string {
  if (!input) return input;
  return input
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [REDACTED]')
    .replace(
      /\b(api_key|apikey|access_token|refresh_token|client_secret|service_role_key|token|secret)=([^&\s]+)/gi,
      '$1=[REDACTED]'
    )
    .replace(
      /"(access_token|refresh_token|client_secret|api_key|encrypted_access_token|encrypted_refresh_token)"\s*:\s*"[^"]*"/gi,
      '"$1":"[REDACTED]"'
    );
}

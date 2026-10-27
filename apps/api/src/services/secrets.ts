import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/** The key that encrypts stored variables: 32 bytes, base64 in SECRETS_KEY. Development falls back to a fixed key. */
export function secretsKeyFrom(value: string | undefined, production: boolean): Buffer {
  if (value) {
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
    return key;
  }
  if (production) throw new Error('SECRETS_KEY is required in production (openssl rand -base64 32)');
  return scryptSync('grids-development-secrets-key', 'grids', 32);
}

/** AES-256-GCM: `v1.<iv>.<tag>.<ciphertext>`, each base64url. */
export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(key: Buffer, stored: string): string {
  const [v, iv, tag, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unreadable secret');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

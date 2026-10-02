import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);
export const verifyPassword = (hashed: string, password: string) => verify(hashed, password).catch(() => false);

/** A pre-computed hash to compare against when the account doesn't exist (constant-ish timing). */
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
/** 6-digit numeric code. */
export const randomCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
/** Recovery code like "7FQK-2M9X". */
export function recoveryCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = () => Array.from({ length: 4 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
  return `${pick()}-${pick()}`;
}

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** AES-256-GCM sealing for secrets at rest. Output: base64url(iv | tag | ciphertext). */
export function sealer(secret: string) {
  const key = createHash('sha256').update(secret).digest();
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
    },
    open(sealed: string): string {
      const buf = Buffer.from(sealed, 'base64url');
      const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
export type Sealer = ReturnType<typeof sealer>;

/** Minimal password policy: length, not the email, not a very common password. */
const COMMON = new Set(['password', 'password1', 'password123', '123456789', '1234567890', 'qwertyuiop', 'iloveyou', 'letmein123', 'welcome123', 'admin12345']);
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return 'password_too_short';
  if (password.length > 200) return 'password_too_long';
  if (COMMON.has(password.toLowerCase())) return 'password_too_common';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) return 'password_contains_email';
  return null;
}

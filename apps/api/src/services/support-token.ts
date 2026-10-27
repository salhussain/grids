import { createHmac, timingSafeEqual } from 'node:crypto';

const pack = (uuid: string) => Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
const unpack = (s: string) => {
  const hex = Buffer.from(s, 'base64url').toString('hex');
  return hex.length === 32 ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : null;
};
const sign = (secret: Buffer, tenantId: string, itemId: string) => createHmac('sha256', secret).update(`support:${tenantId}:${itemId}`).digest('base64url').slice(0, 32);

/**
 * The link that opens a request for someone with no account. It names the request and carries a signature only this
 * server can make, so nothing has to be stored to check it, and an email can always carry it again.
 */
export function supportToken(secret: Buffer, tenantId: string, itemId: string): string {
  return `${pack(tenantId)}.${pack(itemId)}.${sign(secret, tenantId, itemId)}`;
}

export function readSupportToken(secret: Buffer, token: string): { tenantId: string; itemId: string } | null {
  const [t, i, sig, extra] = token.split('.');
  if (!t || !i || !sig || extra !== undefined) return null;
  const tenantId = unpack(t);
  const itemId = unpack(i);
  if (!tenantId || !itemId) return null;
  const want = Buffer.from(sign(secret, tenantId, itemId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? { tenantId, itemId } : null;
}

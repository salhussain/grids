import { z } from 'zod';

/**
 * All entity IDs are UUIDv7: time-ordered (index-friendly) and safe to generate
 * on clients, which offline sync relies on (spec §11, ADR 0006).
 */
export const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Id = z.string().regex(UUID_V7_RE, 'Expected a UUIDv7');
export type Id = z.infer<typeof Id>;

/** Platform-agnostic UUIDv7 (RFC 9562); works in Node, browsers and React Native. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // 48-bit big-endian unix ms timestamp
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

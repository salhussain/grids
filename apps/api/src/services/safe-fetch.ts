import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Addresses inside the platform's own network, loopback, link-local (cloud metadata) and shared ranges. */
export const isPrivateAddress = (a: string): boolean => {
  const ip = a.toLowerCase();
  if (isIP(ip) === 4) return PRIVATE_V4.some((r) => r.test(ip));
  return ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80') || (ip.startsWith('::ffff:') && PRIVATE_V4.some((r) => r.test(ip.slice(7))));
};

let allowPrivate = false;
/** Set once at start: a deployment may let connections reach its own network (development, an on-premises install). */
export const allowPrivateAddresses = (v: boolean) => void (allowPrivate = v);

/**
 * Outbound requests for connections go through this agent. The address is checked as the connection is made, so the
 * address that was checked is the one used: a name that answers "public" to a check and "internal" to the request
 * (DNS rebinding) is refused.
 */
const agent = new Agent({
  connect: {
    lookup(hostname: string, options: { all?: boolean; family?: number | string }, cb: (err: Error | null, address: never, family?: number) => void) {
      dnsLookup(hostname, { ...options, all: true } as never, (err, addrs: unknown) => {
        if (err) return cb(err, undefined as never);
        const list = addrs as { address: string; family: number }[];
        if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) return cb(new Error('Connections to private or internal addresses are not allowed here'), undefined as never);
        return options.all ? cb(null, list as never) : cb(null, list[0]!.address as never, list[0]!.family);
      });
    },
  },
});

/** The most an API or file answer may be: past this the read stops instead of filling memory. */
export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/** A request that cannot reach the platform's own network, and only speaks http or https. */
export async function safeFetch(url: URL | string, init: RequestInit = {}): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The address must start with http:// or https://');
  // A numeric address never goes through a name lookup, so it is checked here.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && isPrivateAddress(host)) throw new Error('Connections to private or internal addresses are not allowed here');
  return undiciFetch(u, { ...(init as object), dispatcher: agent } as never) as unknown as Promise<Response>;
}

/** The body as text, refusing (and stopping) when it is longer than `max` bytes. */
export async function readText(res: Response, max = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`The answer is larger than ${Math.round(max / 1024 / 1024)} MB`);
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`The answer is larger than ${Math.round(max / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

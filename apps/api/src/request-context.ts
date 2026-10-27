import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';

/** Where the request now being handled came from. Everything written to the activity log picks this up. */
export interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  /** Set once something has been written to the log during this request, so it is not logged twice. */
  logged: boolean;
}

export const requestInfo = new AsyncLocalStorage<RequestInfo>();

const header = (h: Record<string, string | string[] | undefined>, ...names: string[]): string | null => {
  for (const n of names) {
    const v = h[n];
    const s = Array.isArray(v) ? v[0] : v;
    if (s && s.trim() && s.trim().toUpperCase() !== 'XX') return decodeURIComponent(s.trim()).slice(0, 80);
  }
  return null;
};

/** Reads the address and, where the proxy in front of us says so, the place of a request. */
export function infoFrom(req: { ip: string; headers: Record<string, string | string[] | undefined> }): RequestInfo {
  const h = req.headers;
  return {
    ip: req.ip || null,
    userAgent: header(h, 'user-agent')?.slice(0, 200) ?? null,
    // CDNs and load balancers add these; none of them is needed.
    country: header(h, 'cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country-code', 'x-appengine-country'),
    region: header(h, 'cf-region', 'x-vercel-ip-country-region', 'cloudfront-viewer-country-region-name', 'x-appengine-region'),
    city: header(h, 'cf-ipcity', 'x-vercel-ip-city', 'cloudfront-viewer-city', 'x-appengine-city'),
    logged: false,
  };
}

/** Whether an address is on a private or local network (so there is no place to look up). */
export function isPrivateIp(ip: string | null): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return ip === '::1' || ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd') || ip.toLowerCase().startsWith('fe80');
}

const cache = new Map<string, { at: number; place: { country: string | null; region: string | null; city: string | null } | null }>();
const DAY = 86_400_000;

/**
 * Finds a place for an address when nothing in front of us said. Off unless GEOIP_URL is set to a lookup service,
 * with `{ip}` where the address goes (e.g. https://ipapi.co/{ip}/json/). Answers are kept for a day.
 */
async function lookup(ip: string): Promise<{ country: string | null; region: string | null; city: string | null } | null> {
  const url = process.env.GEOIP_URL;
  if (!url || isPrivateIp(ip) || isIP(ip) === 0) return null;
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < DAY) return hit.place;
  let place: { country: string | null; region: string | null; city: string | null } | null = null;
  try {
    const res = await fetch(url.replace('{ip}', encodeURIComponent(ip)), { signal: AbortSignal.timeout(1500), headers: { accept: 'application/json' } });
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>;
      const s = (...k: string[]) => k.map((x) => j[x]).find((v): v is string => typeof v === 'string' && !!v) ?? null;
      place = { country: s('country_name', 'country', 'countryName'), region: s('region', 'regionName', 'region_name'), city: s('city') };
    }
  } catch {
    // No lookup, no place: the address is still logged.
  }
  if (cache.size > 5000) cache.clear();
  cache.set(ip, { at: Date.now(), place });
  return place;
}

const regions = new Intl.DisplayNames('en', { type: 'region' });
/** "AU" as "Australia". */
const countryName = (c: string | null) => {
  if (!c) return null;
  if (!/^[A-Za-z]{2}$/.test(c)) return c;
  try {
    return regions.of(c.toUpperCase()) ?? c;
  } catch {
    return c;
  }
};

type GeoDb = { lookup(ip: string): { country: string; region: string; city: string } | null };
let offline: GeoDb | null | undefined;
/** The address book that ships with the server: no address leaves it. Loaded on first use, since it takes some memory. */
function offlineLookup(ip: string): { country: string | null; region: string | null; city: string | null } | null {
  if (offline === undefined) {
    try {
      offline = createRequire(import.meta.url)('geoip-lite') as GeoDb;
    } catch {
      offline = null;
    }
  }
  const r = offline?.lookup(ip.startsWith('::ffff:') ? ip.slice(7) : ip);
  return r ? { country: r.country || null, region: r.region || null, city: r.city || null } : null;
}

/** The request's origin with a place filled in if one can be found: from the proxy, a lookup service, or the built-in address book. */
export async function currentOrigin(): Promise<RequestInfo | undefined> {
  const info = requestInfo.getStore();
  if (!info) return undefined;
  if (!info.country && !info.city && info.ip && !isPrivateIp(info.ip)) Object.assign(info, (await lookup(info.ip)) ?? offlineLookup(info.ip) ?? {});
  info.country = countryName(info.country);
  return info;
}

/** Organisation branding for the login page, fetched from the platform API (cached briefly). */
export interface Branding {
  tenantId: string;
  name: string;
  appName: string;
  primaryColor: string;
  logo: string | null;
  welcomeMessage: string;
  languages: string[];
  defaultLanguage: string;
  overrides?: Record<string, Record<string, string>>;
}

const cache = new Map<string, { at: number; value: Branding | null }>();

export function brandingLoader(apiUrl: string) {
  return async (tenantId: string | undefined | null): Promise<Branding | null> => {
    if (!tenantId) return null;
    const hit = cache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    let value: Branding | null = null;
    try {
      const res = await fetch(`${apiUrl}/public/branding/${encodeURIComponent(tenantId)}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) value = (await res.json()) as Branding;
    } catch {
      value = null; // login must still work if the API is down
    }
    cache.set(tenantId, { at: Date.now(), value });
    return value;
  };
}

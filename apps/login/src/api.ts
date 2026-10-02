/** Error from the identity API: a stable code (translated as auth.errors.<code>) plus vars. */
export class LoginError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

/** JSON request to the identity service. The custom header is part of its CSRF guard. */
export async function call<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'x-grids-request': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new LoginError('generic', 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; vars?: Record<string, string | number> };
  if (!res.ok) throw new LoginError(data.error ?? 'generic', res.status, data.vars);
  return data as T;
}

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

export interface Details {
  uid: string;
  prompt: string;
  client: { id: string; name: string };
  organization: Branding | null;
  loginHint: string | null;
  uiLocales: string | null;
  registrationAllowed: boolean;
  pending: { stage: 'verify_email' | 'mfa' | 'mfa_setup'; email: string | null } | null;
}

/** What a login step returns: the next step, or where to send the browser. */
export type StepResult =
  | { redirectTo: string }
  | { step: 'verify'; email: string }
  | { step: 'mfa' }
  | { step: 'mfa-setup' };

export interface TotpSetup {
  secret: string;
  uri: string;
  qr: string;
}

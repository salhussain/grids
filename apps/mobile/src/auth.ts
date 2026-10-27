import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { env } from './env';

WebBrowser.maybeCompleteAuthSession();

// Authorization code + PKCE against the Grids identity service, like the web app. The refresh token
// lives in the device's secure storage; the access token is renewed only when there is a connection.
const SCOPES = ['openid', 'profile', 'email', 'offline_access'];
const KEY = 'grids.session';
// `grids://auth/callback` in a built app; an exp:// address under Expo Go.
export const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: 'grids', path: 'auth/callback' });

export interface Session {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch seconds. */
  expiresAt: number;
  /** Subject of the account: who the data on the device belongs to. */
  subject: string;
}

const discovery = () => AuthSession.fetchDiscoveryAsync(env.oidcAuthority);

const subjectOf = (jwt: string): string => {
  try {
    const part = jwt.split('.')[1] ?? '';
    const json = decodeURIComponent(
      atob(part.replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return String((JSON.parse(json) as { sub?: string }).sub ?? '');
  } catch {
    return '';
  }
};

let cached: Session | null | undefined;

/** Who is signed in, as far as is known without waiting. */
export const sessionSubject = () => cached?.subject || null;
let refreshing: Promise<Session | null> | null = null;

export async function loadSession(): Promise<Session | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

async function save(s: Session | null) {
  cached = s;
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(KEY);
}

const toSession = (t: AuthSession.TokenResponse, previous?: Session | null): Session => ({
  accessToken: t.accessToken,
  refreshToken: t.refreshToken ?? previous?.refreshToken ?? null,
  expiresAt: (t.issuedAt ?? Math.floor(Date.now() / 1000)) + (t.expiresIn ?? 300),
  subject: subjectOf(t.accessToken) || previous?.subject || '',
});

export interface SignInOptions {
  /** Tenant id: the sign-in page shows that organisation's branding. */
  orgId?: string | undefined;
  loginHint?: string | undefined;
}

export async function signIn(opts: SignInOptions = {}): Promise<Session | null> {
  const disc = await discovery();
  const request = authRequest(opts);
  await request.makeAuthUrlAsync(disc);
  const result = await request.promptAsync(disc);
  if (result.type !== 'success') return null;
  const tokens = await AuthSession.exchangeCodeAsync(
    { clientId: env.oidcClientId, code: result.params['code']!, redirectUri: REDIRECT_URI, extraParams: { code_verifier: request.codeVerifier! } },
    disc,
  );
  const s = toSession(tokens);
  await save(s);
  return s;
}

function authRequest(opts: SignInOptions) {
  return new AuthSession.AuthRequest({
    clientId: env.oidcClientId,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    usePKCE: true,
    prompt: AuthSession.Prompt.Consent,
    extraParams: { ...(opts.orgId && { organization: opts.orgId }), ...(opts.loginHint && { login_hint: opts.loginHint }) },
  });
}

/** Renewed with the refresh token. Throws when there is no connection; returns null when the sign-in is no longer valid. */
async function refresh(s: Session): Promise<Session | null> {
  if (!s.refreshToken) return null;
  const disc = await discovery();
  try {
    const t = await AuthSession.refreshAsync({ clientId: env.oidcClientId, refreshToken: s.refreshToken }, disc);
    const next = toSession(t, s);
    await save(next);
    return next;
  } catch (e) {
    // The server answered and said no: the sign-in is over. Anything else (offline, timeout) may pass.
    if (e instanceof AuthSession.TokenError) {
      await save(null);
      return null;
    }
    throw e;
  }
}

/** A token that is good for the next request, renewing it when needed. Offline, the old one is returned: the server decides. */
export async function accessToken(): Promise<string | null> {
  const s = await loadSession();
  if (!s) return null;
  if (s.expiresAt - 30 > Date.now() / 1000) return s.accessToken;
  refreshing ??= refresh(s)
    .catch(() => s)
    .finally(() => {
      refreshing = null;
    });
  return (await refreshing)?.accessToken ?? null;
}

export async function signOut() {
  const s = await loadSession();
  if (s?.refreshToken) {
    try {
      const disc = await discovery();
      await AuthSession.revokeAsync({ clientId: env.oidcClientId, token: s.refreshToken, tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken }, disc);
    } catch {
      /* offline: the token stays valid on the server until it expires, but is gone from the device */
    }
  }
  await save(null);
}

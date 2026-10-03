import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { env } from './env';

// Authorization code + PKCE against the Grids identity service. Access tokens are
// JWTs for the API audience (its default resource). `prompt=consent` lets the
// first-party app receive a refresh token; the identity service grants it silently.
const SCOPE = 'openid profile email offline_access';

export const userManager = new UserManager({
  authority: env.oidcAuthority,
  client_id: env.oidcClientId,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: SCOPE,
  prompt: 'consent',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
});

export interface SignInOptions {
  returnTo?: string;
  /** Tenant id: the sign-in page shows that organisation's branding and languages. */
  orgId?: string | null;
  /** Ask for the password again even with an IdP session (e.g. accepting an invite). */
  forceLogin?: boolean;
  /** Preferred interface language for the sign-in page. */
  locale?: string | null;
  /** Pre-fills the email on the sign-in page. */
  loginHint?: string;
}

const storedLocale = () => {
  try {
    return localStorage.getItem('grids.locale');
  } catch {
    return null;
  }
};

export function signIn(opts: SignInOptions = {}): Promise<void> {
  const locale = opts.locale ?? storedLocale();
  return userManager.signinRedirect({
    state: { returnTo: opts.returnTo ?? window.location.pathname },
    ...(opts.forceLogin && { prompt: 'login consent' }),
    ...(locale && { ui_locales: locale }),
    ...(opts.loginHint && { login_hint: opts.loginHint }),
    ...(opts.orgId && { extraQueryParams: { organization: opts.orgId } }),
  });
}

let callback: Promise<User> | undefined;
/**
 * Completes the redirect sign-in exactly once per page load. React StrictMode runs
 * effects twice in development, and redeeming an authorization code twice makes the
 * identity service revoke everything issued from it.
 */
export const completeSignIn = (): Promise<User> => (callback ??= userManager.signinRedirectCallback());

export async function signOut(): Promise<void> {
  await userManager.signoutRedirect();
}

export async function currentUser(): Promise<User | null> {
  const user = await userManager.getUser();
  return user && !user.expired ? user : null;
}

/** Password and two-step settings, hosted by the identity service. */
export const accountUrl = () =>
  `${new URL(env.oidcAuthority).origin}/ui/account?return_to=${encodeURIComponent(window.location.href)}`;

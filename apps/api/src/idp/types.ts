export interface UserProfile {
  subject: string;
  email: string | null;
  displayName: string | null;
  givenName?: string | null;
  familyName?: string | null;
}

export interface OrgClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  confidential: boolean;
  disabled: boolean;
  createdAt: string;
}
export type CreatedOrgClient = OrgClient & { clientSecret: string | null };

/**
 * The only surface the platform needs from an identity provider (ADR 0005).
 * The Grids identity service implements it (ADR 0009); another IdP can be swapped in behind it.
 */
export interface IdentityProvider {
  /** Creates (or renames) the IdP-side organisation for a tenant; returns its id. */
  createOrganization(tenantId: string, name: string): Promise<string>;
  /** Resolves a user's profile by token subject. */
  getUserProfile(subject: string): Promise<UserProfile>;
  /** Records that a user belongs to an organisation (its sign-in policy then applies to them). */
  linkUserToOrganization(orgId: string, subject: string): Promise<void>;
  /** Second factors the user has enrolled (e.g. `totp`, `u2f`, `passkey`). */
  getUserSecondFactors(subject: string): Promise<string[]>;
  /** Enforces (or relaxes) a second factor for everyone signing in to the org. */
  setOrganizationMfaRequired(orgId: string, required: boolean): Promise<void>;
  /** Stops (or allows) sign-in for everyone in the org: its subscription has ended (or is back). */
  setOrganizationBlocked(orgId: string, blocked: boolean): Promise<void>;
  /** Creates a platform-staff user (platform org); they receive an email to set a password. */
  createStaffUser(user: { email: string; givenName: string; familyName: string }): Promise<string>;
  /** Blocks or restores sign-in for a user. */
  setUserActive(subject: string, active: boolean): Promise<void>;
  /** Applications the organisation registered to sign its people in (OIDC). */
  listClients(orgId: string): Promise<{ issuer: string; clients: OrgClient[] }>;
  createClient(
    orgId: string,
    input: { name: string; redirectUris: string[]; postLogoutRedirectUris: string[]; confidential: boolean },
  ): Promise<CreatedOrgClient>;
  updateClient(
    orgId: string,
    clientId: string,
    patch: { name?: string; redirectUris?: string[]; postLogoutRedirectUris?: string[]; disabled?: boolean },
  ): Promise<OrgClient>;
  rotateClientSecret(orgId: string, clientId: string): Promise<CreatedOrgClient>;
  deleteClient(orgId: string, clientId: string): Promise<void>;
  /** Sign-ins still running for the organisation's people. */
  listSessions(orgId: string): Promise<IdpSession[]>;
  /** Sign-ins that are over, and failed attempts (the last 90 days). */
  listPastSessions(orgId: string): Promise<IdpPastSession[]>;
  /** Ends one of them. */
  revokeSession(orgId: string, sessionId: string): Promise<void>;
}

export interface IdpPastSession {
  id: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
  at: string;
  ip: string | null;
  success: boolean;
}

export interface IdpSession {
  id: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
  signedInAt: string | null;
  expiresAt: string | null;
}

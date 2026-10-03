export interface UserProfile {
  subject: string;
  email: string | null;
  displayName: string | null;
  givenName?: string | null;
  familyName?: string | null;
}

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
  /** Creates a platform-staff user (platform org); they receive an email to set a password. */
  createStaffUser(user: { email: string; givenName: string; familyName: string }): Promise<string>;
  /** Blocks or restores sign-in for a user. */
  setUserActive(subject: string, active: boolean): Promise<void>;
}

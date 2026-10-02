import type { IdentityProvider, UserProfile } from './types.js';

/**
 * The platform's own identity service (apps/identity), reached over its internal
 * service API. Organisations use the tenant id as their id.
 */
export class GridsIdpClient implements IdentityProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.serviceToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Identity service ${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async createOrganization(tenantId: string, name: string) {
    // Self-registration only creates a sign-in account; workspace access still needs an invitation.
    await this.call('PUT', `/internal/orgs/${tenantId}`, { name, allowRegistration: true });
    return tenantId;
  }

  async getUserProfile(subject: string): Promise<UserProfile> {
    const a = await this.call<{ email: string; givenName: string | null; familyName: string | null }>(
      'GET',
      `/internal/accounts/${subject}`,
    );
    return {
      subject,
      email: a.email,
      displayName: [a.givenName, a.familyName].filter(Boolean).join(' ') || null,
      givenName: a.givenName,
      familyName: a.familyName,
    };
  }

  async getUserSecondFactors(subject: string) {
    return (await this.call<{ methods: string[] }>('GET', `/internal/accounts/${subject}/factors`)).methods;
  }

  async setOrganizationMfaRequired(orgId: string, required: boolean) {
    await this.call('PATCH', `/internal/orgs/${orgId}`, { mfaRequired: required });
  }

  async linkUserToOrganization(orgId: string, subject: string) {
    await this.call('POST', `/internal/orgs/${orgId}/members`, { accountId: subject });
  }

  async createStaffUser(user: { email: string; givenName: string; familyName: string }) {
    const { accountId } = await this.call<{ accountId: string }>('POST', '/internal/accounts', {
      ...user,
      sendSetupEmail: true,
    });
    return accountId;
  }

  async setUserActive(subject: string, active: boolean) {
    await this.call('PUT', `/internal/accounts/${subject}/status`, { active });
  }
}

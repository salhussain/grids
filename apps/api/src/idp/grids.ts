import { badRequest, conflict, notFound } from '../errors.js';
import type { CreatedOrgClient, IdentityProvider, IdpPastSession, IdpSession, OrgClient, UserProfile } from './types.js';

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
    // Mistakes the person can fix come back as proper API errors, not outages.
    if (res.status === 404) throw notFound('Application');
    if (res.status === 409) throw conflict('You have reached the limit of applications for this organisation.');
    if (res.status === 400 && path.includes('/clients')) throw badRequest('Those application details are not valid.', await res.text());
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

  async setOrganizationBlocked(orgId: string, blocked: boolean) {
    await this.call('PATCH', `/internal/orgs/${orgId}`, { blocked });
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

  listClients(orgId: string) {
    return this.call<{ issuer: string; clients: OrgClient[] }>('GET', `/internal/orgs/${orgId}/clients`);
  }
  createClient(orgId: string, input: Parameters<IdentityProvider['createClient']>[1]) {
    return this.call<CreatedOrgClient>('POST', `/internal/orgs/${orgId}/clients`, input);
  }
  updateClient(orgId: string, clientId: string, patch: Parameters<IdentityProvider['updateClient']>[2]) {
    return this.call<OrgClient>('PATCH', `/internal/orgs/${orgId}/clients/${clientId}`, patch);
  }
  rotateClientSecret(orgId: string, clientId: string) {
    return this.call<CreatedOrgClient>('POST', `/internal/orgs/${orgId}/clients/${clientId}/secret`);
  }
  async listSessions(orgId: string) {
    return (await this.call<{ sessions: IdpSession[] }>('GET', `/internal/orgs/${orgId}/sessions`)).sessions;
  }
  async listPastSessions(orgId: string) {
    return (await this.call<{ sessions: IdpPastSession[] }>('GET', `/internal/orgs/${orgId}/past-sessions`)).sessions;
  }
  async revokeSession(orgId: string, sessionId: string) {
    await this.call('DELETE', `/internal/orgs/${orgId}/sessions/${sessionId}`);
  }
  async deleteClient(orgId: string, clientId: string) {
    await this.call('DELETE', `/internal/orgs/${orgId}/clients/${clientId}`);
  }
}

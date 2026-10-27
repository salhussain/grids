import type { TokenVerifier } from '../src/auth/tokens.js';
import type { CreatedOrgClient, IdentityProvider, OrgClient, UserProfile } from '../src/idp/types.js';
import type { Mailer, OutgoingEmail } from '../src/services/email.js';

export class FakeIdp implements IdentityProvider {
  orgs: string[] = [];
  failNext = false;
  profiles = new Map<string, UserProfile>();
  secondFactors = new Map<string, string[]>();
  mfaPolicy = new Map<string, boolean>();

  async createOrganization(_tenantId: string, name: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('IdP unavailable');
    }
    this.orgs.push(name);
    return `org-${this.orgs.length}`;
  }
  async getUserProfile(subject: string) {
    return this.profiles.get(subject) ?? { subject, email: null, displayName: null };
  }
  links: [string, string][] = [];
  async linkUserToOrganization(orgId: string, subject: string) {
    this.links.push([orgId, subject]);
  }
  async getUserSecondFactors(subject: string) {
    return this.secondFactors.get(subject) ?? [];
  }
  blocked = new Map<string, boolean>();
  async setOrganizationBlocked(orgId: string, blocked: boolean) {
    this.blocked.set(orgId, blocked);
  }
  async setOrganizationMfaRequired(orgId: string, required: boolean) {
    this.mfaPolicy.set(orgId, required);
  }
  staffCreated: string[] = [];
  inactive = new Set<string>();
  async createStaffUser(user: { email: string }) {
    this.staffCreated.push(user.email);
    return `staff-${user.email}`;
  }
  async setUserActive(subject: string, active: boolean) {
    if (active) this.inactive.delete(subject);
    else this.inactive.add(subject);
  }
  clients: (OrgClient & { orgId: string })[] = [];
  async listClients(orgId: string) {
    return { issuer: 'http://idp.test/oidc', clients: this.clients.filter((c) => c.orgId === orgId) };
  }
  async createClient(orgId: string, input: { name: string; redirectUris: string[]; postLogoutRedirectUris: string[]; confidential: boolean }): Promise<CreatedOrgClient> {
    const c = { orgId, clientId: `gc_${this.clients.length + 1}`, name: input.name, redirectUris: input.redirectUris, postLogoutRedirectUris: input.postLogoutRedirectUris, confidential: input.confidential, disabled: false, createdAt: new Date().toISOString() };
    this.clients.push(c);
    return { ...c, clientSecret: input.confidential ? 'secret-1' : null };
  }
  async updateClient(orgId: string, clientId: string, patch: Partial<OrgClient>) {
    const c = this.clients.find((x) => x.orgId === orgId && x.clientId === clientId);
    if (!c) throw new Error('missing');
    Object.assign(c, patch);
    return c;
  }
  async rotateClientSecret(orgId: string, clientId: string): Promise<CreatedOrgClient> {
    const c = this.clients.find((x) => x.orgId === orgId && x.clientId === clientId)!;
    return { ...c, clientSecret: 'secret-2' };
  }
  async deleteClient(orgId: string, clientId: string) {
    this.clients = this.clients.filter((x) => !(x.orgId === orgId && x.clientId === clientId));
  }
  sessions: { orgId: string; id: string; email: string }[] = [];
  async listSessions(orgId: string) {
    return this.sessions
      .filter((s) => s.orgId === orgId)
      .map((s) => ({ id: s.id, email: s.email, givenName: null, familyName: null, signedInAt: null, expiresAt: null }));
  }
  async listPastSessions(_orgId: string) {
    return [];
  }
  async revokeSession(orgId: string, sessionId: string) {
    this.sessions = this.sessions.filter((s) => !(s.orgId === orgId && s.id === sessionId));
  }
}

export class FakeMailer implements Mailer {
  sent: OutgoingEmail[] = [];
  failFor = new Set<string>();
  async send(mail: OutgoingEmail) {
    if (this.failFor.has(mail.to)) throw new Error('SMTP 550 mailbox unavailable');
    this.sent.push(mail);
    return { messageId: `msg-${this.sent.length}` };
  }
  to(address: string) {
    return this.sent.filter((m) => m.to === address);
  }
}

/** Bearer token = subject. */
export const fakeVerifier: TokenVerifier = { verify: async (t) => ({ subject: t }) };

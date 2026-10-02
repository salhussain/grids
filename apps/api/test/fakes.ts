import type { TokenVerifier } from '../src/auth/tokens.js';
import type { IdentityProvider, UserProfile } from '../src/idp/types.js';
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

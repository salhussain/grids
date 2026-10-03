import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { authenticator } from 'otplib';
import type { IdentityDB } from '@grids/db';
import { dummyHash, hashPassword, passwordProblem, randomCode, randomToken, recoveryCode, sha256, verifyPassword, type Sealer } from './crypto.js';
import type { Mailer } from './mailer.js';

/** Thrown for expected, user-facing failures; `code` maps to an i18n key. */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const CODE_ATTEMPTS = 5;
// Accept the previous/next 30s step to tolerate clock drift.
authenticator.options = { window: 1 };

export interface AccountRow {
  id: string;
  email: string;
  email_verified: boolean;
  given_name: string | null;
  family_name: string | null;
  locale: string | null;
  status: 'active' | 'disabled';
}

export class Accounts {
  constructor(
    private readonly db: Kysely<IdentityDB>,
    private readonly sealer: Sealer,
    private readonly mailer: Mailer,
  ) {}

  find(id: string) {
    return this.db.selectFrom('account').selectAll().where('id', '=', id).executeTakeFirst();
  }
  findByEmail(email: string) {
    return this.db.selectFrom('account').selectAll().where('email', '=', email).executeTakeFirst();
  }

  async event(accountId: string | null, email: string | null, ip: string | null, event: string, success: boolean) {
    await this.db.insertInto('login_event').values({ account_id: accountId, email, ip, event, success }).execute();
  }

  /** Password check with lockout after repeated failures. Never reveals whether the email exists. */
  async authenticate(email: string, password: string, ip: string | null): Promise<AccountRow & { password_hash: string | null }> {
    const account = await this.findByEmail(email);
    if (!account || !account.password_hash) {
      await verifyPassword(await dummyHash(), password); // keep timing similar
      await this.event(account?.id ?? null, email, ip, 'login', false);
      throw new AuthError('invalid_credentials', 401);
    }
    if (account.locked_until && account.locked_until > new Date()) {
      throw new AuthError('account_locked', 423, { minutes: Math.ceil((account.locked_until.getTime() - Date.now()) / 60_000) });
    }
    if (!(await verifyPassword(account.password_hash, password))) {
      const failed = account.failed_logins + 1;
      await this.db
        .updateTable('account')
        .set({ failed_logins: failed, locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where('id', '=', account.id)
        .execute();
      await this.event(account.id, email, ip, 'login', false);
      if (failed >= MAX_FAILED) throw new AuthError('account_locked', 423, { minutes: LOCK_MINUTES });
      throw new AuthError('invalid_credentials', 401);
    }
    if (account.status !== 'active') throw new AuthError('account_disabled', 403);
    await this.db.updateTable('account').set({ failed_logins: 0, locked_until: null }).where('id', '=', account.id).execute();
    return account;
  }

  async markLoggedIn(accountId: string, ip: string | null) {
    await this.db.updateTable('account').set({ last_login_at: new Date() }).where('id', '=', accountId).execute();
    const a = await this.find(accountId);
    await this.event(accountId, a?.email ?? null, ip, 'login', true);
  }

  async register(input: { email: string; password: string; givenName: string; familyName: string; locale?: string; orgId?: string | null }) {
    const problem = passwordProblem(input.password, input.email);
    if (problem) throw new AuthError(problem);
    if (await this.findByEmail(input.email)) throw new AuthError('email_taken', 409);
    const id = randomUUID();
    await this.db
      .insertInto('account')
      .values({
        id,
        email: input.email,
        password_hash: await hashPassword(input.password),
        given_name: input.givenName,
        family_name: input.familyName,
        locale: input.locale ?? null,
        password_changed_at: new Date(),
      })
      .execute();
    if (input.orgId) await this.linkToOrg(id, input.orgId);
    return (await this.find(id))!;
  }

  /** Account created by an administrator: no password yet (set via the emailed setup link). */
  async createInvited(input: { email: string; givenName: string; familyName: string; locale?: string }) {
    const id = randomUUID();
    await this.db
      .insertInto('account')
      .values({ id, email: input.email, given_name: input.givenName, family_name: input.familyName, locale: input.locale ?? null })
      .execute();
    return (await this.find(id))!;
  }

  async setStatus(accountId: string, status: 'active' | 'disabled') {
    await this.db.updateTable('account').set({ status }).where('id', '=', accountId).execute();
  }

  /** Development bootstrap only. */
  async setPasswordDirect(accountId: string, passwordHash: string) {
    await this.db
      .updateTable('account')
      .set({ password_hash: passwordHash, email_verified: true, password_changed_at: new Date() })
      .where('id', '=', accountId)
      .execute();
  }

  // ---------- email codes & links ----------

  async sendVerificationCode(account: AccountRow) {
    await this.db.updateTable('email_token').set({ used_at: new Date() }).where('account_id', '=', account.id).where('kind', '=', 'verify').where('used_at', 'is', null).execute();
    const code = randomCode();
    await this.db
      .insertInto('email_token')
      .values({ id: randomUUID(), account_id: account.id, kind: 'verify', token_hash: sha256(`${account.id}:${code}`), expires_at: new Date(Date.now() + 15 * 60_000) })
      .execute();
    await this.mailer.send(account, 'verify', { code });
  }

  async verifyEmail(accountId: string, code: string) {
    const token = await this.db
      .selectFrom('email_token')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('kind', '=', 'verify')
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!token) throw new AuthError('session_expired');
    if (token.attempts >= CODE_ATTEMPTS) throw new AuthError('too_many_attempts', 429);
    if (token.token_hash !== sha256(`${accountId}:${code.trim()}`)) {
      await this.db.updateTable('email_token').set({ attempts: token.attempts + 1 }).where('id', '=', token.id).execute();
      throw new AuthError('invalid_code');
    }
    await this.db.updateTable('email_token').set({ used_at: new Date() }).where('id', '=', token.id).execute();
    await this.db.updateTable('account').set({ email_verified: true }).where('id', '=', accountId).execute();
  }

  /** Emails a password reset (or initial setup) link. Silent when the account doesn't exist. */
  async sendPasswordLink(email: string, kind: 'reset' | 'setup', origin: string) {
    const account = await this.findByEmail(email);
    if (!account || account.status !== 'active') return;
    const token = randomToken();
    const ttl = kind === 'setup' ? 7 * 24 * 60 : 60;
    await this.db
      .insertInto('email_token')
      .values({ id: randomUUID(), account_id: account.id, kind, token_hash: sha256(token), expires_at: new Date(Date.now() + ttl * 60_000) })
      .execute();
    await this.mailer.send(account, kind, { link: `${origin}/ui/${kind === 'setup' ? 'setup' : 'reset'}/${token}`, email: account.email });
  }

  async checkPasswordToken(token: string) {
    const row = await this.db
      .selectFrom('email_token')
      .innerJoin('account', 'account.id', 'email_token.account_id')
      .select(['email_token.id', 'email_token.kind', 'account.id as account_id', 'account.email', 'account.locale'])
      .where('email_token.token_hash', '=', sha256(token))
      .where('email_token.kind', 'in', ['reset', 'setup'])
      .where('email_token.used_at', 'is', null)
      .where('email_token.expires_at', '>', new Date())
      .executeTakeFirst();
    if (!row) throw new AuthError('invalid_link', 404);
    return row;
  }

  /** Members of an organisation land in the workspace; everyone else (platform staff) in the console. */
  async homeApp(accountId: string): Promise<'web' | 'console'> {
    const org = await this.db.selectFrom('account_org').select('org_id').where('account_id', '=', accountId).executeTakeFirst();
    return org ? 'web' : 'console';
  }

  async resetPassword(token: string, password: string) {
    const row = await this.checkPasswordToken(token);
    const problem = passwordProblem(password, row.email);
    if (problem) throw new AuthError(problem);
    await this.db.transaction().execute(async (tx) => {
      await tx.updateTable('email_token').set({ used_at: new Date() }).where('id', '=', row.id).execute();
      await tx
        .updateTable('account')
        // A link sent to the inbox also proves the email address.
        .set({ password_hash: await hashPassword(password), password_changed_at: new Date(), email_verified: true, failed_logins: 0, locked_until: null })
        .where('id', '=', row.account_id)
        .execute();
    });
    await this.event(row.account_id, row.email, null, `password_${row.kind}`, true);
    return row;
  }

  async changePassword(accountId: string, current: string, next: string) {
    const a = await this.find(accountId);
    if (!a?.password_hash || !(await verifyPassword(a.password_hash, current))) throw new AuthError('wrong_password', 403);
    const problem = passwordProblem(next, a.email);
    if (problem) throw new AuthError(problem);
    await this.db.updateTable('account').set({ password_hash: await hashPassword(next), password_changed_at: new Date() }).where('id', '=', accountId).execute();
    await this.event(accountId, a.email, null, 'password_changed', true);
  }

  // ---------- two-factor (TOTP + recovery codes) ----------

  async totpStatus(accountId: string) {
    const t = await this.db.selectFrom('account_totp').select(['confirmed_at']).where('account_id', '=', accountId).executeTakeFirst();
    const left = await this.db
      .selectFrom('account_recovery_code')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('account_id', '=', accountId)
      .where('used_at', 'is', null)
      .executeTakeFirstOrThrow();
    return { enabled: !!t?.confirmed_at, recoveryCodesLeft: Number(left.n) };
  }

  /** Starts (or restarts) enrolment: returns the secret and otpauth URI. */
  async startTotp(account: AccountRow, issuer: string) {
    const secret = authenticator.generateSecret(20);
    await this.db
      .insertInto('account_totp')
      .values({ account_id: account.id, secret_enc: this.sealer.seal(secret) })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ secret_enc: this.sealer.seal(secret), confirmed_at: null, last_used_step: null }))
      .execute();
    return { secret, uri: authenticator.keyuri(account.email, issuer, secret) };
  }

  /** Confirms enrolment with a first code; returns fresh recovery codes. */
  async confirmTotp(accountId: string, code: string): Promise<string[]> {
    await this.checkTotp(accountId, code, { allowUnconfirmed: true });
    await this.db.updateTable('account_totp').set({ confirmed_at: new Date() }).where('account_id', '=', accountId).execute();
    await this.event(accountId, null, null, 'mfa_enabled', true);
    return this.regenerateRecoveryCodes(accountId);
  }

  async regenerateRecoveryCodes(accountId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, recoveryCode);
    await this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('account_recovery_code').where('account_id', '=', accountId).execute();
      await tx.insertInto('account_recovery_code').values(codes.map((c) => ({ account_id: accountId, code_hash: sha256(c) }))).execute();
    });
    return codes;
  }

  async disableTotp(accountId: string) {
    await this.db.deleteFrom('account_totp').where('account_id', '=', accountId).execute();
    await this.db.deleteFrom('account_recovery_code').where('account_id', '=', accountId).execute();
    await this.event(accountId, null, null, 'mfa_disabled', true);
  }

  /** Verifies a TOTP code (no reuse of the same 30s step) or a single-use recovery code. */
  async checkSecondFactor(accountId: string, input: { code?: string; recoveryCode?: string }) {
    if (input.recoveryCode) {
      const res = await this.db
        .updateTable('account_recovery_code')
        .set({ used_at: new Date() })
        .where('account_id', '=', accountId)
        .where('code_hash', '=', sha256(input.recoveryCode.trim().toUpperCase()))
        .where('used_at', 'is', null)
        .executeTakeFirst();
      if (res.numUpdatedRows === 0n) throw new AuthError('invalid_code');
      await this.event(accountId, null, null, 'recovery_code_used', true);
      return;
    }
    await this.checkTotp(accountId, input.code ?? '', { allowUnconfirmed: false });
  }

  private async checkTotp(accountId: string, code: string, opts: { allowUnconfirmed: boolean }) {
    const t = await this.db.selectFrom('account_totp').selectAll().where('account_id', '=', accountId).executeTakeFirst();
    if (!t || (!t.confirmed_at && !opts.allowUnconfirmed)) throw new AuthError('invalid_code');
    const secret = this.sealer.open(t.secret_enc);
    const clean = code.replace(/\s/g, '');
    const delta = authenticator.checkDelta(clean, secret);
    if (delta === null) throw new AuthError('invalid_code');
    const step = Math.floor(Date.now() / 30_000) + delta;
    if (t.last_used_step !== null && BigInt(t.last_used_step) >= BigInt(step)) throw new AuthError('invalid_code'); // replay
    await this.db.updateTable('account_totp').set({ last_used_step: String(step) }).where('account_id', '=', accountId).execute();
  }

  // ---------- organisations & policy ----------

  async upsertOrg(id: string, name: string, policy: { mfaRequired?: boolean; allowRegistration?: boolean } = {}) {
    await this.db
      .insertInto('org')
      .values({ id, name, mfa_required: policy.mfaRequired ?? false, allow_registration: policy.allowRegistration ?? true })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name,
          ...(policy.mfaRequired !== undefined && { mfa_required: policy.mfaRequired }),
          ...(policy.allowRegistration !== undefined && { allow_registration: policy.allowRegistration }),
        }),
      )
      .execute();
  }

  findOrg(id: string) {
    return this.db.selectFrom('org').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async linkToOrg(accountId: string, orgId: string) {
    await this.db.insertInto('account_org').values({ account_id: accountId, org_id: orgId }).onConflict((oc) => oc.doNothing()).execute();
  }

  /** True when any of the account's organisations requires a second factor. */
  async mfaRequired(accountId: string): Promise<boolean> {
    const row = await sql<{ required: boolean }>`
      select exists (select 1 from account_org ao join org o on o.id = ao.org_id where ao.account_id = ${accountId} and o.mfa_required) as required
    `.execute(this.db);
    return Boolean(row.rows[0]?.required);
  }

  // ---------- pending logins (between password and second factor) ----------

  async setPending(uid: string, accountId: string, stage: 'verify_email' | 'mfa' | 'mfa_setup', remember: boolean) {
    await this.db
      .insertInto('pending_login')
      .values({ uid, account_id: accountId, stage, remember, expires_at: new Date(Date.now() + 15 * 60_000) })
      .onConflict((oc) => oc.column('uid').doUpdateSet({ account_id: accountId, stage, remember }))
      .execute();
  }

  async getPending(uid: string) {
    const p = await this.db.selectFrom('pending_login').selectAll().where('uid', '=', uid).where('expires_at', '>', new Date()).executeTakeFirst();
    if (!p) throw new AuthError('session_expired', 410);
    return p;
  }

  async clearPending(uid: string) {
    await this.db.deleteFrom('pending_login').where('uid', '=', uid).execute();
  }
}

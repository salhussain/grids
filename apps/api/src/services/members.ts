import {
  uuidv7,
  type CreateInvitationInput,
  type CreatedInvitation,
  type InvitationDto,
  type InvitationPreview,
  type MeDto,
  type MembersDto,
  type PlanLimits,
  type UpdateMemberInput,
} from '@grids/schema';
import type { z } from 'zod';
import type { CreateInvitationInput as CreateInvitationSchema } from '@grids/schema';
import { conflict, forbidden, notFound } from '../errors.js';
import { requireTenantAccess } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { assertWithinLimit } from './entitlements.js';
import type { IdentityService } from './identity.js';
import { hashToken, iso, isoOrNull, isUniqueViolation, randomToken } from './util.js';
import { withTenant } from '@grids/db';
import { sql } from 'kysely';

const INVITE_TTL_DAYS = 7;
type InvitationData = z.output<typeof CreateInvitationSchema>;

/** People in an organisation: members, their status and MFA, and invitations. */
export class MemberService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly deps: {
      identity: IdentityService;
      seatsUsed: (tenantId: string) => Promise<number>;
    },
  ) {}

  async list(actor: Actor, tenantId: string): Promise<MembersDto> {
    const policy = await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.view',
      workspace: 'people.view',
      anywhere: true,
    });
    const scope = policy ? policy.scope('people.view') : 'all';
    const structure = await this.structure(tenantId);
    const visible = (path: string | null | undefined) =>
      scope === 'all' || (!!path && scope.some((p) => path === p || path.startsWith(`${p}.`)));
    const { db } = this.ctx;
    const tenant = await db
      .selectFrom('tenant')
      .select('mfa_required')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!tenant) throw notFound('Organisation');

    const members = await db
      .selectFrom('membership as m')
      .innerJoin('user_identity as u', 'u.id', 'm.user_id')
      .select([
        'u.id',
        'u.idp_subject',
        'u.email',
        'u.display_name',
        'u.given_name',
        'u.family_name',
        'u.last_seen_at',
        'm.phone',
        'm.job_title',
        'm.department',
        'm.role',
        'm.status',
        'm.created_at',
      ])
      .where('m.tenant_id', '=', tenantId)
      .orderBy('m.created_at')
      .execute()
      .then((rows) => rows.filter((m) => visible(structure.placements.get(m.id)?.path)));

    // MFA enrolment lives in the IdP; look it up per member, tolerating failures.
    const mfa = await Promise.all(
      members.map((m) =>
        this.ctx.idp.getUserSecondFactors(m.idp_subject).then(
          (methods) => ({ enrolled: methods.length > 0, methods }),
          () => null,
        ),
      ),
    );

    const invitations = await this.invitationQuery()
      .where('i.tenant_id', '=', tenantId)
      .orderBy('i.created_at', 'desc')
      .execute();

    return {
      mfaRequired: tenant.mfa_required,
      members: members.map((m, i) => ({
        userId: m.id,
        email: m.email,
        displayName: m.display_name,
        givenName: m.given_name,
        familyName: m.family_name,
        phone: m.phone,
        jobTitle: m.job_title,
        department: m.department,
        role: m.role,
        status: m.status,
        mfa: mfa[i] ?? null,
        orgUnit: structure.placements.get(m.id) ?? null,
        grants: structure.grants.get(m.id) ?? [],
        joinedAt: iso(m.created_at),
        lastSeenAt: isoOrNull(m.last_seen_at),
      })),
      // Outstanding invitations only (pending or expired, so they can be re-sent).
      invitations: invitations
        .filter((i) => !i.accepted_at && !i.revoked_at)
        .filter((i) => visible(i.org_unit_id ? structure.units.get(i.org_unit_id)?.path : null))
        .map((i) => this.toInvitationDto(i)),
    };
  }

  async update(
    actor: Actor,
    tenantId: string,
    userId: string,
    input: UpdateMemberInput,
  ): Promise<MembersDto> {
    const target = (await this.structure(tenantId)).placements.get(userId);
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'people.manage',
      unitPath: target?.path,
    });
    const { db } = this.ctx;
    const m = await db
      .selectFrom('membership')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!m) throw notFound('Member');

    const losesAdmin =
      m.role === 'org_admin' &&
      m.status === 'active' &&
      ((input.role && input.role !== 'org_admin') || input.status === 'suspended');
    if (losesAdmin) {
      const { n } = await db
        .selectFrom('membership')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('tenant_id', '=', tenantId)
        .where('role', '=', 'org_admin')
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      if (Number(n) <= 1)
        throw conflict('Last administrator', 'Promote another administrator first.');
    }
    if (input.role === 'org_admin' && !actor.isPlatformAdmin && m.role !== 'org_admin') {
      await requireTenantAccess(this.ctx, actor, tenantId, {
        staff: 'members.manage',
        workspace: 'people.manage',
      });
    }
    if (userId === actor.id && input.status === 'suspended')
      throw forbidden('You cannot suspend yourself.');

    const set = {
      ...(input.role && { role: input.role }),
      ...(input.status && { status: input.status, status_changed_at: this.ctx.now() }),
      ...(input.jobTitle !== undefined && { job_title: input.jobTitle || null }),
      ...(input.department !== undefined && { department: input.department || null }),
      ...(input.phone !== undefined && { phone: input.phone || null }),
    };
    if (Object.keys(set).length) {
      await db
        .updateTable('membership')
        .set(set)
        .where('tenant_id', '=', tenantId)
        .where('user_id', '=', userId)
        .execute();
      const email = (
        await db
          .selectFrom('user_identity')
          .select('email')
          .where('id', '=', userId)
          .executeTakeFirst()
      )?.email;
      const action = input.status
        ? `member.${input.status === 'suspended' ? 'suspended' : 'reactivated'}`
        : 'member.updated';
      await audit(this.ctx, actor.id, tenantId, action, { member: email, ...input });
    }
    return this.list(actor, tenantId);
  }

  // ---------- invitations ----------

  async invite(actor: Actor, tenantId: string, input: InvitationData): Promise<CreatedInvitation> {
    const unit = input.orgUnitId
      ? (await this.structure(tenantId)).units.get(input.orgUnitId)
      : undefined;
    if (input.orgUnitId && !unit) throw notFound('Org unit');
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'people.invite',
      unitPath: unit?.path,
    });
    // Only organisation-wide people managers may invite administrators.
    if (input.role === 'org_admin')
      await requireTenantAccess(this.ctx, actor, tenantId, {
        staff: 'members.manage',
        workspace: 'people.manage',
      });
    const { db } = this.ctx;
    const t = await db
      .selectFrom('tenant as t')
      .leftJoin('plan as p', 'p.id', 't.plan_id')
      .select(['t.status', 't.name', 'p.limits'])
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    if (!t) throw notFound('Organisation');
    if (t.status !== 'active') {
      throw conflict(
        'Organisation not active',
        'Invitations open once the subscription is paid (or trialing) and provisioned.',
      );
    }
    const already = await db
      .selectFrom('membership as m')
      .innerJoin('user_identity as u', 'u.id', 'm.user_id')
      .select('m.user_id')
      .where('m.tenant_id', '=', tenantId)
      .where('u.email', '=', input.email)
      .executeTakeFirst();
    if (already)
      throw conflict('Already a member', `${input.email} is already in this organisation.`);
    assertWithinLimit((t.limits ?? {}) as PlanLimits, 'users', await this.deps.seatsUsed(tenantId));

    const token = randomToken();
    let row;
    try {
      row = await db
        .insertInto('invitation')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          email: input.email,
          role: input.role,
          first_name: input.firstName,
          last_name: input.lastName,
          job_title: input.jobTitle ?? null,
          department: input.department ?? null,
          phone: input.phone ?? null,
          message: input.message ?? null,
          org_unit_id: input.orgUnitId ?? null,
          token_hash: hashToken(token),
          invited_by: actor.id,
          expires_at: new Date(this.ctx.now().getTime() + INVITE_TTL_DAYS * 86_400_000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict(
          'Invitation already pending',
          `${input.email} already has a pending invite.`,
        );
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, 'invitation.created', {
      email: input.email,
      role: input.role,
    });
    const inviteUrl = `${this.ctx.workspaceUrl}/invite/${token}`;
    const emailSent = await this.sendInvite(tenantId, t.name, input, inviteUrl);
    return { invitation: await this.getInvitation(row.id), inviteUrl, emailSent };
  }

  /** Issues a fresh token (old link stops working) and re-sends the email. */
  async resend(actor: Actor, tenantId: string, invitationId: string): Promise<CreatedInvitation> {
    const inv = await this.pendingInvitation(tenantId, invitationId);
    await this.requireInviteScope(actor, tenantId, inv.org_unit_id);
    const token = randomToken();
    await this.ctx.db
      .updateTable('invitation')
      .set({
        token_hash: hashToken(token),
        expires_at: new Date(this.ctx.now().getTime() + INVITE_TTL_DAYS * 86_400_000),
      })
      .where('id', '=', invitationId)
      .execute();
    const tenant = await this.ctx.db
      .selectFrom('tenant')
      .select('name')
      .where('id', '=', tenantId)
      .executeTakeFirstOrThrow();
    const inviteUrl = `${this.ctx.workspaceUrl}/invite/${token}`;
    const emailSent = await this.sendInvite(
      tenantId,
      tenant.name,
      {
        email: inv.email,
        firstName: inv.first_name ?? '',
        role: inv.role,
        message: inv.message ?? undefined,
      },
      inviteUrl,
    );
    await audit(this.ctx, actor.id, tenantId, 'invitation.resent', { email: inv.email });
    return { invitation: await this.getInvitation(invitationId), inviteUrl, emailSent };
  }

  async revoke(actor: Actor, tenantId: string, invitationId: string): Promise<MembersDto> {
    const inv = await this.pendingInvitation(tenantId, invitationId);
    await this.requireInviteScope(actor, tenantId, inv.org_unit_id);
    await this.ctx.db
      .updateTable('invitation')
      .set({ revoked_at: this.ctx.now() })
      .where('id', '=', invitationId)
      .execute();
    await audit(this.ctx, actor.id, tenantId, 'invitation.revoked', { email: inv.email });
    return this.list(actor, tenantId);
  }

  async preview(token: string): Promise<InvitationPreview> {
    const inv = await this.byToken(token);
    return {
      tenantName: inv.tenant_name,
      tenantSlug: inv.tenant_slug,
      idpOrgId: inv.idp_org_id,
      email: inv.email,
      firstName: inv.first_name,
      role: inv.role,
      mfaRequired: inv.mfa_required,
      status: this.invitationStatus(inv),
    };
  }

  async accept(actor: Actor, token: string): Promise<MeDto> {
    const inv = await this.byToken(token);
    const status = this.invitationStatus(inv);
    if (status !== 'pending')
      throw conflict(status === 'accepted' ? 'Invitation already used' : `Invitation ${status}`);
    if (!actor.email || actor.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw forbidden(`This invitation is for ${inv.email}. Sign in with that email address.`);
    }
    const { db } = this.ctx;
    await db.transaction().execute(async (tx) => {
      const claimed = await tx
        .updateTable('invitation')
        .set({ accepted_at: this.ctx.now(), accepted_by: actor.id })
        .where('id', '=', inv.id)
        .where('accepted_at', 'is', null)
        .executeTakeFirst();
      if (claimed.numUpdatedRows === 0n) throw conflict('Invitation already used');
      await tx
        .insertInto('membership')
        .values({
          tenant_id: inv.tenant_id,
          user_id: actor.id,
          role: inv.role,
          job_title: inv.job_title,
          department: inv.department,
          phone: inv.phone,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'user_id']).doUpdateSet({ role: inv.role, status: 'active' }),
        )
        .execute();
      // Fill person details the IdP didn't provide.
      await tx
        .updateTable('user_identity')
        .set((eb) => ({
          given_name: eb.fn.coalesce('given_name', eb.val(inv.first_name)),
          family_name: eb.fn.coalesce('family_name', eb.val(inv.last_name)),
          phone: eb.fn.coalesce('phone', eb.val(inv.phone)),
        }))
        .where('id', '=', actor.id)
        .execute();
    });
    if (inv.org_unit_id) await this.place(inv.tenant_id, actor.id, inv.org_unit_id);
    await this.linkToIdpOrg(inv.tenant_id, actor.id);
    await audit(this.ctx, actor.id, inv.tenant_id, 'invitation.accepted', {
      email: inv.email,
      role: inv.role,
    });
    return this.deps.identity.me(actor);
  }

  /**
   * Links the member's sign-in account to the tenant's IdP organisation so its sign-in
   * policy (such as required 2FA) applies to them. Best effort: membership already exists.
   */
  private async linkToIdpOrg(tenantId: string, userId: string) {
    const row = await this.ctx.db
      .selectFrom('tenant as t')
      .innerJoin('user_identity as u', (j) => j.on('u.id', '=', userId))
      .select(['t.idp_org_id', 'u.idp_subject'])
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    if (!row?.idp_org_id || !row.idp_subject) return;
    await this.ctx.idp.linkUserToOrganization(row.idp_org_id, row.idp_subject).catch(() => undefined);
  }

  /** Moves a member to an org unit (or unplaces them): needs people.manage at both ends. */
  async setPlacement(
    actor: Actor,
    tenantId: string,
    userId: string,
    orgUnitId: string | null,
  ): Promise<MembersDto> {
    const structure = await this.structure(tenantId);
    const member = await this.ctx.db
      .selectFrom('membership')
      .select('user_id')
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!member) throw notFound('Member');
    const to = orgUnitId ? structure.units.get(orgUnitId) : undefined;
    if (orgUnitId && !to) throw notFound('Org unit');
    const from = structure.placements.get(userId);
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'people.manage',
      unitPath: from?.path,
    });
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'people.manage',
      unitPath: to?.path,
    });
    if (orgUnitId) await this.place(tenantId, userId, orgUnitId);
    else {
      const cell = await this.ctx.cells.forTenant(tenantId);
      await withTenant(cell, tenantId, (tx) =>
        tx.deleteFrom('member_placement').where('user_id', '=', userId).execute(),
      );
    }
    const email = (
      await this.ctx.db
        .selectFrom('user_identity')
        .select('email')
        .where('id', '=', userId)
        .executeTakeFirst()
    )?.email;
    await audit(this.ctx, actor.id, tenantId, 'member.placed', {
      member: email,
      from: from?.name ?? 'none',
      to: to?.name ?? 'none',
    });
    return this.list(actor, tenantId);
  }

  // ---------- internals ----------

  private async place(tenantId: string, userId: string, orgUnitId: string) {
    const cell = await this.ctx.cells.forTenant(tenantId);
    await withTenant(cell, tenantId, (tx) =>
      tx
        .insertInto('member_placement')
        .values({ tenant_id: tenantId, user_id: userId, org_unit_id: orgUnitId })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'user_id']).doUpdateSet({ org_unit_id: orgUnitId }),
        )
        .execute(),
    );
  }

  private async requireInviteScope(actor: Actor, tenantId: string, orgUnitId: string | null) {
    const unit = orgUnitId ? (await this.structure(tenantId)).units.get(orgUnitId) : undefined;
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'people.invite',
      unitPath: unit?.path,
    });
  }

  /** Org units, placements and grants from the tenant cell. */
  private async structure(tenantId: string) {
    const cell = await this.ctx.cells.forTenant(tenantId);
    return withTenant(cell, tenantId, async (tx) => {
      const units = await sql<{
        id: string;
        name: string;
        path: string;
      }>`select id, name, path::text as path from org_unit`.execute(tx);
      const placements = await tx
        .selectFrom('member_placement')
        .select(['user_id', 'org_unit_id'])
        .execute();
      const grants = await tx
        .selectFrom('role_grant as g')
        .innerJoin('workspace_role as r', 'r.id', 'g.role_id')
        .leftJoin('org_unit as u', 'u.id', 'g.org_unit_id')
        .select(['g.user_id', 'r.name as role_name', 'u.name as unit_name'])
        .orderBy('r.name')
        .execute();
      const unitMap = new Map(units.rows.map((u) => [u.id, u]));
      const placementMap = new Map(
        placements.flatMap((p) => {
          const u = unitMap.get(p.org_unit_id);
          return u ? [[p.user_id, { id: u.id, name: u.name, path: u.path }] as const] : [];
        }),
      );
      const grantMap = new Map<string, { roleName: string; orgUnitName: string | null }[]>();
      for (const g of grants) {
        const list = grantMap.get(g.user_id) ?? [];
        list.push({ roleName: g.role_name, orgUnitName: g.unit_name });
        grantMap.set(g.user_id, list);
      }
      return { units: unitMap, placements: placementMap, grants: grantMap };
    });
  }

  private async sendInvite(
    tenantId: string,
    tenantName: string,
    input: { email: string; firstName: string; role: string; message?: string },
    inviteUrl: string,
  ): Promise<boolean> {
    const role = input.role === 'org_admin' ? 'an administrator' : 'a member';
    return this.ctx.email.send('invitation', tenantId, {
      to: input.email,
      subject: `You're invited to join ${tenantName} on Grids`,
      text: `Hello ${input.firstName || 'there'},

You've been invited to join ${tenantName} on Grids as ${role}.
${input.message ? `\n"${input.message}"\n` : ''}
Accept your invitation (link valid for ${INVITE_TTL_DAYS} days):
${inviteUrl}

If you weren't expecting this, you can ignore this email.

— The Grids team`,
    });
  }

  private invitationStatus(i: {
    accepted_at: Date | null;
    revoked_at: Date | null;
    expires_at: Date;
  }) {
    if (i.accepted_at) return 'accepted' as const;
    if (i.revoked_at) return 'revoked' as const;
    if (i.expires_at < this.ctx.now()) return 'expired' as const;
    return 'pending' as const;
  }

  private async pendingInvitation(tenantId: string, invitationId: string) {
    const inv = await this.ctx.db
      .selectFrom('invitation')
      .selectAll()
      .where('id', '=', invitationId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!inv) throw notFound('Invitation');
    if (inv.accepted_at || inv.revoked_at) throw conflict('Invitation is no longer pending');
    return inv;
  }

  private async byToken(token: string) {
    const inv = await this.ctx.db
      .selectFrom('invitation as i')
      .innerJoin('tenant as t', 't.id', 'i.tenant_id')
      .selectAll('i')
      .select(['t.name as tenant_name', 't.slug as tenant_slug', 't.idp_org_id', 't.mfa_required'])
      .where('i.token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!inv) throw notFound('Invitation');
    return inv;
  }

  private invitationQuery() {
    return this.ctx.db
      .selectFrom('invitation as i')
      .leftJoin('user_identity as u', 'u.id', 'i.invited_by')
      .selectAll('i')
      .select('u.email as invited_by_email');
  }

  private async getInvitation(id: string): Promise<InvitationDto> {
    return this.toInvitationDto(
      await this.invitationQuery().where('i.id', '=', id).executeTakeFirstOrThrow(),
    );
  }

  private toInvitationDto(i: {
    org_unit_id: string | null;
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    department: string | null;
    phone: string | null;
    role: 'org_admin' | 'member';
    invited_by_email: string | null;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  }): InvitationDto {
    return {
      id: i.id,
      email: i.email,
      firstName: i.first_name,
      lastName: i.last_name,
      jobTitle: i.job_title,
      department: i.department,
      phone: i.phone,
      role: i.role,
      orgUnitId: i.org_unit_id,
      status: this.invitationStatus(i),
      invitedBy: i.invited_by_email,
      expiresAt: iso(i.expires_at),
      acceptedAt: isoOrNull(i.accepted_at),
      createdAt: iso(i.created_at),
    };
  }
}

export type { CreateInvitationInput };

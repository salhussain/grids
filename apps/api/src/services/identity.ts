import { sql } from 'kysely';
import {
  PreferencesDto,
  STAFF_PERMISSIONS,
  SUPER_ADMIN_ROLE,
  uuidv7,
  type MeDto,
  type PreferencesInput,
} from '@grids/schema';
import { LOCALE_CODES } from '@grids/i18n';
import { badRequest } from '../errors.js';
import type { UserProfile } from '../idp/types.js';
import type { Actor, ServiceContext } from './context.js';

export class IdentityService {
  constructor(private readonly ctx: ServiceContext) {}

  /**
   * Maps a verified token subject to a platform identity, creating it on first
   * sight. The IdP profile is fetched only when the identity is new or has no email.
   */
  async resolve(subject: string, loadProfile: () => Promise<UserProfile>): Promise<Actor> {
    const { db } = this.ctx;
    let user = await db
      .selectFrom('user_identity')
      .selectAll()
      .where('idp_subject', '=', subject)
      .executeTakeFirst();
    if (!user || !user.email) {
      const p = await loadProfile();
      const values = {
        email: p.email,
        display_name: p.displayName,
        given_name: p.givenName ?? null,
        family_name: p.familyName ?? null,
      };
      user = await db
        .insertInto('user_identity')
        .values({ id: uuidv7(), idp_subject: subject, ...values })
        .onConflict((oc) => oc.column('idp_subject').doUpdateSet(values))
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    await db
      .updateTable('user_identity')
      .set({ last_seen_at: this.ctx.now() })
      .where('id', '=', user.id)
      .execute();
    const permissions = await this.staffPermissions(user.id);
    return { id: user.id, email: user.email, isPlatformAdmin: permissions.size > 0, permissions };
  }

  /** Effective console permissions of an active staff member (empty otherwise). */
  async staffPermissions(userId: string): Promise<Set<string>> {
    const row = await sql<{ permissions: string[] | null; is_super: boolean }>`
      select exists (
        select 1 from staff_member_role mr where mr.user_id = m.user_id and mr.role_id = ${SUPER_ADMIN_ROLE}
      ) as is_super,
      array(
        select unnest(m.extra_permissions)
        union
        select unnest(r.permissions)
          from staff_member_role mr join staff_role r on r.id = mr.role_id
          where mr.user_id = m.user_id
      ) as permissions
      from staff_member m
      where m.user_id = ${userId} and m.status = 'active'
    `.execute(this.ctx.db);
    const r = row.rows[0];
    // Super admins hold every permission, including ones added after their role was created.
    return new Set(r?.is_super ? STAFF_PERMISSIONS : (r?.permissions ?? []));
  }

  async me(actor: Actor): Promise<MeDto> {
    const { db } = this.ctx;
    const user = await db
      .selectFrom('user_identity')
      .selectAll()
      .where('id', '=', actor.id)
      .executeTakeFirstOrThrow();
    const memberships = await db
      .selectFrom('membership as m')
      .innerJoin('tenant as t', 't.id', 'm.tenant_id')
      .select(['t.id', 't.name', 't.slug', 'm.role', 'm.status'])
      .where('m.user_id', '=', actor.id)
      .orderBy('t.name')
      .execute();
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isPlatformAdmin: actor.isPlatformAdmin,
      permissions: [...actor.permissions].sort(),
      memberships: memberships.map((m) => ({
        tenantId: m.id,
        tenantName: m.name,
        tenantSlug: m.slug,
        role: m.role,
        status: m.status,
      })),
      preferences: readPreferences(user.preferences),
    };
  }

  /** Saves the signed-in person's colour mode and/or language. */
  async setPreferences(actor: Actor, input: PreferencesInput): Promise<MeDto> {
    if (input.locale && !(LOCALE_CODES as string[]).includes(input.locale))
      throw badRequest(`Unsupported language: ${input.locale}`);
    const { db } = this.ctx;
    const row = await db
      .selectFrom('user_identity')
      .select('preferences')
      .where('id', '=', actor.id)
      .executeTakeFirstOrThrow();
    const next = { ...readPreferences(row.preferences), ...stripUndefined(input) };
    await db
      .updateTable('user_identity')
      .set({ preferences: JSON.stringify(next) })
      .where('id', '=', actor.id)
      .execute();
    return this.me(actor);
  }

  /** Active staff who can work tickets (assignee picker). */
  async listStaff() {
    const rows = await this.ctx.db
      .selectFrom('staff_member as m')
      .innerJoin('user_identity as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.display_name', 'u.email'])
      .where('m.status', '=', 'active')
      .orderBy('u.display_name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.display_name ?? r.email ?? 'Staff',
      email: r.email,
    }));
  }
}

function readPreferences(raw: unknown): PreferencesDto {
  const parsed = PreferencesDto.partial().safeParse(raw ?? {});
  const p = parsed.success ? parsed.data : {};
  return { colorMode: p.colorMode ?? 'system', locale: p.locale ?? null };
}

const stripUndefined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

import { sql, type Kysely } from 'kysely';
import type { IdentityDB } from '@grids/db';

type Payload = Record<string, unknown> & { grantId?: string; uid?: string; userCode?: string; consumed?: number };

/**
 * oidc-provider storage adapter on Postgres (one table for all models).
 * Expired rows are ignored on read and swept periodically.
 */
export function createAdapterClass(db: Kysely<IdentityDB>) {
  return class PgAdapter {
    constructor(readonly kind: string) {}

    async upsert(id: string, payload: Payload, expiresIn?: number) {
      const values = {
        kind: this.kind,
        id,
        payload: JSON.stringify(payload),
        grant_id: payload.grantId ?? null,
        uid: payload.uid ?? null,
        user_code: payload.userCode ?? null,
        expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      };
      await db
        .insertInto('oidc_model')
        .values(values)
        .onConflict((oc) => oc.columns(['kind', 'id']).doUpdateSet({ ...values, consumed_at: null }))
        .execute();
    }

    async findBy(column: 'id' | 'uid' | 'user_code', value: string): Promise<Payload | undefined> {
      const row = await db
        .selectFrom('oidc_model')
        .select(['payload', 'consumed_at', 'expires_at'])
        .where('kind', '=', this.kind)
        .where(column, '=', value)
        .executeTakeFirst();
      if (!row || (row.expires_at && row.expires_at < new Date())) return undefined;
      const payload = row.payload as Payload;
      return row.consumed_at ? { ...payload, consumed: Math.floor(row.consumed_at.getTime() / 1000) } : payload;
    }

    find(id: string) {
      return this.findBy('id', id);
    }
    findByUid(uid: string) {
      return this.findBy('uid', uid);
    }
    findByUserCode(userCode: string) {
      return this.findBy('user_code', userCode);
    }

    async consume(id: string) {
      await db.updateTable('oidc_model').set({ consumed_at: new Date() }).where('kind', '=', this.kind).where('id', '=', id).execute();
    }

    async destroy(id: string) {
      await db.deleteFrom('oidc_model').where('kind', '=', this.kind).where('id', '=', id).execute();
    }

    async revokeByGrantId(grantId: string) {
      await db.deleteFrom('oidc_model').where('grant_id', '=', grantId).execute();
    }
  };
}

/** Removes expired OIDC rows and stale pending logins. */
export async function sweepExpired(db: Kysely<IdentityDB>) {
  await sql`delete from oidc_model where expires_at < now() - interval '1 hour'`.execute(db);
  await sql`delete from pending_login where expires_at < now()`.execute(db);
  await sql`delete from email_token where expires_at < now() - interval '7 days'`.execute(db);
}

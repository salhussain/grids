import { exportJWK, generateKeyPair, type JWK } from 'jose';
import type { Kysely } from 'kysely';
import type { IdentityDB } from '@grids/db';
import { randomToken } from './crypto.js';

/** Signing keys (RS256), generated on first start and persisted; the active one signs. */
export async function loadSigningKeys(db: Kysely<IdentityDB>): Promise<JWK[]> {
  let rows = await db.selectFrom('signing_key').selectAll().where('active', '=', true).orderBy('created_at', 'desc').execute();
  if (!rows.length) {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 });
    const jwk = { ...(await exportJWK(privateKey)), kid: randomToken(12), alg: 'RS256', use: 'sig' };
    await db.insertInto('signing_key').values({ kid: jwk.kid, private_jwk: JSON.stringify(jwk) }).onConflict((oc) => oc.doNothing()).execute();
    rows = await db.selectFrom('signing_key').selectAll().where('active', '=', true).orderBy('created_at', 'desc').execute();
  }
  return rows.map((r) => r.private_jwk as JWK);
}

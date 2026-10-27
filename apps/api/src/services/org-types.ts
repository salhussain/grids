import { sql, type Transaction } from 'kysely';
import type { CellDB } from '@grids/db';
import { PROJECT_TYPE_KEY } from '@grids/data';
import { Marker, ROOT_PARENT, uuidv7, type AttributeDef, type EntityTypeDto, type EntityTypeInput } from '@grids/schema';
import type { z } from 'zod';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { workspacePolicy } from './policy.js';
import type { ProjectService } from './projects.js';

type Tx = Transaction<CellDB>;

/** Organisation admins and holders of projects.manage manage what the organisation owns. */
export async function assertOrgManage(ctx: ServiceContext, actor: Actor, tenantId: string, message: string) {
  const policy = await workspacePolicy(ctx, actor, tenantId);
  if (!policy || !(policy.role === 'org_admin' || policy.has('projects.manage'))) throw forbidden(message);
}

/** Gives a project every organisation-wide entity type it does not hold yet (a linked copy of each). */
export async function applyOrgTypes(tx: Tx, tenantId: string, projectId: string): Promise<void> {
  const types = await tx.selectFrom('org_entity_type').selectAll().orderBy('sort').orderBy('name').execute();
  for (const t of types)
    await tx
      .insertInto('entity_type')
      .values({
        id: uuidv7(),
        tenant_id: tenantId,
        project_id: projectId,
        key: t.key,
        name: t.name,
        plural: t.plural,
        icon: t.icon,
        color: t.color,
        geometry: t.geometry,
        marker: JSON.stringify(t.marker),
        attributes: JSON.stringify(t.attributes),
        parent_types: t.parent_types,
        max_per_project: t.max_per_project,
        sort: t.sort,
        org_type_id: t.id,
      })
      .onConflict((oc) => oc.columns(['project_id', 'key']).doNothing())
      .execute();
}

/** Entity types defined once for the whole organisation. Each project holds a linked copy that is edited here. */
export class OrgTypeService {
  constructor(
    private ctx: ServiceContext,
    private projects: ProjectService,
  ) {}

  private assertManage(actor: Actor, tenantId: string) {
    return assertOrgManage(this.ctx, actor, tenantId, 'Managing entity types requires the projects.manage permission.');
  }

  async list(actor: Actor, tenantId: string): Promise<EntityTypeDto[]> {
    if (!(await workspacePolicy(this.ctx, actor, tenantId))) throw forbidden('You are not a member of this organisation.');
    return this.projects.cellTx(tenantId, async (tx) => {
      const rows = await tx.selectFrom('org_entity_type').selectAll().orderBy('sort').orderBy('name').execute();
      const counts = new Map(
        (
          await sql<{ id: string; n: string }>`
            select t.org_type_id::text as id, count(e.id)::text as n
            from entity_type t join entity e on e.type_id = t.id
            where t.org_type_id is not null group by 1
          `.execute(tx)
        ).rows.map((r) => [r.id, Number(r.n)]),
      );
      return rows.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        plural: t.plural,
        icon: t.icon,
        color: t.color,
        geometry: t.geometry,
        marker: Marker.parse(t.marker ?? {}),
        attributes: t.attributes as AttributeDef[],
        parentTypes: t.parent_types,
        maxPerProject: t.max_per_project,
        orgId: t.id,
        count: counts.get(t.id) ?? 0,
      }));
    });
  }

  async save(actor: Actor, tenantId: string, input: z.output<typeof EntityTypeInput>, existingKey?: string): Promise<EntityTypeDto[]> {
    await this.assertManage(actor, tenantId);
    if (new Set(input.attributes.map((x) => x.key)).size !== input.attributes.length) throw badRequest('Attribute keys must be unique');
    if (input.key === PROJECT_TYPE_KEY || existingKey === PROJECT_TYPE_KEY) throw badRequest(`"${PROJECT_TYPE_KEY}" is reserved for the project itself`);
    if (existingKey && input.key !== existingKey) throw badRequest('A type’s key cannot change');
    await this.projects.cellTx(tenantId, async (tx) => {
      const keys = (await tx.selectFrom('org_entity_type').select('key').execute()).map((r) => r.key);
      const unknown = input.parentTypes.filter((p) => p !== ROOT_PARENT && p !== input.key && !keys.includes(p));
      if (unknown.length) throw badRequest(`Organisation types can only sit inside other organisation types (unknown: ${unknown.join(', ')})`);
      const values = {
        name: input.name,
        plural: input.plural,
        icon: input.icon,
        color: input.color,
        geometry: input.geometry,
        marker: JSON.stringify(input.marker),
        attributes: JSON.stringify(input.attributes),
        parent_types: input.parentTypes,
        // Entities of organisation types are shared, so a per-project cap makes no sense for them.
        max_per_project: null,
      };
      if (existingKey) {
        const row = await tx.selectFrom('org_entity_type').select('id').where('key', '=', existingKey).executeTakeFirst();
        if (!row) throw notFound('Entity type');
        await tx.updateTable('org_entity_type').set(values).where('id', '=', row.id).execute();
        await tx.updateTable('entity_type').set(values).where('org_type_id', '=', row.id).execute();
        return;
      }
      if (keys.includes(input.key)) throw conflict('Key taken', `An organisation entity type with key "${input.key}" already exists.`);
      const clash = await tx
        .selectFrom('entity_type as t')
        .innerJoin('project as p', 'p.id', 't.project_id')
        .select('p.name')
        .where('t.key', '=', input.key)
        .where('t.org_type_id', 'is', null)
        .executeTakeFirst();
      if (clash) throw conflict('Key in use', `The project "${clash.name}" already has its own entity type with key "${input.key}". Rename or remove it first.`);
      const sort = keys.length;
      const orgId = uuidv7();
      await tx.insertInto('org_entity_type').values({ id: orgId, tenant_id: tenantId, key: input.key, sort, ...values }).execute();
      // The shared row: where the organisation's own entities of this type live.
      await tx.insertInto('entity_type').values({ id: uuidv7(), tenant_id: tenantId, project_id: null, key: input.key, sort, org_type_id: orgId, ...values }).execute();
      const projects = await tx.selectFrom('project').select('id').execute();
      for (const p of projects) await applyOrgTypes(tx, tenantId, p.id);
    });
    await audit(this.ctx, actor.id, tenantId, existingKey ? 'org_entity_type.updated' : 'org_entity_type.created', { key: input.key });
    return this.list(actor, tenantId);
  }

  async remove(actor: Actor, tenantId: string, key: string): Promise<EntityTypeDto[]> {
    await this.assertManage(actor, tenantId);
    await this.projects.cellTx(tenantId, async (tx) => {
      const row = await tx.selectFrom('org_entity_type').select('id').where('key', '=', key).executeTakeFirst();
      if (!row) throw notFound('Entity type');
      const used = await sql<{ n: string }>`
        select count(*)::text as n from entity e join entity_type t on t.id = e.type_id where t.org_type_id = ${row.id}
      `.execute(tx);
      if (Number(used.rows[0]!.n)) throw conflict('Type in use', 'Delete or move the entities of this type in every project first.');
      const parent = await tx.selectFrom('org_entity_type').select('name').where(sql<boolean>`${key} = any(parent_types)`).where('key', '<>', key).executeTakeFirst();
      if (parent) throw conflict('Type in use', `"${parent.name}" can sit inside it. Change that first.`);
      const sits = await tx
        .selectFrom('entity_type')
        .select('name')
        .where(sql<boolean>`${key} = any(parent_types)`)
        .where('org_type_id', 'is', null)
        .executeTakeFirst();
      if (sits) throw conflict('Type in use', `The project type "${sits.name}" can sit inside it. Change that first.`);
      await tx.deleteFrom('entity_type').where('org_type_id', '=', row.id).execute();
      await tx.deleteFrom('org_entity_type').where('id', '=', row.id).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'org_entity_type.deleted', { key });
    return this.list(actor, tenantId);
  }
}

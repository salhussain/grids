import { sql } from 'kysely';
import { DataError, entityType, moveEntity, upsertEntities, importEntityRows } from '@grids/data';
import type { EntityDetail, EntityInput, EntityQuery, EntitySummary, EntityUpdate, Geometry, ImportRowsInput, Page, PointGeometry } from '@grids/schema';
import type { z } from 'zod';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { assertOrgManage } from './org-types.js';
import { workspacePolicy } from './policy.js';
import { dataCall, type ProjectService } from './projects.js';

/**
 * Entities of organisation types: owned by the organisation (no project), visible in every project.
 * Projects read them and record their own data against them; only the organisation edits them.
 */
export class SharedEntityService {
  constructor(
    private ctx: ServiceContext,
    private projects: ProjectService,
  ) {}

  private manage(actor: Actor, tenantId: string) {
    return assertOrgManage(this.ctx, actor, tenantId, 'Managing shared entities requires the projects.manage permission.');
  }

  async list(actor: Actor, tenantId: string, query: EntityQuery): Promise<Page<EntitySummary>> {
    if (!(await workspacePolicy(this.ctx, actor, tenantId))) throw forbidden('You are not a member of this organisation.');
    return this.projects.cellTx(tenantId, async (tx) => {
      let q = tx
        .selectFrom('entity as e')
        .innerJoin('entity_type as t', 't.id', 'e.type_id')
        .leftJoin('entity as p', 'p.id', 'e.parent_id')
        .where('e.project_id', 'is', null);
      if (query.type) q = q.where('t.key', 'in', query.type.split(','));
      if (query.parentId === 'root') q = q.where('e.parent_id', 'is', null);
      else if (query.parentId) q = q.where('e.parent_id', '=', query.parentId);
      if (query.q) {
        const like = `%${query.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
        q = q.where((eb) => eb.or([eb(sql`lower(e.name)`, 'like', like), eb(sql`lower(e.code)`, 'like', like)]));
      }
      const [items, total] = await Promise.all([
        q.select([...this.projects.summarySelect(null)]).orderBy('t.sort').orderBy('t.name').orderBy('e.name').limit(query.pageSize).offset((query.page - 1) * query.pageSize).execute(),
        q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      ]);
      return { items: items.map((r) => this.projects.toSummary(r as never)), total: Number(total.n), page: query.page, pageSize: query.pageSize };
    });
  }

  private async one(tenantId: string, id: string): Promise<EntitySummary> {
    return this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx
        .selectFrom('entity as e')
        .innerJoin('entity_type as t', 't.id', 'e.type_id')
        .leftJoin('entity as p', 'p.id', 'e.parent_id')
        .select([...this.projects.summarySelect(null)])
        .where('e.id', '=', id)
        .where('e.project_id', 'is', null)
        .executeTakeFirst();
      if (!r) throw notFound('Entity');
      return this.projects.toSummary(r as never);
    });
  }

  /** One shared entity with its place in the hierarchy. (Values and history are per project, so they are not shown here.) */
  async detail(actor: Actor, tenantId: string, id: string): Promise<EntityDetail> {
    if (!(await workspacePolicy(this.ctx, actor, tenantId))) throw forbidden('You are not a member of this organisation.');
    return this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx
        .selectFrom('entity as e')
        .innerJoin('entity_type as t', 't.id', 'e.type_id')
        .leftJoin('entity as p', 'p.id', 'e.parent_id')
        .select([
          ...this.projects.summarySelect(null),
          'e.version',
          'e.created_at',
          sql<string | null>`ST_AsGeoJSON(e.geom, 6)`.as('geo'),
          sql<string | null>`ST_AsGeoJSON(e.point, 6)`.as('point'),
          sql<string>`e.path::text`.as('path'),
        ])
        .where('e.id', '=', id)
        .where('e.project_id', 'is', null)
        .executeTakeFirst();
      if (!r) throw notFound('Entity');
      const ancestors = await sql<{ id: string; name: string; type_name: string }>`
        select a.id, a.name, t.name as type_name from entity a join entity_type t on t.id = a.type_id
        where a.path @> ${r.path}::ltree and a.id <> ${id} order by nlevel(a.path)
      `.execute(tx);
      return {
        ...this.projects.toSummary(r as never),
        version: r.version,
        geometry: r.geo ? (JSON.parse(r.geo) as Geometry) : null,
        point: r.point ? (JSON.parse(r.point) as PointGeometry) : null,
        ancestors: ancestors.rows.map((x) => ({ id: x.id, name: x.name, typeName: x.type_name })),
        latest: [],
        history: [],
        createdAt: r.created_at.toISOString(),
      };
    });
  }

  async create(actor: Actor, tenantId: string, input: z.output<typeof EntityInput>): Promise<EntitySummary> {
    await this.manage(actor, tenantId);
    const res = await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const type = await entityType(tx, null, input.typeKey);
        if (!type.orgTypeId) throw new DataError(`"${input.typeKey}" is not an organisation type`, 422);
        const attributes: Record<string, unknown> = { ...input.attributes };
        for (const d of type.attributes) if (d.default !== undefined && (attributes[d.key] === undefined || attributes[d.key] === null || attributes[d.key] === '')) attributes[d.key] = d.default;
        this.projects.checkRequired(type.attributes, attributes);
        const dupe = await tx.selectFrom('entity').select('id').where('project_id', 'is', null).where('type_id', '=', type.id).where('code', '=', input.code).executeTakeFirst();
        if (dupe) throw conflict('Code taken', `Another ${type.name} already has the code "${input.code}".`);
        return upsertEntities(tx, { tenantId, projectId: null, typeKey: input.typeKey, rows: [{ code: input.code, name: input.name, parentId: input.parentId, attributes, geometry: input.geometry }], source: 'user', actorId: actor.id });
      }),
    );
    const id = res.ids.get(input.code)!;
    if (input.point) await this.projects.cellTx(tenantId, (tx) => this.projects.setPoint(tx, id, input.point));
    await audit(this.ctx, actor.id, tenantId, 'shared_entity.created', { type: input.typeKey, code: input.code });
    return this.one(tenantId, id);
  }

  async update(actor: Actor, tenantId: string, id: string, input: z.output<typeof EntityUpdate>): Promise<EntitySummary> {
    await this.manage(actor, tenantId);
    await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const cur = await tx
          .selectFrom('entity as e')
          .innerJoin('entity_type as t', 't.id', 'e.type_id')
          .select(['e.id', 'e.code', 'e.name', 'e.version', 'e.parent_id', 'e.type_id', 't.key as type_key', sql<string>`e.path::text`.as('path')])
          .where('e.id', '=', id)
          .where('e.project_id', 'is', null)
          .executeTakeFirst();
        if (!cur) throw notFound('Entity');
        if (input.version !== undefined && input.version !== cur.version) throw conflict('Edited elsewhere', 'Someone else changed this entity. Reload to see their changes.');
        if (input.code && input.code !== cur.code) {
          const dupe = await tx.selectFrom('entity').select('id').where('project_id', 'is', null).where('type_id', '=', cur.type_id).where('code', '=', input.code).executeTakeFirst();
          if (dupe) throw conflict('Code taken', `Another entity already has the code "${input.code}".`);
          await tx.updateTable('entity').set({ code: input.code }).where('id', '=', id).execute();
        }
        await upsertEntities(tx, {
          tenantId,
          projectId: null,
          typeKey: cur.type_key,
          rows: [{ code: input.code ?? cur.code, name: input.name ?? cur.name, attributes: input.attributes, ...(input.geometry !== undefined && { geometry: input.geometry }) }],
          source: 'user',
          actorId: actor.id,
        });
        if (input.point !== undefined) await this.projects.setPoint(tx, id, input.point);
        if (input.parentId !== undefined && input.parentId !== cur.parent_id) {
          const parent = input.parentId
            ? await tx
                .selectFrom('entity as e')
                .innerJoin('entity_type as t', 't.id', 'e.type_id')
                .select(['e.id', sql<string>`e.path::text`.as('path'), 't.key'])
                .where('e.id', '=', input.parentId)
                .where('e.project_id', 'is', null)
                .executeTakeFirst()
            : null;
          if (input.parentId && !parent) throw badRequest('Parent not found');
          const type = await entityType(tx, null, cur.type_key);
          if (parent && !type.parentTypes.includes(parent.key)) throw badRequest(`A ${type.name} can't be placed under a ${parent.key}`);
          await moveEntity(tx, id, cur.path, parent ?? null);
        }
      }),
    );
    await audit(this.ctx, actor.id, tenantId, 'shared_entity.updated', { id });
    return this.one(tenantId, id);
  }

  async remove(actor: Actor, tenantId: string, id: string): Promise<void> {
    await this.manage(actor, tenantId);
    await this.projects.cellTx(tenantId, async (tx) => {
      const cur = await tx.selectFrom('entity').select('id').where('id', '=', id).where('project_id', 'is', null).executeTakeFirst();
      if (!cur) throw notFound('Entity');
      if (await tx.selectFrom('entity').select('id').where('parent_id', '=', id).executeTakeFirst()) throw conflict('Has children', 'Move or delete the entities under it first.');
      const used = await sql<{ n: string }>`select (select count(*) from observation where entity_id = ${id}) + (select count(*) from submission where entity_id = ${id}) as n`.execute(tx);
      if (Number(used.rows[0]!.n)) throw conflict('In use', 'Projects have data or submissions recorded against it, so it can’t be deleted.');
      await tx.deleteFrom('entity').where('id', '=', id).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'shared_entity.deleted', { id });
  }

  async importRows(actor: Actor, tenantId: string, input: z.output<typeof ImportRowsInput>) {
    await this.manage(actor, tenantId);
    const res = await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        return importEntityRows(tx, { tenantId, projectId: null, defaultTypeKey: input.typeKey, rows: input.rows, source: 'import', actorId: actor.id });
      }),
    );
    await audit(this.ctx, actor.id, tenantId, 'shared_entity.imported', { type: input.typeKey ?? Object.keys(res.byType).join(','), created: res.created, updated: res.updated });
    return { created: res.created, updated: res.updated, unchanged: res.unchanged, skipped: res.skipped };
  }
}

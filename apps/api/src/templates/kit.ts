import type { Transaction } from 'kysely';
import type { CellDB } from '@grids/db';
import { syncSchedule, upsertEntities, writeObservations, type EntityRowInput } from '@grids/data';
import {
  DashboardInput,
  DataElementInput,
  EntityTypeInput,
  FormDefinition,
  JobInput,
  uuidv7,
  type DashboardInput as DashboardIn,
  type DataElementInput as ElementIn,
  type EntityTypeInput as TypeIn,
  type FormDefinitionInput,
  type JobInput as JobIn,
} from '@grids/schema';

export type Tx = Transaction<CellDB>;
export interface TemplateCtx {
  tenantId: string;
  projectId: string;
  actorId: string;
}

/** Small deterministic PRNG (mulberry32) so seed data is reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    /** Poisson-ish count around a mean. */
    count: (mean: number) => Math.max(0, Math.round(mean + (next() + next() + next() - 1.5) * Math.sqrt(Math.max(mean, 1)) * 1.4)),
  };
}

export async function types(tx: Tx, c: TemplateCtx, list: TypeIn[]) {
  let sort = 0;
  for (const raw of list) {
    const t = EntityTypeInput.parse(raw);
    await tx
      .insertInto('entity_type')
      .values({
        id: uuidv7(),
        tenant_id: c.tenantId,
        project_id: c.projectId,
        key: t.key,
        name: t.name,
        plural: t.plural,
        icon: t.icon,
        color: t.color,
        geometry: t.geometry,
        attributes: JSON.stringify(t.attributes),
        parent_types: t.parentTypes,
        sort: sort++,
      })
      .execute();
  }
}

export async function elements(tx: Tx, c: TemplateCtx, list: ElementIn[]) {
  for (const raw of list) {
    const e = DataElementInput.parse(raw);
    await tx
      .insertInto('data_element')
      .values({ id: uuidv7(), tenant_id: c.tenantId, project_id: c.projectId, key: e.key, name: e.name, description: e.description, value_type: e.valueType, unit: e.unit, aggregation: e.aggregation })
      .execute();
  }
}

export const entities = (tx: Tx, c: TemplateCtx, typeKey: string, rows: EntityRowInput[]) =>
  upsertEntities(tx, { tenantId: c.tenantId, projectId: c.projectId, typeKey, rows, source: 'import', sourceRef: 'template', actorId: c.actorId });

export const observations = (tx: Tx, c: TemplateCtx, items: { entityId: string; element: string; at: Date; value: unknown }[]) =>
  writeObservations(tx, { tenantId: c.tenantId, projectId: c.projectId, items, source: 'import', sourceRef: 'template' });

export async function job(tx: Tx, c: TemplateCtx, raw: JobIn) {
  const j = JobInput.parse(raw);
  const id = uuidv7();
  await tx
    .insertInto('job')
    .values({
      id,
      tenant_id: c.tenantId,
      project_id: c.projectId,
      key: j.key,
      name: j.name,
      description: j.description,
      steps: JSON.stringify(j.steps),
      schedule: j.schedule,
      timezone: j.timezone,
      enabled: j.enabled,
      max_retries: j.maxRetries,
      timeout_seconds: j.timeoutSeconds,
      freshness_minutes: j.freshnessMinutes,
      run_on_upload: j.runOnUpload,
    })
    .execute();
  await syncSchedule(tx, { id, tenantId: c.tenantId, schedule: j.schedule, timezone: j.timezone, enabled: j.enabled });
  return id;
}

export async function dashboard(tx: Tx, c: TemplateCtx, raw: DashboardIn, sort = 0) {
  const d = DashboardInput.parse(raw);
  await tx
    .insertInto('dashboard')
    .values({ id: uuidv7(), tenant_id: c.tenantId, project_id: c.projectId, key: d.key, name: d.name, description: d.description, widgets: JSON.stringify(d.widgets), is_public: d.isPublic, sort })
    .execute();
}

/** Creates a form and publishes its first version. */
export async function form(tx: Tx, c: TemplateCtx, f: { key: string; name: string; description?: string; subjectType: string | null; definition: FormDefinitionInput }) {
  const def = FormDefinition.parse(f.definition);
  const subject = f.subjectType
    ? await tx.selectFrom('entity_type').select('id').where('project_id', '=', c.projectId).where('key', '=', f.subjectType).executeTakeFirstOrThrow()
    : null;
  const id = uuidv7();
  await tx
    .insertInto('form')
    .values({ id, tenant_id: c.tenantId, project_id: c.projectId, key: f.key, name: f.name, description: f.description ?? '', subject_type_id: subject?.id ?? null, draft: JSON.stringify(def), current_version: 1 })
    .execute();
  await tx.insertInto('form_version').values({ form_id: id, tenant_id: c.tenantId, version: 1, definition: JSON.stringify(def), published_by: c.actorId }).execute();
  return id;
}

/** Monday 00:00 UTC of the week `weeksAgo` weeks before `now`. */
export function weekStart(now: Date, weeksAgo: number) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - weeksAgo * 7);
  return d;
}
export function monthStart(now: Date, monthsAgo: number) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

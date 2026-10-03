import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DashboardDto,
  DashboardInput,
  DashboardParams,
  DataElementDto,
  DataElementInput,
  DatasetDto,
  EntityDetail,
  EntityInput,
  EntityQuery,
  EntitySummary,
  EntityTypeDto,
  EntityTypeInput,
  EntityUpdate,
  ExploreDto,
  FILE_MAX_BYTES,
  FileDto,
  FormDto,
  FormGroupDto,
  FormGroupInput,
  FormInput,
  FormsMenuDto,
  InboxDto,
  ResubmitInput,
  ReviewInput,
  SUBMISSION_STATUSES,
  GeoQuery,
  ImportRowsInput,
  JobDto,
  JobInput,
  MapOverlayDto,
  MapOverlayInput,
  ObservationBatch,
  OverlayResult,
  PageQuery,
  PlaceNode,
  PermissionGroupDto,
  PermissionGroupInput,
  ProjectDto,
  ProjectInput,
  ProjectMemberDto,
  ProjectMemberInput,
  ProjectUpdate,
  PublicProjectDto,
  QueryResult,
  QuerySpec,
  RunDetail,
  RunDto,
  RunQuery,
  SearchHit,
  SubmissionDto,
  SubmissionInput,
  UploadResult,
  pageOf,
} from '@grids/schema';
import { actorOf, authenticate, type AuthDeps } from '../auth/plugin.js';
import { HttpError } from '../errors.js';
import { streamEvents } from './sse.js';

const T = z.object({ tenantId: z.uuid() });
const P = T.extend({ project: z.string().min(1).max(63) });
const PK = P.extend({ key: z.string().min(1).max(63) });
const PId = P.extend({ id: z.uuid() });
const FeatureCollection = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.any()) });

/** Projects, data model, data, jobs, queries, dashboards and forms (M3–M6). */
export const projectRoutes: FastifyPluginAsyncZod<AuthDeps> = async (app, deps) => {
  const s = deps.services;
  app.addHook('preHandler', authenticate(deps));
  // A successful write through this API drops the tenant's cached query results
  // before the response goes out, so the writer's next read sees its change.
  app.addHook('onSend', async (req, reply, payload) => {
    const tenantId = (req.params as { tenantId?: string } | undefined)?.tenantId;
    const readOnly = (req.routeOptions.config as { readOnly?: boolean }).readOnly;
    if (tenantId && req.method !== 'GET' && !readOnly && reply.statusCode < 400) s.query.invalidate(tenantId);
    return payload;
  });
  // File uploads are sent as raw bytes; the original name and type travel in the query.
  app.addContentTypeParser(['application/octet-stream', 'text/csv', 'text/plain', 'application/x-ndjson'], { parseAs: 'buffer', bodyLimit: FILE_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  // ----- projects -----
  app.get(
    '/tenants/:tenantId/projects',
    { schema: { params: T, querystring: z.object({ archived: z.stringbool().optional() }), response: { 200: z.array(ProjectDto) } } },
    (req) => s.projects.list(actorOf(req), req.params.tenantId, { archived: req.query.archived }),
  );
  app.post('/tenants/:tenantId/projects', { schema: { params: T, body: ProjectInput, response: { 201: ProjectDto } } }, async (req, reply) =>
    reply.status(201).send(await s.projects.create(actorOf(req), req.params.tenantId, req.body)),
  );
  app.get('/tenants/:tenantId/projects/:project', { schema: { params: P, response: { 200: ProjectDto } } }, (req) =>
    s.projects.get(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.patch('/tenants/:tenantId/projects/:project', { schema: { params: P, body: ProjectUpdate, response: { 200: ProjectDto } } }, (req) =>
    s.projects.update(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.post(
    '/tenants/:tenantId/projects/:project/archive',
    { schema: { params: P, body: z.object({ archived: z.boolean() }), response: { 200: ProjectDto } } },
    (req) => s.projects.setArchived(actorOf(req), req.params.tenantId, req.params.project, req.body.archived),
  );

  // Live change events for the project (SSE).
  app.get('/tenants/:tenantId/projects/:project/events', { schema: { params: P } }, async (req, reply) => {
    const a = await s.projects.access(actorOf(req), req.params.tenantId, req.params.project);
    await streamEvents(req, reply, (fn) => s.events.subscribe(req.params.tenantId, a.project.id, fn));
  });

  // ----- members -----
  const Members = { 200: z.array(ProjectMemberDto) };
  app.get('/tenants/:tenantId/projects/:project/members', { schema: { params: P, response: Members } }, (req) =>
    s.projects.members(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.put('/tenants/:tenantId/projects/:project/members', { schema: { params: P, body: ProjectMemberInput, response: Members } }, (req) =>
    s.projects.setMember(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.delete(
    '/tenants/:tenantId/projects/:project/members/:userId',
    { schema: { params: P.extend({ userId: z.uuid() }), response: Members } },
    (req) => s.projects.removeMember(actorOf(req), req.params.tenantId, req.params.project, req.params.userId),
  );

  // ----- permission groups -----
  const Groups = { 200: z.array(PermissionGroupDto) };
  app.get('/tenants/:tenantId/projects/:project/permission-groups', { schema: { params: P, response: Groups } }, (req) =>
    s.projects.permissionGroups(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/permission-groups', { schema: { params: P, body: PermissionGroupInput, response: Groups } }, (req) =>
    s.projects.savePermissionGroup(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/permission-groups/:key', { schema: { params: PK, body: PermissionGroupInput, response: Groups } }, (req) =>
    s.projects.savePermissionGroup(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/permission-groups/:key', { schema: { params: PK, response: Groups } }, (req) =>
    s.projects.deletePermissionGroup(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );

  // ----- entity types -----
  const Types = { 200: z.array(EntityTypeDto) };
  app.get('/tenants/:tenantId/projects/:project/types', { schema: { params: P, response: Types } }, (req) =>
    s.projects.types(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/types', { schema: { params: P, body: EntityTypeInput, response: Types } }, (req) =>
    s.projects.saveType(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/types/:key', { schema: { params: PK, body: EntityTypeInput, response: Types } }, (req) =>
    s.projects.saveType(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/types/:key', { schema: { params: PK, response: Types } }, (req) =>
    s.projects.deleteType(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );

  // ----- data elements -----
  const Elements = { 200: z.array(DataElementDto) };
  app.get('/tenants/:tenantId/projects/:project/elements', { schema: { params: P, response: Elements } }, (req) =>
    s.projects.elements(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/elements', { schema: { params: P, body: DataElementInput, response: Elements } }, (req) =>
    s.projects.saveElement(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/elements/:key', { schema: { params: PK, body: DataElementInput, response: Elements } }, (req) =>
    s.projects.saveElement(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/elements/:key', { schema: { params: PK, response: Elements } }, (req) =>
    s.projects.deleteElement(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );

  // ----- entities -----
  app.get(
    '/tenants/:tenantId/projects/:project/entities',
    { schema: { params: P, querystring: EntityQuery, response: { 200: pageOf(EntitySummary) } } },
    (req) => s.projects.entities(actorOf(req), req.params.tenantId, req.params.project, req.query),
  );
  app.post(
    '/tenants/:tenantId/projects/:project/entities',
    { schema: { params: P, body: EntityInput, response: { 201: EntityDetail } } },
    async (req, reply) => reply.status(201).send(await s.projects.createEntity(actorOf(req), req.params.tenantId, req.params.project, req.body)),
  );
  app.get('/tenants/:tenantId/projects/:project/entities/:id', { schema: { params: PId, response: { 200: EntityDetail } } }, (req) =>
    s.projects.entity(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );
  app.patch(
    '/tenants/:tenantId/projects/:project/entities/:id',
    { schema: { params: PId, body: EntityUpdate, response: { 200: EntityDetail } } },
    (req) => s.projects.updateEntity(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.body),
  );
  app.delete('/tenants/:tenantId/projects/:project/entities/:id', { schema: { params: PId } }, async (req, reply) => {
    await s.projects.deleteEntity(actorOf(req), req.params.tenantId, req.params.project, req.params.id);
    return reply.status(204).send();
  });
  app.get(
    '/tenants/:tenantId/projects/:project/entities/:id/series',
    {
      schema: {
        params: PId,
        querystring: z.object({ element: z.string().min(1).max(63) }),
        response: { 200: z.array(z.object({ at: z.string(), value: z.union([z.number(), z.string(), z.null()]), source: z.string() })) },
      },
    },
    (req) => s.projects.series(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.query.element),
  );
  app.get('/tenants/:tenantId/projects/:project/geo', { schema: { params: P, querystring: GeoQuery, response: { 200: FeatureCollection } } }, (req) =>
    s.projects.geo(actorOf(req), req.params.tenantId, req.params.project, req.query),
  );
  app.post(
    '/tenants/:tenantId/projects/:project/import',
    {
      bodyLimit: 20 * 1024 * 1024,
      schema: { params: P, body: ImportRowsInput, response: { 200: z.object({ created: z.number(), updated: z.number(), unchanged: z.number(), skipped: z.number() }) } },
    },
    (req) => s.projects.importRows(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.post(
    '/tenants/:tenantId/projects/:project/observations',
    { bodyLimit: 10 * 1024 * 1024, schema: { params: P, body: ObservationBatch, response: { 200: z.object({ written: z.number(), skipped: z.number() }) } } },
    (req) => s.projects.writeObservations(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );

  // ----- jobs, runs, datasets -----
  const Jobs = { 200: z.array(JobDto) };
  app.get('/tenants/:tenantId/projects/:project/jobs', { schema: { params: P, response: Jobs } }, (req) =>
    s.jobs.list(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/jobs', { schema: { params: P, body: JobInput, response: Jobs } }, (req) =>
    s.jobs.save(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/jobs/:key', { schema: { params: PK, body: JobInput, response: Jobs } }, (req) =>
    s.jobs.save(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/jobs/:key', { schema: { params: PK, response: Jobs } }, (req) =>
    s.jobs.remove(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.post('/tenants/:tenantId/projects/:project/jobs/:key/run', { schema: { params: PK, response: { 202: RunDto } } }, async (req, reply) =>
    reply.status(202).send(await s.jobs.trigger(actorOf(req), req.params.tenantId, req.params.project, req.params.key)),
  );
  app.get(
    '/tenants/:tenantId/projects/:project/runs',
    { schema: { params: P, querystring: RunQuery, response: { 200: pageOf(RunDto) } } },
    (req) => s.jobs.runs(actorOf(req), req.params.tenantId, req.params.project, req.query),
  );
  app.get('/tenants/:tenantId/projects/:project/runs/:id', { schema: { params: PId, response: { 200: RunDetail } } }, (req) =>
    s.jobs.run(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );
  app.post('/tenants/:tenantId/projects/:project/runs/:id/cancel', { schema: { params: PId, response: { 200: RunDetail } } }, (req) =>
    s.jobs.cancel(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );
  app.post('/tenants/:tenantId/projects/:project/runs/:id/rerun', { schema: { params: PId, response: { 202: RunDto } } }, async (req, reply) =>
    reply.status(202).send(await s.jobs.rerun(actorOf(req), req.params.tenantId, req.params.project, req.params.id)),
  );
  const Files = { 200: z.array(FileDto) };
  app.get('/tenants/:tenantId/projects/:project/files', { schema: { params: P, response: Files } }, (req) =>
    s.jobs.files(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.put(
    '/tenants/:tenantId/projects/:project/files/:key',
    {
      bodyLimit: FILE_MAX_BYTES,
      schema: {
        params: PK,
        querystring: z.object({ name: z.string().max(255).default(''), type: z.string().max(100).default('application/octet-stream') }),
        response: { 201: UploadResult },
      },
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'Unsupported media type', 'Send the file body as application/octet-stream.');
      const res = await s.jobs.upload(actorOf(req), req.params.tenantId, req.params.project, req.params.key, {
        name: req.query.name || req.params.key,
        contentType: req.query.type,
        content: req.body,
      });
      return reply.status(201).send(res);
    },
  );
  app.delete('/tenants/:tenantId/projects/:project/files/:key', { schema: { params: PK, response: Files } }, (req) =>
    s.jobs.deleteFile(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.get('/tenants/:tenantId/projects/:project/datasets', { schema: { params: P, response: { 200: z.array(DatasetDto) } } }, (req) =>
    s.jobs.datasets(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.get(
    '/tenants/:tenantId/projects/:project/datasets/:key/rows',
    {
      schema: {
        params: PK,
        querystring: PageQuery,
        response: { 200: z.object({ columns: z.array(z.string()), items: z.array(z.record(z.string(), z.unknown())), total: z.number(), page: z.number(), pageSize: z.number() }) },
      },
    },
    (req) => s.jobs.datasetRows(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query),
  );

  // ----- query & dashboards -----
  app.post('/tenants/:tenantId/projects/:project/query', { config: { readOnly: true }, schema: { params: P, body: QuerySpec, response: { 200: QueryResult } } }, (req) =>
    s.query.query(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  const Dashboards = { 200: z.array(DashboardDto) };
  app.get('/tenants/:tenantId/projects/:project/dashboards', { schema: { params: P, response: Dashboards } }, (req) =>
    s.query.dashboards(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/dashboards', { schema: { params: P, body: DashboardInput, response: Dashboards } }, (req) =>
    s.query.saveDashboard(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.get(
    '/tenants/:tenantId/projects/:project/dashboards/:key/widgets/:widget',
    { schema: { params: PK.extend({ widget: z.string().max(40) }), querystring: DashboardParams, response: { 200: QueryResult } } },
    (req) => s.query.widget(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.params.widget, req.query),
  );
  app.put('/tenants/:tenantId/projects/:project/dashboards/:key', { schema: { params: PK, body: DashboardInput, response: Dashboards } }, (req) =>
    s.query.saveDashboard(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/dashboards/:key', { schema: { params: PK, response: Dashboards } }, (req) =>
    s.query.deleteDashboard(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );

  // ----- explorer & map overlays -----
  const Overlays = { 200: z.array(MapOverlayDto) };
  const At = z.object({ entity: z.uuid().optional() });
  app.get('/tenants/:tenantId/projects/:project/explore', { schema: { params: P, querystring: At, response: { 200: ExploreDto } } }, (req) =>
    s.explore.explore(actorOf(req), req.params.tenantId, req.params.project, req.query.entity ?? null),
  );
  const Parent = z.object({ parent: z.uuid().optional() });
  app.get('/tenants/:tenantId/projects/:project/places', { schema: { params: P, querystring: Parent, response: { 200: z.array(PlaceNode) } } }, (req) =>
    s.explore.children(actorOf(req), req.params.tenantId, req.params.project, req.query.parent ?? null),
  );
  app.get(
    '/tenants/:tenantId/projects/:project/search',
    { schema: { params: P, querystring: z.object({ q: z.string().max(100) }), response: { 200: z.array(SearchHit) } } },
    (req) => s.explore.search(actorOf(req), req.params.tenantId, req.params.project, req.query.q),
  );
  app.get('/tenants/:tenantId/projects/:project/overlays', { schema: { params: P, response: Overlays } }, (req) =>
    s.explore.overlays(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/overlays', { schema: { params: P, body: MapOverlayInput, response: Overlays } }, (req) =>
    s.explore.saveOverlay(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/overlays/:key', { schema: { params: PK, body: MapOverlayInput, response: Overlays } }, (req) =>
    s.explore.saveOverlay(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/overlays/:key', { schema: { params: PK, response: Overlays } }, (req) =>
    s.explore.deleteOverlay(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.get(
    '/tenants/:tenantId/projects/:project/overlays/:key/values',
    { schema: { params: PK, querystring: At, response: { 200: OverlayResult } } },
    (req) => s.explore.overlay(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query.entity ?? null),
  );

  // ----- forms & submissions -----
  const Forms = { 200: z.array(FormDto) };
  app.get('/tenants/:tenantId/projects/:project/forms', { schema: { params: P, response: Forms } }, (req) =>
    s.forms.list(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/forms', { schema: { params: P, body: FormInput, response: Forms } }, (req) =>
    s.forms.save(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/forms/:key', { schema: { params: PK, body: FormInput, response: Forms } }, (req) =>
    s.forms.save(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.post('/tenants/:tenantId/projects/:project/forms/:key/publish', { schema: { params: PK, response: Forms } }, (req) =>
    s.forms.publish(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/forms/:key', { schema: { params: PK, response: Forms } }, (req) =>
    s.forms.archive(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.post(
    '/tenants/:tenantId/projects/:project/forms/:key/submissions',
    { schema: { params: PK, body: SubmissionInput, response: { 201: SubmissionDto } } },
    async (req, reply) => reply.status(201).send(await s.forms.submit(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.body)),
  );
  app.get(
    '/tenants/:tenantId/projects/:project/forms/:key/submissions',
    { schema: { params: PK, querystring: PageQuery.extend({ entityId: z.uuid().optional(), status: z.enum(SUBMISSION_STATUSES).optional() }), response: { 200: pageOf(SubmissionDto) } } },
    (req) => s.forms.submissions(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query),
  );
  app.get('/tenants/:tenantId/projects/:project/submissions/:id', { schema: { params: PId, response: { 200: SubmissionDto } } }, (req) =>
    s.forms.submission(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );
  app.post('/tenants/:tenantId/projects/:project/submissions/:id/review', { schema: { params: PId, body: ReviewInput, response: { 200: SubmissionDto } } }, (req) =>
    s.forms.review(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/submissions/:id', { schema: { params: PId, body: ResubmitInput, response: { 200: SubmissionDto } } }, (req) =>
    s.forms.resubmit(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.body),
  );

  // ----- the organisation's Forms menu and review inbox -----
  const FormGroups = { 200: z.array(FormGroupDto) };
  app.get('/tenants/:tenantId/forms/menu', { schema: { params: T, response: { 200: FormsMenuDto } } }, (req) => s.forms.menu(actorOf(req), req.params.tenantId));
  app.get('/tenants/:tenantId/forms/inbox', { schema: { params: T, response: { 200: InboxDto } } }, (req) => s.forms.inbox(actorOf(req), req.params.tenantId));
  app.get('/tenants/:tenantId/form-groups', { schema: { params: T, response: FormGroups } }, (req) => s.forms.groups(actorOf(req), req.params.tenantId));
  app.post('/tenants/:tenantId/form-groups', { schema: { params: T, body: FormGroupInput, response: FormGroups } }, (req) =>
    s.forms.saveGroup(actorOf(req), req.params.tenantId, req.body),
  );
  app.put('/tenants/:tenantId/form-groups/:id', { schema: { params: T.extend({ id: z.uuid() }), body: FormGroupInput, response: FormGroups } }, (req) =>
    s.forms.saveGroup(actorOf(req), req.params.tenantId, req.body, req.params.id),
  );
  app.delete('/tenants/:tenantId/form-groups/:id', { schema: { params: T.extend({ id: z.uuid() }), response: FormGroups } }, (req) =>
    s.forms.deleteGroup(actorOf(req), req.params.tenantId, req.params.id),
  );
};

/** Anonymous, read-only access to public projects (spec §13). */
export const publicProjectRoutes: FastifyPluginAsyncZod<AuthDeps> = async (app, deps) => {
  const s = deps.services;
  const Params = z.object({ tenant: z.string().min(1).max(63), project: z.string().min(1).max(63) });
  app.get('/public/projects/:tenant/:project', { schema: { params: Params, response: { 200: PublicProjectDto } } }, async (req, reply) => {
    reply.header('cache-control', 'public, max-age=30');
    return s.query.publicView(req.params.tenant, req.params.project);
  });
  const At = z.object({ entity: z.uuid().optional() });
  const cache = (reply: { header(k: string, v: string): unknown }) => reply.header('cache-control', 'public, max-age=30');
  app.get('/public/projects/:tenant/:project/explore', { schema: { params: Params, querystring: At, response: { 200: ExploreDto } } }, async (req, reply) => {
    cache(reply);
    return s.explore.publicExplore(req.params.tenant, req.params.project, req.query.entity ?? null);
  });
  app.get('/public/projects/:tenant/:project/overlays', { schema: { params: Params, response: { 200: z.array(MapOverlayDto) } } }, async (req, reply) => {
    cache(reply);
    return s.explore.publicOverlays(req.params.tenant, req.params.project);
  });
  app.get(
    '/public/projects/:tenant/:project/overlays/:key/values',
    { schema: { params: Params.extend({ key: z.string().max(63) }), querystring: At, response: { 200: OverlayResult } } },
    async (req, reply) => {
      cache(reply);
      return s.explore.publicOverlay(req.params.tenant, req.params.project, req.params.key, req.query.entity ?? null);
    },
  );
  app.get(
    '/public/projects/:tenant/:project/places',
    { schema: { params: Params, querystring: z.object({ parent: z.uuid().optional() }), response: { 200: z.array(PlaceNode) } } },
    async (req, reply) => {
      cache(reply);
      return s.explore.publicChildren(req.params.tenant, req.params.project, req.query.parent ?? null);
    },
  );
  app.get(
    '/public/projects/:tenant/:project/search',
    { schema: { params: Params, querystring: z.object({ q: z.string().max(100) }), response: { 200: z.array(SearchHit) } } },
    async (req, reply) => {
      cache(reply);
      return s.explore.publicSearch(req.params.tenant, req.params.project, req.query.q);
    },
  );
  // Inbound webhooks: the token (tenant + secret) is the credential.
  app.post(
    '/hooks/:token',
    { bodyLimit: 5 * 1024 * 1024, schema: { params: z.object({ token: z.string().min(40).max(120) }), response: { 202: z.object({ runId: z.string() }) } } },
    async (req, reply) => reply.status(202).send(await s.jobs.webhook(req.params.token, req.body)),
  );
  app.get('/public/projects/:tenant/:project/events', { schema: { params: Params } }, async (req, reply) => {
    const t = await s.query.publicTarget(req.params.tenant, req.params.project);
    await streamEvents(req, reply, (fn) => s.events.subscribe(t.tenantId, t.projectId, fn), 2_000);
  });
  app.get(
    '/public/projects/:tenant/:project/dashboards/:dashboard/widgets/:widget',
    { schema: { params: Params.extend({ dashboard: z.string().max(63), widget: z.string().max(40) }), querystring: DashboardParams, response: { 200: QueryResult } } },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=30');
      return s.query.publicWidget(req.params.tenant, req.params.project, req.params.dashboard, req.params.widget, req.query);
    },
  );
  app.get(
    '/public/projects/:tenant/:project/dashboards/:dashboard/areas',
    { schema: { params: Params.extend({ dashboard: z.string().max(63) }), response: { 200: z.array(z.object({ id: z.string(), name: z.string() })) } } },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=60');
      return s.query.publicAreas(req.params.tenant, req.params.project, req.params.dashboard);
    },
  );
};

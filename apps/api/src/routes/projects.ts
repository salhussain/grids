import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PublicProjectCard,
  DatasetInput,
  DatasetRowsInput,
  SqlRunInput,
  SqlResult,
  CatalogDto,
  LocalSourcesDto,
  OverlayGroupDto,
  OverlayGroupInput,
  DashboardDto,
  DashboardInput,
  DashboardParams,
  DataElementDto,
  DataElementInput,
  DataGroupInput,
  DataGroupDto,
  DatasetDto,
  DatasetVersionDto,
  EntityDetail,
  EntityInput,
  EntityQuery,
  EntitySyncDto,
  EntitySyncQuery,
  EntitySummary,
  EntityTypeDto,
  EntityTypeInput,
  EntityUpdate,
  ExploreDto,
  FILE_MAX_BYTES,
  FileDto,
  FormDto,
  FormVersionDto,
  AttachmentDto,
  ATTACHMENT_MAX_BYTES,
  FormGroupDto,
  FormGroupInput,
  DocumentFormat,
  DocumentSampleInput,
  DocumentDraftInput,
  DocumentRevisionDto,
  FormInput,
  FormLinkUpdate,
  FormLinkDto,
  FormLinkInput,
  WorkComment,
  WorkDetailDto,
  WorkItemInput,
  WorkItemUpdate,
  WorkMineDto,
  WorkPageDto,
  WorkQuery,
  WorkTypeDto,
  ActivitySummaryDto,
  ActivitySummaryQuery,
  AuditPage,
  AuditQuery,
  WorkScheduleDto,
  WorkScheduleInput,
  WorkTypeInput,
  FormsMenuDto,
  InboxDto,
  ResubmitInput,
  ReviewInput,
  SUBMISSION_STATUSES,
  GeoQuery,
  ImportRowsInput,
  ConnectionDto,
  ConnectionInput,
  TestResult,
  VariableDto,
  VariableInput,
  JobDto,
  JobInput,
  MapOverlayDto,
  MapOverlayInput,
  ObservationBatch,
  OverlayPeriod,
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
    { schema: { params: T, querystring: z.object({ archived: z.union([z.literal('all'), z.stringbool()]).optional() }), response: { 200: z.array(ProjectDto) } } },
    (req) => s.projects.list(actorOf(req), req.params.tenantId, { archived: req.query.archived }),
  );
  // The public catalogue is cached; a change to a project (visibility, status, archive) must show at once.
  const fresh = async <T>(change: Promise<T>) => {
    const out = await change;
    s.query.invalidateCatalogue();
    return out;
  };
  app.post('/tenants/:tenantId/projects', { schema: { params: T, body: ProjectInput, response: { 201: ProjectDto } } }, async (req, reply) =>
    reply.status(201).send(await fresh(s.projects.create(actorOf(req), req.params.tenantId, req.body))),
  );
  app.get('/tenants/:tenantId/projects/:project', { schema: { params: P, response: { 200: ProjectDto } } }, (req) =>
    s.projects.get(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.patch('/tenants/:tenantId/projects/:project', { schema: { params: P, body: ProjectUpdate, response: { 200: ProjectDto } } }, (req) =>
    fresh(s.projects.update(actorOf(req), req.params.tenantId, req.params.project, req.body)),
  );
  app.post(
    '/tenants/:tenantId/projects/:project/archive',
    { schema: { params: P, body: z.object({ archived: z.boolean() }), response: { 200: ProjectDto } } },
    (req) => fresh(s.projects.setArchived(actorOf(req), req.params.tenantId, req.params.project, req.body.archived)),
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
  app.put('/tenants/:tenantId/projects/:project/permission-groups/:id', { schema: { params: PId, body: PermissionGroupInput, response: Groups } }, (req) =>
    s.projects.savePermissionGroup(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.id),
  );
  app.delete('/tenants/:tenantId/projects/:project/permission-groups/:id', { schema: { params: PId, response: Groups } }, (req) =>
    s.projects.deletePermissionGroup(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );

  // ----- shared entities (owned by the organisation, visible in every project) -----
  const EntityId = T.extend({ id: z.uuid() });
  const SharedPage = z.object({ items: z.array(EntitySummary), total: z.number(), page: z.number(), pageSize: z.number() });
  app.get('/tenants/:tenantId/shared-entities', { schema: { params: T, querystring: EntityQuery, response: { 200: SharedPage } } }, (req) => s.sharedEntities.list(actorOf(req), req.params.tenantId, req.query));
  app.get('/tenants/:tenantId/shared-entities/:id', { schema: { params: EntityId, response: { 200: EntityDetail } } }, (req) => s.sharedEntities.detail(actorOf(req), req.params.tenantId, req.params.id));
  app.post('/tenants/:tenantId/shared-entities', { schema: { params: T, body: EntityInput, response: { 201: EntitySummary } } }, async (req, reply) => reply.code(201).send(await s.sharedEntities.create(actorOf(req), req.params.tenantId, req.body)));
  app.patch('/tenants/:tenantId/shared-entities/:id', { schema: { params: EntityId, body: EntityUpdate, response: { 200: EntitySummary } } }, (req) => s.sharedEntities.update(actorOf(req), req.params.tenantId, req.params.id, req.body));
  app.delete('/tenants/:tenantId/shared-entities/:id', { schema: { params: EntityId } }, async (req, reply) => {
    await s.sharedEntities.remove(actorOf(req), req.params.tenantId, req.params.id);
    return reply.code(204).send();
  });
  app.post(
    '/tenants/:tenantId/shared-entities/import',
    { bodyLimit: 20 * 1024 * 1024, schema: { params: T, body: ImportRowsInput, response: { 200: z.object({ created: z.number(), updated: z.number(), unchanged: z.number(), skipped: z.number() }) } } },
    (req) => s.sharedEntities.importRows(actorOf(req), req.params.tenantId, req.body),
  );

  // ----- entity types -----
  const Types = { 200: z.array(EntityTypeDto) };

  // ----- organisation-wide entity types -----
  const TK = T.extend({ key: z.string().min(1).max(63) });
  app.get('/tenants/:tenantId/entity-types', { schema: { params: T, response: Types } }, (req) => s.orgTypes.list(actorOf(req), req.params.tenantId));
  app.post('/tenants/:tenantId/entity-types', { schema: { params: T, body: EntityTypeInput, response: Types } }, (req) => s.orgTypes.save(actorOf(req), req.params.tenantId, req.body));
  app.put('/tenants/:tenantId/entity-types/:key', { schema: { params: TK, body: EntityTypeInput, response: Types } }, (req) => s.orgTypes.save(actorOf(req), req.params.tenantId, req.body, req.params.key));
  app.delete('/tenants/:tenantId/entity-types/:key', { schema: { params: TK, response: Types } }, (req) => s.orgTypes.remove(actorOf(req), req.params.tenantId, req.params.key));
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
  // An indicator outside the default group is addressed as group.key.
  const PRef = P.extend({ key: z.string().min(1).max(127) });
  app.put('/tenants/:tenantId/projects/:project/elements/:key', { schema: { params: PRef, body: DataElementInput, response: Elements } }, (req) =>
    s.projects.saveElement(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/elements/:key', { schema: { params: PRef, response: Elements } }, (req) =>
    s.projects.deleteElement(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );

  // ----- data groups: namespaces for indicators -----
  const DataGroups = { 200: z.array(DataGroupDto) };
  app.get('/tenants/:tenantId/projects/:project/data-groups', { schema: { params: P, response: DataGroups } }, (req) => s.projects.dataGroups(actorOf(req), req.params.tenantId, req.params.project));
  app.post('/tenants/:tenantId/projects/:project/data-groups', { schema: { params: P, body: DataGroupInput, response: DataGroups } }, (req) =>
    s.projects.saveDataGroup(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/data-groups/:key', { schema: { params: PK, body: DataGroupInput, response: DataGroups } }, (req) =>
    s.projects.saveDataGroup(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/data-groups/:key', { schema: { params: PK, querystring: z.object({ cascade: z.stringbool().default(false) }), response: DataGroups } }, (req) =>
    s.projects.deleteDataGroup(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query.cascade),
  );

  // ----- entities -----
  app.get(
    '/tenants/:tenantId/projects/:project/entities',
    { schema: { params: P, querystring: EntityQuery, response: { 200: pageOf(EntitySummary) } } },
    (req) => s.projects.entities(actorOf(req), req.params.tenantId, req.params.project, req.query),
  );
  app.get(
    '/tenants/:tenantId/projects/:project/entities/sync',
    { schema: { params: P, querystring: EntitySyncQuery, response: { 200: EntitySyncDto } } },
    (req) => s.projects.entitySync(actorOf(req), req.params.tenantId, req.params.project, req.query),
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
        querystring: z.object({ element: z.string().min(1).max(63), rollup: z.enum(['1', '0']).optional() }),
        response: { 200: z.array(z.object({ at: z.string(), value: z.union([z.number(), z.string(), z.null()]), source: z.string() })) },
      },
    },
    (req) => s.projects.series(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.query.element, 200, req.query.rollup === '1'),
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
  app.post('/tenants/:tenantId/projects/:project/datasets', { schema: { params: P, body: DatasetInput, response: { 200: z.array(DatasetDto) } } }, (req) =>
    s.jobs.saveDataset(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/datasets/:key', { schema: { params: PK, body: DatasetInput, response: { 200: z.array(DatasetDto) } } }, (req) =>
    s.jobs.saveDataset(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.get('/tenants/:tenantId/projects/:project/datasets/:key/versions', { schema: { params: PK, response: { 200: z.array(DatasetVersionDto) } } }, (req) =>
    s.jobs.datasetVersions(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/datasets/:key', { schema: { params: PK, response: { 200: z.array(DatasetDto) } } }, (req) =>
    s.jobs.deleteDataset(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  // ----- connections and variables -----
  const VarKey = P.extend({ key: z.string().min(1).max(64) });
  app.get('/tenants/:tenantId/projects/:project/variables', { schema: { params: P, response: { 200: z.array(VariableDto) } } }, (req) =>
    s.connections.variables(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/variables', { schema: { params: P, body: VariableInput, response: { 200: z.array(VariableDto) } } }, (req) =>
    s.connections.setVariable(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/variables/:key', { schema: { params: VarKey, body: VariableInput, response: { 200: z.array(VariableDto) } } }, (req) =>
    s.connections.setVariable(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/variables/:key', { schema: { params: VarKey, response: { 200: z.array(VariableDto) } } }, (req) =>
    s.connections.removeVariable(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  const Conns = { 200: z.array(ConnectionDto) };
  app.get('/tenants/:tenantId/projects/:project/connections', { schema: { params: P, response: Conns } }, (req) =>
    s.connections.connections(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/connections', { schema: { params: P, body: ConnectionInput, response: Conns } }, (req) =>
    s.connections.saveConnection(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/connections/:key', { schema: { params: PK, body: ConnectionInput, response: Conns } }, (req) =>
    s.connections.saveConnection(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/connections/:key', { schema: { params: PK, response: Conns } }, (req) =>
    s.connections.removeConnection(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.post('/tenants/:tenantId/projects/:project/connection-test', { schema: { params: P, body: ConnectionInput, response: { 200: TestResult } } }, (req) =>
    s.connections.testDraft(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.post('/tenants/:tenantId/projects/:project/connections/:key/test', { schema: { params: PK, response: { 200: TestResult } } }, (req) =>
    s.connections.testSaved(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.put(
    '/tenants/:tenantId/projects/:project/datasets/:key/rows',
    { bodyLimit: 30 * 1024 * 1024, schema: { params: PK, body: DatasetRowsInput, response: { 200: z.object({ rows: z.number(), added: z.number() }) } } },
    (req) => s.jobs.uploadDatasetRows(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.body),
  );
  // SQL editor and query-based datasets.
  app.post('/tenants/:tenantId/projects/:project/sql/run', { schema: { params: P, body: SqlRunInput, response: { 200: SqlResult } } }, (req) =>
    s.datasets.run(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.get('/tenants/:tenantId/projects/:project/sql/sources', { schema: { params: P, response: { 200: LocalSourcesDto } } }, (req) =>
    s.datasets.localSources(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.get('/tenants/:tenantId/projects/:project/connections/:key/catalog', { schema: { params: PK, response: { 200: CatalogDto } } }, (req) =>
    s.datasets.catalog(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.post('/tenants/:tenantId/projects/:project/datasets/:key/refresh', { schema: { params: PK, response: { 200: z.array(DatasetDto) } } }, (req) =>
    s.datasets.refresh(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
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
    (req) => s.datasets.rowsPage(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query),
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
  app.get(
    '/tenants/:tenantId/projects/:project/dashboards/:key/filters/:filter/values',
    { schema: { params: PK.extend({ filter: z.string().max(40) }), querystring: z.object({ cf: DashboardParams.shape.cf }), response: { 200: z.array(z.string()) } } },
    (req) => s.query.filterValues(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.params.filter, req.query.cf),
  );
  app.put('/tenants/:tenantId/projects/:project/dashboards/:key', { schema: { params: PK, body: DashboardInput, response: Dashboards } }, (req) =>
    s.query.saveDashboard(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key),
  );
  app.delete('/tenants/:tenantId/projects/:project/dashboards/:key', { schema: { params: PK, response: Dashboards } }, (req) =>
    s.query.deleteDashboard(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );

  // ----- map overlay groups (levels) -----
  const OGroups = { 200: z.array(OverlayGroupDto) };
  app.get('/tenants/:tenantId/projects/:project/overlay-groups', { schema: { params: P, response: OGroups } }, (req) =>
    s.explore.overlayGroups(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/overlay-groups', { schema: { params: P, body: OverlayGroupInput, response: OGroups } }, (req) =>
    s.explore.saveOverlayGroup(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/overlay-groups/:id', { schema: { params: PId, body: OverlayGroupInput, response: OGroups } }, (req) =>
    s.explore.saveOverlayGroup(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.id),
  );
  app.delete('/tenants/:tenantId/projects/:project/overlay-groups/:id', { schema: { params: PId, response: OGroups } }, (req) =>
    s.explore.deleteOverlayGroup(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );

  // ----- explorer & map overlays -----
  const Overlays = { 200: z.array(MapOverlayDto) };
  const At = z.object({ entity: z.uuid().optional() });
  const AtPeriod = At.extend(OverlayPeriod.shape);
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
    { schema: { params: PK, querystring: AtPeriod, response: { 200: OverlayResult } } },
    (req) => s.explore.overlay(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query.entity ?? null, { hours: req.query.hours, from: req.query.from, to: req.query.to }),
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
  // ----- work: tickets, tasks, visits, maintenance -----
  const WorkId = P.extend({ id: z.uuid() });
  const WorkTypeKey = P.extend({ key: z.string().min(1).max(63) });
  app.get('/tenants/:tenantId/projects/:project/work/types', { schema: { params: P, response: { 200: z.array(WorkTypeDto) } } }, (req) => s.work.types(actorOf(req), req.params.tenantId, req.params.project));
  app.post('/tenants/:tenantId/projects/:project/work/types', { schema: { params: P, body: WorkTypeInput, response: { 200: z.array(WorkTypeDto) } } }, (req) => s.work.saveType(actorOf(req), req.params.tenantId, req.params.project, req.body));
  app.put('/tenants/:tenantId/projects/:project/work/types/:key', { schema: { params: WorkTypeKey, body: WorkTypeInput, response: { 200: z.array(WorkTypeDto) } } }, (req) => s.work.saveType(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key));
  app.delete('/tenants/:tenantId/projects/:project/work/types/:key', { schema: { params: WorkTypeKey, response: { 200: z.array(WorkTypeDto) } } }, (req) => s.work.deleteType(actorOf(req), req.params.tenantId, req.params.project, req.params.key));
  const ScheduleKey = P.extend({ key: z.string().min(1).max(63) });
  app.get('/tenants/:tenantId/projects/:project/activity/summary', { schema: { params: P, querystring: ActivitySummaryQuery, response: { 200: ActivitySummaryDto } } }, (req) => s.activity.projectSummary(actorOf(req), req.params.tenantId, req.params.project, req.query));
  app.get('/tenants/:tenantId/projects/:project/activity', { schema: { params: P, querystring: AuditQuery.omit({ tenantId: true, project: true }), response: { 200: AuditPage } } }, (req) => s.activity.project(actorOf(req), req.params.tenantId, req.params.project, req.query));
  app.get('/tenants/:tenantId/projects/:project/work/schedules', { schema: { params: P, response: { 200: z.array(WorkScheduleDto) } } }, (req) => s.workSchedules.list(actorOf(req), req.params.tenantId, req.params.project));
  app.post('/tenants/:tenantId/projects/:project/work/schedules', { schema: { params: P, body: WorkScheduleInput, response: { 200: z.array(WorkScheduleDto) } } }, (req) => s.workSchedules.save(actorOf(req), req.params.tenantId, req.params.project, req.body));
  app.put('/tenants/:tenantId/projects/:project/work/schedules/:key', { schema: { params: ScheduleKey, body: WorkScheduleInput, response: { 200: z.array(WorkScheduleDto) } } }, (req) => s.workSchedules.save(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.key));
  app.delete('/tenants/:tenantId/projects/:project/work/schedules/:key', { schema: { params: ScheduleKey, response: { 200: z.array(WorkScheduleDto) } } }, (req) => s.workSchedules.remove(actorOf(req), req.params.tenantId, req.params.project, req.params.key));
  app.get('/tenants/:tenantId/projects/:project/work', { schema: { params: P, querystring: WorkQuery, response: { 200: WorkPageDto } } }, (req) => s.work.list(actorOf(req), req.params.tenantId, req.params.project, req.query));
  app.post('/tenants/:tenantId/projects/:project/work', { schema: { params: P, body: WorkItemInput, response: { 201: WorkDetailDto } } }, async (req, reply) => reply.status(201).send(await s.work.create(actorOf(req), req.params.tenantId, req.params.project, req.body)));
  app.get('/tenants/:tenantId/projects/:project/work/:id', { schema: { params: WorkId, response: { 200: WorkDetailDto } } }, (req) => s.work.get(actorOf(req), req.params.tenantId, req.params.project, req.params.id));
  app.patch('/tenants/:tenantId/projects/:project/work/:id', { schema: { params: WorkId, body: WorkItemUpdate, response: { 200: WorkDetailDto } } }, (req) => s.work.update(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.body));
  app.post('/tenants/:tenantId/projects/:project/work/:id/comments', { schema: { params: WorkId, body: WorkComment, response: { 200: WorkDetailDto } } }, (req) => s.work.comment(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.body));
  app.get('/tenants/:tenantId/work/mine', { schema: { params: T, response: { 200: WorkMineDto } } }, (req) => s.work.mine(actorOf(req), req.params.tenantId));

  // Links for people without an account.
  app.get('/tenants/:tenantId/projects/:project/forms/:key/links', { schema: { params: PK, response: { 200: z.array(FormLinkDto) } } }, (req) =>
    s.formLinks.list(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  app.post('/tenants/:tenantId/projects/:project/forms/:key/links', { schema: { params: PK, body: FormLinkInput, response: { 200: z.array(FormLinkDto) } } }, (req) =>
    s.formLinks.create(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.body),
  );
  app.patch('/tenants/:tenantId/projects/:project/forms/:key/links/:id', { schema: { params: PK.extend({ id: z.uuid() }), body: FormLinkUpdate, response: { 200: z.array(FormLinkDto) } } }, (req) =>
    s.formLinks.update(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.params.id, req.body),
  );
  app.delete('/tenants/:tenantId/projects/:project/forms/:key/links/:id', { schema: { params: PK.extend({ id: z.uuid() }), response: { 200: z.array(FormLinkDto) } } }, (req) =>
    s.formLinks.revoke(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.params.id),
  );
  app.post('/tenants/:tenantId/projects/:project/forms/:key/publish', { schema: { params: PK, response: Forms } }, (req) =>
    s.forms.publish(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
  );
  // Pictures attached while filling a form: sent as the raw body, read back by id.
  app.put(
    '/tenants/:tenantId/projects/:project/forms/:key/attachments',
    {
      bodyLimit: ATTACHMENT_MAX_BYTES,
      schema: {
        params: PK,
        querystring: z.object({ name: z.string().max(255).default('picture'), type: z.string().max(100).default('application/octet-stream') }),
        response: { 201: AttachmentDto },
      },
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'Unsupported media type', 'Send the picture as the request body (application/octet-stream).');
      return reply.status(201).send(await s.forms.uploadAttachment(actorOf(req), req.params.tenantId, req.params.project, req.params.key, { name: req.query.name, contentType: req.query.type, content: req.body }));
    },
  );
  app.get('/tenants/:tenantId/projects/:project/attachments/:id', { schema: { params: PId } }, async (req, reply) => {
    const f = await s.forms.attachment(actorOf(req), req.params.tenantId, req.params.project, req.params.id);
    // Pictures show in the page; documents are downloaded rather than opened in the app's own origin.
    const inline = f.contentType.startsWith('image/');
    return reply
      .header('content-type', f.contentType)
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .send(f.content);
  });
  app.get('/tenants/:tenantId/projects/:project/forms/:key/versions', { schema: { params: PK, response: { 200: z.array(FormVersionDto) } } }, (req) =>
    s.forms.versions(actorOf(req), req.params.tenantId, req.params.project, req.params.key),
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
    { schema: { params: PK, querystring: PageQuery.extend({ entityId: z.uuid().optional(), status: z.enum(SUBMISSION_STATUSES).optional(), mine: z.stringbool().optional() }), response: { 200: pageOf(SubmissionDto) } } },
    (req) => s.forms.submissions(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query),
  );
  app.get('/tenants/:tenantId/projects/:project/submissions/:id', { schema: { params: PId, response: { 200: SubmissionDto } } }, (req) =>
    s.forms.submission(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );
  // A document made from a submission (the form's templates), as a PDF or a Word file.
  const sendFile = (reply: FastifyReply, f: { filename: string; contentType: string; content: Buffer }) =>
    reply.header('content-type', f.contentType).header('content-disposition', `attachment; filename="${f.filename}"`).header('cache-control', 'private, no-store').send(f.content);
  app.get(
    '/tenants/:tenantId/projects/:project/forms/:key/submissions/:id/documents/:docId',
    { schema: { params: PK.extend({ id: z.uuid(), docId: z.string().min(1).max(63) }), querystring: z.object({ format: DocumentFormat.default('pdf') }) } },
    async (req, reply) =>
      sendFile(reply.header('x-content-type-options', 'nosniff'), await s.documents.forSubmission(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.params.id, req.params.docId, req.query.format)),
  );
  app.put(
    '/tenants/:tenantId/projects/:project/forms/:key/documents/draft',
    { schema: { params: PK, body: DocumentDraftInput } },
    async (req, reply) => (await s.documents.saveDraft(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.body), reply.code(204).send()),
  );
  app.post('/tenants/:tenantId/projects/:project/forms/:key/documents/publish', { schema: { params: PK, querystring: z.object({ document: z.string().min(1).max(63).optional() }) } }, async (req, reply) => (await s.documents.publish(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query.document), reply.code(204).send()));
  app.post('/tenants/:tenantId/projects/:project/forms/:key/documents/discard', { schema: { params: PK, querystring: z.object({ document: z.string().min(1).max(63).optional() }) } }, async (req, reply) => (await s.documents.discard(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.query.document), reply.code(204).send()));
  app.get(
    '/tenants/:tenantId/projects/:project/forms/:key/documents/:docId/revisions',
    { schema: { params: PK.extend({ docId: z.string().min(1).max(63) }), response: { 200: z.array(DocumentRevisionDto) } } },
    (req) => s.documents.revisions(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.params.docId),
  );
  app.post(
    '/tenants/:tenantId/projects/:project/forms/:key/documents/sample',
    { schema: { params: PK, body: DocumentSampleInput } },
    async (req, reply) => sendFile(reply, await s.documents.sample(actorOf(req), req.params.tenantId, req.params.project, req.params.key, req.body)),
  );
  app.post('/tenants/:tenantId/projects/:project/submissions/:id/review', { schema: { params: PId, body: ReviewInput, response: { 200: SubmissionDto } } }, (req) =>
    s.forms.review(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/submissions/:id', { schema: { params: PId, body: ResubmitInput, response: { 200: SubmissionDto } } }, (req) =>
    s.forms.resubmit(actorOf(req), req.params.tenantId, req.params.project, req.params.id, req.body),
  );

  // ----- the organisation's Forms menu and review inbox -----
  const FormGroups = { 200: z.array(FormGroupDto) };
  app.get('/tenants/:tenantId/projects/:project/form-groups', { schema: { params: P, response: FormGroups } }, (req) =>
    s.forms.projectGroups(actorOf(req), req.params.tenantId, req.params.project),
  );
  app.post('/tenants/:tenantId/projects/:project/form-groups', { schema: { params: P, body: FormGroupInput, response: FormGroups } }, (req) =>
    s.forms.saveProjectGroup(actorOf(req), req.params.tenantId, req.params.project, req.body),
  );
  app.put('/tenants/:tenantId/projects/:project/form-groups/:id', { schema: { params: PId, body: FormGroupInput, response: FormGroups } }, (req) =>
    s.forms.saveProjectGroup(actorOf(req), req.params.tenantId, req.params.project, req.body, req.params.id),
  );
  app.delete('/tenants/:tenantId/projects/:project/form-groups/:id', { schema: { params: PId, response: FormGroups } }, (req) =>
    s.forms.deleteProjectGroup(actorOf(req), req.params.tenantId, req.params.project, req.params.id),
  );
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
  app.get('/public/projects', { schema: { response: { 200: z.array(PublicProjectCard) } } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return s.query.publicCatalogue();
  });
  app.get('/public/projects/:tenant/:project', { schema: { params: Params, response: { 200: PublicProjectDto } } }, async (req, reply) => {
    reply.header('cache-control', 'public, max-age=30');
    return s.query.publicView(req.params.tenant, req.params.project);
  });
  const At = z.object({ entity: z.uuid().optional() });
  const AtPeriod = At.extend(OverlayPeriod.shape);
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
    { schema: { params: Params.extend({ key: z.string().max(63) }), querystring: AtPeriod, response: { 200: OverlayResult } } },
    async (req, reply) => {
      cache(reply);
      return s.explore.publicOverlay(req.params.tenant, req.params.project, req.params.key, req.query.entity ?? null, { hours: req.query.hours, from: req.query.from, to: req.query.to });
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
    '/public/projects/:tenant/:project/dashboards/:dashboard/filters/:filter/values',
    { schema: { params: Params.extend({ dashboard: z.string().max(63), filter: z.string().max(40) }), querystring: z.object({ cf: DashboardParams.shape.cf }), response: { 200: z.array(z.string()) } } },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=60');
      return s.query.publicFilterValues(req.params.tenant, req.params.project, req.params.dashboard, req.params.filter, req.query.cf);
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

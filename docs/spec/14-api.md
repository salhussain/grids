# 14. API design

- **REST + JSON** with an **OpenAPI spec generated from Zod** (one source of truth), plus generated TypeScript clients for web and mobile.
- **Tenant resolution:** subdomain or custom domain → `tenant_id`, then `/api/v1/projects/{projectId}/…`.
- **Resource groups:** `/platform/*` (super-admin), `/tenant/*` (org admin: members, org units, roles, theme, connections), `/projects/*` (entity types, entities, hierarchies, forms, submissions, datasets, jobs, runs, dashboards), `/query` (semantic query), `/sync/pull` and `/sync/push`, `/events` (SSE), `/public/{tenant}/{project}/*`, and inbound `/hooks/{token}`.
- Cursor pagination, `Idempotency-Key` on writes, ETags, structured errors (RFC 7807), and audit logging of every mutation.

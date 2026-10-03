# 2. Tenancy & isolation architecture

**Control plane DB (`platform`)** holds tenants, domains and slugs, plans, entitlements, subscriptions, usage meters, global user identities, tenant↔user memberships, IdP connection configs, the tenant→cell/database routing table, platform audit logs and feature flags.

**Data plane (tenant data)** has the same schema everywhere and is reached through a **Tenant Router**:

- **Shared tier.** One Postgres cluster ("cell"). Every table has `tenant_id`, and Postgres **row-level security** uses `current_setting('app.tenant_id')`, which is set per transaction by the data access layer. Isolation therefore holds even if application code forgets a filter.
- **Dedicated tier (later).** The tenant gets its own database or cluster with the identical schema. The router maps `tenant_id → connection string`. Moving a tenant is an export/import done by a platform job.
- **Migrations** are run by a migrator that iterates over all cells and dedicated databases. Schema versions are recorded per database.
- **Project isolation** is _logical_ (`project_id` plus permission checks) rather than physical. Projects share entity infrastructure so cross-project reuse stays possible (for example shared master entities). Each project has its own analytics schema namespace for materialised datasets.
- **Object storage** (S3-compatible: SeaweedFS in dev, S3 in prod) uses the key prefix `tenants/{tenant_id}/…`, with per-tenant encryption context later.
- **Cell architecture for scale.** Tenants are spread across multiple shared clusters. Routing is always by `tenant_id`, so adding cells needs no code changes.

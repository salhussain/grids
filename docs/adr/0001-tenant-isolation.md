# ADR 0001: Hybrid tenant isolation (shared RLS tier + dedicated-DB tier)

- Status: Accepted (2026-10-02)

## Context

Tenants (organisations) need strong data isolation, but a solo-built product cannot afford the operational cost of N databases from day one (migrations, connection pools, backups, provisioning per tenant).

## Decision

- A central **control-plane database** holds tenants, plans, identities, memberships and the tenant→database routing table.
- Tenant data lives in a **shared Postgres "cell"**. Every tenant table has `tenant_id` and a Postgres **row-level security** policy on `current_setting('app.tenant_id')`, which the data access layer sets per transaction (`SET LOCAL`). The application role is not a table owner and cannot bypass RLS.
- A **Tenant Router** resolves `tenant_id → connection`. Enterprise tenants can be moved to a dedicated database with the identical schema. Adding cells needs no code changes.

## Alternatives

- Database per tenant from day 1: strongest isolation, too much operational load now.
- Schema per tenant: migrations still fan out, catalogue bloat beyond ~1000 tenants.

## Consequences

- Every query must run inside `withTenant(tenantId, tx => …)`. A CI test suite asserts that no table can be read across tenants.
- The migrator must iterate over all databases listed in the routing table.

# 17. Hard decisions (recorded as ADRs)

1. RLS shared tier plus a router for dedicated databases, rather than database-per-tenant from day 1.
2. A custom orchestration engine on Postgres rather than embedding Dagster or Temporal.
3. The observation grain plus entity attribute projection rather than pure EAV or per-tenant DDL. Per-tenant materialised dataset tables are only allowed in the analytics namespace.
4. Scoped RBAC with entity-subtree grants rather than full ABAC or Zanzibar. We revisit this if cross-object sharing appears.
5. Zitadel for identity rather than building our own or using Keycloak.
6. Immutable form versions and append-only submissions, which make offline sync tractable.
7. Field-level last-writer-wins with hybrid logical clocks, plus a manual-conflict opt-in, rather than CRDTs.

# Architecture Decision Records

| #                                           | Decision                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- |
| [0001](0001-tenant-isolation.md)            | Hybrid tenant isolation (shared RLS + dedicated databases)            |
| [0002](0002-custom-orchestration.md)        | Custom orchestration engine on Postgres                               |
| [0003](0003-canonical-data-model.md)        | Canonical model: entities + observations + datasets                   |
| [0004](0004-authorization-model.md)         | Scoped RBAC with entity-subtree grants                                |
| [0005](0005-identity-provider.md)           | ~~Zitadel as identity provider~~ (superseded by 0009)                 |
| [0006](0006-immutable-forms-submissions.md) | Immutable form versions, append-only submissions                      |
| [0007](0007-sync-conflict-resolution.md)    | Field-level last-writer-wins + hybrid logical clocks for offline sync |
| [0008](0008-tech-stack.md)                  | TypeScript end-to-end stack                                           |
| [0009](0009-own-identity-service.md)        | Own identity service on `oidc-provider`                               |

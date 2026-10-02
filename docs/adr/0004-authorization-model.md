# ADR 0004: Scoped RBAC with entity-subtree grants

- Status: Accepted (2026-10-02)

## Decision

Permissions come from a fixed catalogue. Roles are bundles of permissions (system or custom). A grant is `(user|group, role, scope)` where the scope is tenant, org_unit (inherited down the tree), project, or project + entity subtree (an ltree path). Each request compiles a policy context of permissions plus allowed paths. The query engine always injects `path <@ ANY(allowed_paths)`.

## Alternatives

Full ABAC, or a Zanzibar-style system (OpenFGA/SpiceDB). More expressive, but an extra service, and the common case doesn't need it yet.

## Consequences

Per-object ad-hoc sharing is not supported initially. We revisit if it is needed.

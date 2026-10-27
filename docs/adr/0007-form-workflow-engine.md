# ADR 0007: Form workflows are graphs run by a small in-API engine

- Status: Accepted (2026-10-05)

## Context

Forms had a linear chain of approval stages. Tenants also need branching on answers, email and webhooks at chosen points, entity writes before a submission is final, and deadlines (SLAs) on approvals. ADR 0002 left room to revisit Temporal if long-running human-in-the-loop workflows grew.

## Decision

A form's `settings.workflow.graph` is a node graph (start, approval, branch, notify, webhook, entity, wait, end) whose edges leave a node by a named outlet (`approved`, `rejected`, `returned`, `timeout`, `true`, `false`, `next`). A linear `stages` list still works: `graphFromStages` runs it as the equivalent graph.

- **Pure core** (`@grids/forms` `workflow.ts`): `begin`/`advance` return where the submission parks and the effects to perform. No I/O. `lintWorkflow` validates graphs on save.
- **State** is `submission.node_id` (the existing `status` values are unchanged). Every transition appends a `submission_review` row.
- **Effects:** entity writes run in the decision's transaction. Email, webhooks and timers go to the `workflow_task` outbox in the same transaction.
- **Runner** (`WorkflowRunner` in the API): claims due tasks with `FOR UPDATE SKIP LOCKED` leases, retries webhooks and email with backoff, and fires timers (approval SLA → `timeout` outlet or a reminder to approvers; `wait` nodes). It runs in the API process because email and the tenant-scoped services live there; instances can run side by side.
- **Webhooks** may only call public http(s) addresses (checked on save and at send time, redirects refused).
- Graphs are not versioned with form definitions: like access settings they apply on save.

## Not in v1

Parallel (fork/join) approvals, per-tenant task scanning that avoids visiting every active tenant each tick, and DNS-rebinding protection for webhooks.

## Consequences

Temporal is still not needed: state is one row per submission plus an outbox. If tenants outgrow polling, the runner can move to the worker with the same tables.

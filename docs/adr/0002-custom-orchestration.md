# ADR 0002: Build orchestration on Postgres instead of embedding Dagster or Temporal

- Status: Accepted (2026-10-02)

## Context

Tenants need schedules, sensors, triggers, job DAGs, retries, run history and freshness, all **configured in the UI**, **isolated per tenant** and **metered** for billing.

## Decision

Build our own engine: Zod-validated job definitions, a registry of typed step operators, a single-leader scheduler (Postgres advisory lock), and a **graphile-worker** queue with per-tenant concurrency limits and fair queuing. Run, step and log tables provide history and lineage.

## Alternatives

- Dagster: Python, jobs defined in code, a single-tenant deployment model, so a poor fit for UI-defined multi-tenant jobs.
- Temporal: excellent durability but heavy infrastructure, and its model is code-defined workflows.
- Redis/BullMQ: an extra service, with no transactional coupling to our data.

## Consequences

We own the retry, backoff and timeout logic. We can revisit Temporal if long-running human-in-the-loop workflows grow.

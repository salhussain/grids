# 7. Orchestration engine (Dagster-style, built in)

We build our own on Postgres instead of embedding Dagster. Dagster is Python-only, single-tenant per deployment and code-defined, and our users need _configured_ (UI-defined), multi-tenant, quota-metered jobs.

- **Definitions** are stored per project and validated by Zod:
  - `job`: a DAG of steps, each with typed inputs and outputs.
  - `schedule`: cron with a timezone.
  - `sensor`: polls a connector or condition at an interval and keeps a cursor.
  - `trigger`: an event such as `submission.created`, `entity.updated`, `dataset.materialised`, a webhook received or a file uploaded.
  - **asset/dataset dependencies:** declarative "re-materialise when upstream changes" automation.
- **Step operators** come from a built-in, extensible registry: `http.extract`, `db.extract`, `file.parse`, `sql.transform` (DuckDB or Postgres), `map.load`, `dhis2.push`, `entity.upsert`, `notify.email/webhook`, `branch`, `wait`. **Custom code** comes later as sandboxed TypeScript (Deno or isolates) or a Python container runner.
- **Execution:** a scheduler (single leader, using a Postgres advisory lock) enqueues runs into a **Postgres-backed queue** (`graphile-worker`, so no extra infrastructure). Workers execute steps with **per-tenant concurrency limits and fair queuing**.
- **Reliability:** per-step retries with exponential backoff and jitter, timeouts, idempotency keys, dead-letter on exhaustion, manual re-run of a step or of the run from the failed step, and cancellation.
- **Observability:** `run`, `step_run`, `run_log`, materialisation events and lineage (which run produced which dataset version), plus run history UI, alerts on failure or staleness, and **metering** (run minutes and rows ingested feed billing).

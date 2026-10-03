# 6. Ingestion, external schemas & the canonical model

This is the "different external schemas, one internal model" problem. It is solved with **landing → mapping → canonical** layers:

1. **Extract:** connectors pull or receive data (HTTP/REST, GraphQL, webhooks, Postgres/MySQL/MSSQL, S3, SFTP, CSV/Excel/Parquet/JSON/log uploads, Kafka/MQTT later, DHIS2).
2. **Land (raw):** payloads are stored as-is in object storage (Parquet/NDJSON) with run lineage, so any run can be replayed.
3. **Parse and transform:** **DuckDB** runs embedded in workers. It reads CSV, Excel, Parquet and JSON natively and is very fast. Users write declarative steps (rename, cast, filter, derive, unpivot, dedupe) or SQL.
4. **Map:** a declarative **Mapping Spec** turns rows into canonical targets: `upsert entities` (match on code or external ID), `write observations`, `append dataset rows`, or `create submissions`. Mappings are versioned, and validation errors go to a per-run quarantine table.
5. **Load:** idempotent upserts keyed by `(source, external_id)`, with an `external_id` table that keeps identity across systems.

**Interoperability** works through connector plus mapping pairs. **DHIS2** gets a first-class connector: org units ↔ entities, data elements ↔ data elements, data values ↔ observations, events/tracker ↔ submissions, with push and pull. The observation grain was chosen to match DHIS2. **FHIR** (Patient, Observation, Location) and **CSV/ODK** follow the same pattern later.

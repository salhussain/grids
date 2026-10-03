# ADR 0003: Canonical model = entities (attribute projection) + observations + datasets

- Status: Accepted (2026-10-02)

## Decision

- **Entities** store current state in `attributes jsonb`, projected from an append-only `attribute_change` history using per-attribute source priority.
- **Observations** `(entity, data_element, period/time, value, source)` are the analytic grain (aligned with DHIS2 data values).
- **Datasets** are tables materialised by jobs, created only inside each project's analytics schema namespace, with a registered schema and freshness policy.
- External data enters through raw landing → mapping spec → canonical targets.

## Alternatives

Pure EAV everywhere (slow and awkward to query), or per-tenant DDL for every entity type (migration chaos).

## Consequences

The query engine has three source kinds. Large observation volumes will need partitioning (or Timescale) later.

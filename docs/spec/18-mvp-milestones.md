# 18. MVP scope & milestones

**MVP goal:** both demo projects running on the real architecture. Stripe, dedicated databases, mobile/offline, DHIS2 and custom code are deferred, but their seams exist.

| #        | Milestone                   | Outcome                                                                                                                                                                                                                                          |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 ✅    | Foundations                 | `git init` in `grids/`, write `docs/spec` and ADRs, monorepo, Docker Compose (Postgres+PostGIS, S3-compatible store, Zitadel), CI, lint/test setup                                                                                               |
| M1 ✅    | Control plane & identity    | tenants, plans/entitlements (manual), memberships, Zitadel integration, platform console: create org + invite org admin                                                                                                                          |
| M2 ✅ | Tenant admin & authZ        | org units, groups, roles, grants, RLS, policy context, audit log, theme editor                                                                                                                                                                   |
| M3       | Projects & entities         | project CRUD, visibility, entity types/attributes, hierarchies (ltree), entity CRUD + map view, project members                                                                                                                                  |
| M4       | Orchestration core          | job/schedule/sensor definitions, scheduler, worker, retries, run history UI, `http.extract`, `sql.transform`, `map.load`, `file.parse` (CSV/Excel/Parquet via DuckDB), datasets + freshness                                                      |
| M5       | Query & viz engine          | semantic query compiler with permission injection, cache, ECharts/MapLibre/deck.gl renderers, dashboard builder, params, SSE live refresh, public API                                                                                            |
| **P1**   | **Flight tracker (public)** | OpenSky ingestion job every 30–60s (bounding box) → Aircraft entities + position observations → live map, selected-flight panel, freshness badge, anonymous access                                                                               |
| M6       | Forms                       | form builder, runtime, expressions, publish/versioning, submissions, attribute bindings, observations fan-out                                                                                                                                    |
| **P2**   | **Private project**         | e.g. "Facility asset & inspection management": Country→Region→Facility→Asset hierarchy, inspection survey updating asset condition attributes, CSV asset import job, scoped roles (regional manager sees own region), branded private dashboards |
| Post-MVP |                             | Stripe and usage billing, SSO federation UI, DHIS2 connector, Expo offline app plus sync, dedicated-database tier, custom code steps, XLSForm, FHIR, Kubernetes                                                                                  |

**Open items to confirm during M0:**

- **Flight data source.** OpenSky gives positions, altitude and speed (anonymous, rate-limited). ETA, schedules and departure/arrival need an extra source, such as AeroDataBox or AviationStack (free tiers exist), or are derived from OpenSky's `flights` endpoint, which needs an account.
- **Project 2's exact use case.** The inspection use case above is my proposed default.

# 18. MVP scope & milestones

**MVP goal:** both demo projects running on the real architecture. Stripe, dedicated databases, mobile/offline, DHIS2 and custom code are deferred, but their seams exist.

| #         | Milestone                   | Outcome                                                                                                                                                                                                                                          |
| --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 ✅     | Foundations                 | `git init` in `grids/`, write `docs/spec` and ADRs, monorepo, Docker Compose (Postgres+PostGIS, S3-compatible store, Zitadel), CI, lint/test setup                                                                                               |
| M1 ✅     | Control plane & identity    | tenants, plans/entitlements (manual), memberships, Zitadel integration, platform console: create org + invite org admin                                                                                                                          |
| M2 ✅     | Tenant admin & authZ        | org units, groups, roles, grants, RLS, policy context, audit log, theme editor                                                                                                                                                                   |
| M3 ✅     | Projects & entities         | project CRUD, visibility, entity types/attributes, hierarchies (ltree), entity CRUD + map view, project members                                                                                                                                  |
| M4 ✅     | Orchestration core          | job/schedule/sensor definitions, scheduler, worker, retries, run history UI, `http.extract`, `sql.transform`, `map.load`, `file.parse` (CSV/Excel/Parquet via DuckDB), datasets + freshness                                                      |
| M5 ✅     | Query & viz engine          | semantic query compiler with permission injection, cache, ECharts/MapLibre/deck.gl renderers, dashboard builder, params, SSE live refresh, public API                                                                                            |
| **P1** ✅ | **Flight tracker (public)** | OpenSky ingestion job every 30–60s (bounding box) → Aircraft entities + position observations → live map, selected-flight panel, freshness badge, anonymous access                                                                               |
| M6 ✅     | Forms                       | form builder, runtime, expressions, publish/versioning, submissions, attribute bindings, observations fan-out                                                                                                                                    |
| **P2** ✅ | **Private project**         | e.g. "Facility asset & inspection management": Country→Region→Facility→Asset hierarchy, inspection survey updating asset condition attributes, CSV asset import job, scoped roles (regional manager sees own region), branded private dashboards |
| Post-MVP  |                             | Stripe and usage billing, SSO federation UI, DHIS2 connector, Expo offline app plus sync, dedicated-database tier, custom code steps, XLSForm, FHIR, Kubernetes                                                                                  |

**Status.** M3–M6, P1 and P2 are built and covered by integration tests. P2 ships as the health surveillance template (Province → District → Facility, weekly reporting form bound to indicators, map overlays and a province-scoped dashboard) rather than the asset-inspection example. Beyond the milestone text, projects now open in a Tupaia-style explorer (map overlays rolled up per place, a place-scoped dashboard sidebar, hierarchy browser), visuals can be restricted by project permission groups, and jobs run from events, webhooks and sensors as well as schedules (spec §7). Known gaps, to pick up next:

- `file.parse` reads CSV, JSON and NDJSON uploads; Excel and Parquet (DuckDB) are not wired in yet, and uploads are stored in Postgres (20 MB cap) rather than the object store.
- Freshness is computed and shown everywhere, but no sensor raises alerts or notifications when a dataset goes stale.
- Permission groups gate visuals and their data endpoints; raw data browsing (Entities, Data tabs) is still governed by the project role alone.
- Forms cover 12 question types; photo, file, signature, barcode, entity-picker, matrix and repeat groups are still to come.
- The end-to-end scenarios of §19 (stale badge when the worker stops, a regional user seeing nothing of another region) are not yet Playwright tests.
- The OpenAPI document generated from the Zod schemas is not published.

**Open items to confirm during M0:**

- **Flight data source.** OpenSky gives positions, altitude and speed (anonymous, rate-limited). ETA, schedules and departure/arrival need an extra source, such as AeroDataBox or AviationStack (free tiers exist), or are derived from OpenSky's `flights` endpoint, which needs an account.
- **Project 2's exact use case.** The inspection use case above is my proposed default.

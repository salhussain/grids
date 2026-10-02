# 15. Technology stack (TypeScript end-to-end)

I chose TypeScript end-to-end because you're building solo. It lets one language and one set of Zod schemas drive the API, web, mobile, forms and job definitions. The performance-critical paths go to engines built for them: Postgres/PostGIS for OLTP and spatial work, DuckDB for transforms, and ECharts/deck.gl for rendering.

| Layer               | Choice                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo            | pnpm workspaces + Turborepo                                                                                                           |
| API                 | Node 22, TypeScript 6.0 (7.x once typescript-eslint supports it), **Fastify** + `fastify-type-provider-zod`                           |
| DB access           | **Kysely** (type-safe SQL, no ORM overhead), with SQL migrations                                                                      |
| Databases           | **PostgreSQL 16 + PostGIS + ltree**. Later: Timescale/partitioning for observations, and ClickHouse when analytics outgrows Postgres. |
| Queue/orchestration | graphile-worker (Postgres) plus our own scheduler and run engine                                                                      |
| Transforms          | DuckDB (node bindings) in workers                                                                                                     |
| Object storage      | Any S3-compatible store: SeaweedFS in dev (MinIO stopped publishing community images in 2025), AWS S3 or equivalent in prod           |
| Identity            | Zitadel (OIDC/SAML, multi-org) behind our own `auth` package                                                                          |
| Web                 | React 19 + Vite + TanStack Router/Query, Tailwind + shadcn/Radix, react-hook-form                                                     |
| Viz                 | ECharts, MapLibre GL + OSM vector tiles, deck.gl, TanStack Table                                                                      |
| Mobile (later)      | Expo/React Native + SQLite (op-sqlite or Expo SQLite)                                                                                 |
| Testing             | Vitest, Testcontainers (real Postgres), Playwright                                                                                    |
| Infrastructure      | Docker Compose (postgres, S3-compatible store, zitadel, api, worker, web), with Kubernetes and Helm later. Built on OpenTelemetry.    |

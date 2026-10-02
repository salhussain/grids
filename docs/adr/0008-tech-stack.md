# ADR 0008: TypeScript end-to-end, with heavy work on specialised engines

- Status: Accepted (2026-10-02)

## Decision

Node 22 + Fastify + Kysely; React 19 + Vite + TanStack; Expo later. Zod schemas in `@grids/schema` are the single source of truth for API contracts, OpenAPI, form, viz, query and job definitions. Postgres 16 + PostGIS + ltree, DuckDB for transforms, Apache ECharts for charts, MapLibre GL + OpenStreetMap vector tiles + deck.gl for maps, an S3-compatible object store (SeaweedFS in dev).

## Rationale

Built by one developer: one language, shared types and a shared form runtime across web, mobile and server. Performance-critical work runs in Postgres, DuckDB and GPU renderers, not in Node.

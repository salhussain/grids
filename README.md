# Grids

A multi-tenant, configurable data platform: entity hierarchies, dynamic forms, data ingestion and orchestration, and configurable maps, charts and dashboards, with per-tenant branding and access control.

- Product spec: [docs/spec](docs/spec/README.md)
- Architecture decisions: [docs/adr](docs/adr/README.md)

## Local development

Requirements: Node 22 (`nvm use`), pnpm 9, Docker.

```sh
cp .env.example .env
pnpm install
docker compose --profile auth up -d   # Postgres+PostGIS, S3 store, Mailpit (dev inbox), Zitadel
pnpm build
pnpm db:migrate                       # control plane + every tenant cell
pnpm bootstrap:idp                    # Zitadel project/app, SMTP, platform admin → writes .env files
pnpm --filter @grids/api start        # API on http://localhost:4000
pnpm --filter @grids/console dev      # Platform console on http://localhost:5173
pnpm --filter @grids/web dev          # Organisation workspace on http://localhost:5174
```

Sign in to the console as `platform-admin@grids-platform.localhost` / `Password1!`.

| Service                                 | URL                                             |
| --------------------------------------- | ----------------------------------------------- |
| Platform console (Grids staff)          | http://localhost:5173                           |
| Organisation workspace                  | http://localhost:5174                           |
| API (`/readyz`)                         | http://localhost:4000                           |
| Zitadel (identity)                      | http://localhost:8080                           |
| Mailpit (dev inbox: verification codes) | http://localhost:8025                           |
| Postgres                                | localhost:55432 (set `GRIDS_PG_PORT` to change) |

| Command                        | What it does                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `pnpm test`                    | Unit plus Testcontainers integration tests (needs Docker)              |
| `pnpm e2e`                     | Playwright end-to-end against the running stack (uses Chrome on macOS) |
| `pnpm lint` / `pnpm typecheck` | ESLint / tsc across the workspace                                      |

## Layout

```
apps/api          Fastify HTTP API: control plane, workspace, console endpoints
apps/console      Platform console for Grids staff (React + Vite + TanStack)
apps/web          Organisation workspace: people, structure, roles, branding, support
e2e/              Playwright end-to-end tests
packages/schema   Zod schemas: the single source of truth for API and config contracts
packages/ui       Design system: tokens (sharp, brandable), components, pagination, live refresh
packages/db       Kysely access, withTenant() RLS scoping, TenantRouter, migrations
infra/            Postgres bootstrap, object store config
docs/             spec + ADRs
```

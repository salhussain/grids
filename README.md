# Grids

A multi-tenant, configurable data platform: entity hierarchies, dynamic forms, data ingestion and orchestration, and configurable maps, charts and dashboards, with per-tenant branding and access control.

- Product spec: [docs/spec](docs/spec/README.md)
- Architecture decisions: [docs/adr](docs/adr/README.md)

## Local development

Requirements: Node 22 (`nvm use`), pnpm 9, Docker.

```sh
cp .env.example .env
pnpm install
docker compose --profile auth up -d   # Postgres+PostGIS, S3 store, Zitadel
pnpm build
pnpm db:migrate                       # control plane + every tenant cell
pnpm bootstrap:idp                    # Zitadel project/app, SMTP, platform admin → writes .env files
pnpm --filter @grids/api start        # API on http://localhost:4000
pnpm --filter @grids/console dev      # Platform console on http://localhost:5173
pnpm --filter @grids/web dev          # Organisation workspace on http://localhost:5174
pnpm --filter @grids/site dev         # Marketing and pricing site on http://localhost:5177
```

Sign in to the console as `platform-admin@grids-platform.localhost` / `Password1!`.

| Service                                 | URL                                             |
| --------------------------------------- | ----------------------------------------------- |
| Platform console (Grids staff)          | http://localhost:5173                           |
| Organisation workspace                  | http://localhost:5174                           |
| Marketing and pricing site              | http://localhost:5177                           |
| API (`/readyz`)                         | http://localhost:4000                           |
| Zitadel (identity)                      | http://localhost:8080                           |
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
apps/site         Public marketing site: product, pricing, contact
e2e/              Playwright end-to-end tests
packages/schema   Zod schemas: the single source of truth for API and config contracts
packages/ui       Design system: tokens (sharp, brandable), components, pagination, live refresh
packages/db       Kysely access, withTenant() RLS scoping, TenantRouter, migrations
infra/            Postgres bootstrap, object store config
docs/             spec + ADRs
```

## Help window on other websites

Organisations paste a snippet from **Settings → Help desk → Website embed**. How it is kept safe:

- The snippet loads `/embed.js` from the **API** and carries the organisation's public **embed key**. Rotating the key switches every old copy off; a **Pause** switch turns all embeds off at once.
- The framed page `/embed/help` is served by the **API**, only for the right key, and with `Content-Security-Policy: frame-ancestors <the organisation's listed sites>`, so browsers refuse to draw it anywhere else.
- Inside it is the web app's `/embed/help` page, which needs a short-lived signed token and re-checks the top-level site where the browser reports it. Requests that came through an embed carry the token and are limited together.
- The public chat endpoints stay open (as for any contact form); the spam puzzle, rate limits and optional email codes still apply.

**Deployment:** give the web app's host `Content-Security-Policy: frame-ancestors 'none'` for every path except `/embed/help`, and `frame-ancestors <the API's origin>` for `/embed/help`, so the app cannot be framed by other sites and only the API's embed page can frame the inner page.

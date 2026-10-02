# 16. Repo structure

```
grids/
  apps/
    api/            Fastify HTTP API (tenant + platform + public)
    worker/         scheduler, sensors, run executor
    web/            React app: viewer + "Studio" (org/project admin)
    console/        platform super-admin console (small)
    mobile/         (post-MVP) Expo app
  packages/
    schema/         Zod schemas for ALL config: forms, viz, query, jobs, mapping, theme, permissions
    db/             Kysely types, migrations, tenant router, RLS session helper
    auth/           OIDC verification, policy context, permission checks
    query-engine/   semantic query → SQL compiler, cache
    forms/          form runtime + expression evaluator (platform-agnostic)
    orchestration/  DAG model, operator registry, run state machine
    connectors/     http, postgres, files, dhis2 …
    ui/             design system + theming tokens
    viz/            ECharts/MapLibre renderers from presentation specs
  docs/spec/        full spec + ADRs
  docker-compose.yml
```

Extensibility rule: **every new capability is a typed registry entry** (question type, step operator, connector, viz type or permission) rather than a code fork, so a new customer use case means configuration, not redesign.

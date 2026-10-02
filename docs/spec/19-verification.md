# 19. Verification

- **Per milestone:** Vitest unit tests (expression engine, query compiler, permission evaluator, mapping), plus integration tests against real Postgres via Testcontainers. These include an **RLS cross-tenant leak suite**: for every table, tenant A must never read tenant B.
- **Permission matrix tests:** for each role and scope, the expected allow/deny results and row filtering.
- **Orchestration tests:** forced step failures → retries → dead-letter, and resume from a failed step.
- **End to end:** `docker compose up`, then Playwright scripts that (a) open the public flight tracker anonymously, see aircraft on the map and a "Fresh" badge, and confirm it turns "Stale" when the worker stops; (b) have the platform admin create an org, the org admin create a project, roles and a user, the user submit an inspection on mobile viewport width, the asset attribute update, and the dashboard reflect it while another region's user sees nothing.

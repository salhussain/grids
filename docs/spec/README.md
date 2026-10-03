# Grids — Product Specification

Living spec. Each section is its own file; architecture decisions are in [../adr](../adr).

## Context

We're building a multi-tenant, configurable data platform, positioned as "Tupaia, but more flexible and customisable for each tenant". It covers data collection (forms/surveys), entity hierarchies, ingestion and orchestration (Dagster-style), visualisation (maps, charts, dashboards, KPIs), per-tenant branding, SSO, and offline mobile collection, all sold on subscription tiers.

Constraints: **hybrid tenant isolation** (shared Postgres with row-level security now, dedicated databases per tier later), **Docker Compose first and Kubernetes later**, a **solo builder**, and a stack optimised for performance and customisability.

The MVP is delivered milestone by milestone (see section 18).

## Sections

- [1. Core concepts (domain glossary)](01-domain-model.md)
- [2. Tenancy & isolation architecture](02-tenancy-isolation.md)
- [3. Identity, authentication & authorisation](03-identity-authz.md)
- [4. Entities, hierarchies & attributes](04-entities-hierarchies.md)
- [5. Dynamic forms/surveys](05-forms.md)
- [6. Ingestion, external schemas & the canonical model](06-ingestion-interop.md)
- [7. Orchestration engine (Dagster-style, built in)](07-orchestration.md)
- [8. Data freshness](08-freshness.md)
- [9. Semantic layer, visualisations & dashboards](09-visualisation.md)
- [10. Branding / theming](10-branding.md)
- [11. Mobile & offline-first (designed now, built post-MVP)](11-mobile-offline.md)
- [12. Billing & limits](12-billing-limits.md)
- [13. Public vs private projects](13-public-private.md)
- [14. API design](14-api.md)
- [15. Technology stack (TypeScript end-to-end)](15-tech-stack.md)
- [16. Repo structure](16-repo-structure.md)
- [17. Hard decisions (recorded as ADRs)](17-key-decisions.md)
- [18. MVP scope & milestones](18-mvp-milestones.md)
- [19. Verification](19-verification.md)
- [20. Platform console & commercial operations](20-platform-console.md)
- [21. Organisation workspace & access control](21-workspace-and-access.md)

# ADR 0005: Zitadel as identity provider behind an internal auth package

- Status: Superseded by [ADR 0009](0009-own-identity-service.md) (2026-10-02)

## Decision

Self-host **Zitadel** (Postgres-backed, multi-organisation). Each tenant maps to a Zitadel org. It supports local accounts (the platform acting as IdP), MFA and passkeys, and federation with OIDC/SAML IdPs per tenant. The apps verify OIDC tokens only through `@grids/auth`. Authorisation stays in the app.

## Alternatives

Keycloak (heavier, realm-per-tenant at scale is painful), building our own (security risk, slow), or SaaS such as Auth0/WorkOS (cost and vendor lock-in; WorkOS remains an option for enterprise SSO).

## Consequences

One more container in Compose. Swappable thanks to the abstraction.

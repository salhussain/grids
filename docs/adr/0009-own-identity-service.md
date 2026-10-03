# ADR 0009: Own identity service on `oidc-provider`

- Status: Accepted (2026-10-02). Supersedes [ADR 0005](0005-identity-provider.md).

## Context

Zitadel worked, but it cost us in three places:

- **The sign-in experience.** We need organisation-branded, translated (including right-to-left) sign-in pages that match the product's look. Zitadel's hosted login is hard to theme that far.
- **Operations.** It added a heavy extra container with its own bootstrap (machine keys, a project and per-app IDs, an SMTP provider), and two releases of churn showed up in our end-to-end tests.
- **Fit.** We used only a small slice of it: OIDC authorisation code with PKCE, local accounts, TOTP, an organisation's "2FA required" policy, and service calls to provision users and organisations.

## Decision

Run our own identity service, `apps/identity`. It is built on **`oidc-provider`**, the OpenID Certified library behind many production IdPs, so the protocol is not hand-written.

| Concern | Choice |
| --- | --- |
| Protocol | Authorisation code + PKCE (S256 required), refresh-token rotation, RP-initiated logout, discovery and JWKS. Public first-party clients `grids-console` and `grids-web`. |
| API tokens | Resource indicators. Access tokens are RS256 JWTs with `aud=urn:grids:api` and a 15-minute TTL, verified by the API against `/oidc/jwks`. |
| Storage | Its own database, `grids_identity`. All `oidc-provider` models go in one `oidc_model` table (JSONB, with expiry and a sweeper). Signing keys are persisted. |
| Passwords | argon2id (`@node-rs/argon2`). Minimum 10 characters, a common-password list, and no email local part. Constant-time dummy hashing for unknown emails. |
| Lockout | 5 failures lock the account for 15 minutes. Rate limits apply per route. |
| 2FA | TOTP (RFC 6238) with replay protection, plus 10 one-time recovery codes (hashed). The secret is sealed with AES-256-GCM. An organisation can require it, and enrolment is then forced at the next sign-in. |
| Email | 6-digit verification codes (5 attempts). Single-use reset and set-up links (hashed tokens). All templates are localised via `@grids/i18n`. |
| Browser security | The login API is same-origin only, guarded by an Origin check and a custom `x-grids-request` header, with a strict CSP via helmet and `frame-ancestors 'none'`. Interaction cookies are signed and path-scoped. |
| Organisations | The id equals the tenant id. Each has a `mfa_required` flag and an `allow_registration` flag, and is linked to its accounts on invitation acceptance. |
| Platform port | The `IdentityProvider` interface is implemented by `GridsIdpClient`, which calls `/internal/*` with a service bearer token. |
| UI | `apps/login` is a React SPA served at `/ui/`. It has a split-screen layout with organisation branding, 8 languages including Arabic (RTL), light/dark/system modes, and an account page for password, 2FA and recovery codes. |

## Alternatives

- **Keep Zitadel.** Rejected for the branding/i18n ceiling and the operational weight described above.
- **Keycloak.** Even heavier, and it has the same theming limits.
- **Hand-rolled OAuth.** Rejected: protocol bugs are security bugs. `oidc-provider` gives us a certified core.
- **SaaS (Auth0, WorkOS).** Rejected on per-MAU cost and vendor lock-in. WorkOS stays an option for enterprise SAML.

## Consequences

- **We own security-sensitive code** (accounts, 2FA, lockout). It is covered by integration tests that run real authorisation-code flows over HTTP against Postgres (`apps/identity/test`), plus the Playwright suite.
- **Federation (an organisation's own Entra ID, Google or Okta) is not built yet.** `oidc-provider` handles the client side poorly, so the plan is an upstream-OIDC login step in the interaction (openid-client), keyed by the organisation's email domain.
- **Passkeys (WebAuthn) are future work.** The interaction design (a step machine) leaves room for them.
- **Migration.** The previous IdP's users were re-created without passwords: `pnpm bootstrap:idp` maps their `idp_subject`s, and people set a password through "Forgot password".

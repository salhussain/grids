# 3. Identity, authentication & authorisation

**Identity (authN).** Use **Zitadel**, a self-hosted, Postgres-backed open-source IdP with native multi-organisation support. Each tenant maps to a Zitadel org. Zitadel provides:

- **Platform as IdP:** email and password, MFA, passkeys and magic links.
- **Federation:** a tenant can bring its own OIDC or SAML IdP (Entra ID, Google, Okta), and auto-provision users through just-in-time creation or SCIM.
- **Platform admin** is a separate realm with mandatory MFA.

The app only consumes OIDC tokens through a thin `auth` package, so the IdP can be swapped. Public projects use an `anonymous` principal. Machine access uses tenant-scoped **API keys** and service accounts.

**Authorisation (authZ).** This lives in the app, never in the IdP. It is **scoped RBAC with hierarchical inheritance**:

- **Permission:** a fixed catalogue of capabilities (`entity.read`, `entity.write`, `form.submit`, `form.design`, `dataset.query`, `job.run`, `dashboard.edit`, `member.manage`, `billing.manage`, …).
- **Role:** a named bundle of permissions. System roles are provided, and tenants can define custom roles.
- **Grant:** `(principal: user | group, role, scope)`, where the scope is one of `tenant`, `org_unit` (inherited down the org tree), `project`, or `project + entity_subtree` (for example "Facility manager for Region X and everything below it").
- **Groups:** users can be grouped, and org-unit membership implies group membership.
- **Evaluation:** a compiled per-request **policy context**, `{permissions × allowed entity subtree paths}`, cached by `(user, tenant, grants_version)`. Data queries get an injected `entity.path <@ ANY(:allowed_paths)` predicate, which gives **row-level data scoping** for free. Attribute-level masking (for example personally identifiable fields) comes later through attribute sensitivity tags plus a permission.
- **Platform admin** acts on tenants only through an audited "impersonate/support" grant.

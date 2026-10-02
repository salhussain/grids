# 21. Organisation workspace & access control

Two separate permission systems, one per audience:

| | Platform console (`apps/console`) | Organisation workspace (`apps/web`) |
|---|---|---|
| Who | Grids staff | An organisation's own people |
| Identity | Zitadel platform org | Zitadel org of each tenant |
| Model | Staff roles + individual permissions | Membership role + workspace roles granted per org unit |
| Stored in | Control plane (`staff_*`) | Tenant cell (`workspace_role`, `role_grant`, `org_unit`, `member_placement`), RLS-isolated |

## Console staff

- **Permission catalogue:** one permission per console action, grouped by module (`tenants.create`, `billing.payments`, `support.triage`, `staff.manage`, …). See `STAFF_MODULES` in `@grids/schema`.
- **Built-in roles:** Super admin, Operations, Billing manager, Support agent, Auditor. Custom roles can be added.
- **Effective permissions:** the union of a person's roles plus any individual permissions. Super admin always holds every permission, including ones added later, and can't be edited.
- **Enforcement:** every `/platform/*` route requires its specific permission, and services re-check it. Organisation-scoped endpoints accept staff with the matching staff permission.
- **Guardrails:** staff can't change their own access, and the platform always keeps at least one active Super admin.
- **Invitation:** creates the user in the platform Zitadel org. Zitadel emails a set-password link. Suspending a staff member also deactivates their Zitadel account.

## Workspace

- **Structure:** an org-unit tree of any depth (Region → District → Facility …). `ltree` paths support subtree checks. Moving a unit rewrites its subtree's paths, and moves that would create a cycle are rejected. A unit can only be deleted once it has no sub-units and no members.
- **Placement:** each member can be placed in one org unit. Invitations can target a unit, and the person is placed there on acceptance.
- **Permissions:** `WORKSPACE_MODULES`. Some are **scopable** (`people.view`, `people.invite`, `people.manage`) and can be granted for a subtree. All others only apply when granted organisation-wide.
- **Roles:**
  - *Organisation admin* (membership role) holds everything.
  - *Member* is everyone's baseline and is editable.
  - *Manager* is meant to be granted per unit.
  - Organisations can add custom roles.
- **Grants:** `(person, role, org unit | whole organisation)`. A scoped grant only contributes the role's scopable permissions.
- **Policy evaluation:** `workspacePolicy()` combines the control-plane membership with the cell grants. A permission is held either organisation-wide or within the subtree of each scoped grant.
  - Listings are filtered to that scope. A regional manager sees only their region's people and invitations.
  - Actions are checked against the target's position in the tree, e.g. suspending someone needs `people.manage` at that person's unit.
- **Escalation guards:** scoped managers can't invite or create administrators, and can't move people outside their subtree.

## Branding

`tenant_profile.theme` holds the workspace name, primary colour, logo, sidebar style and welcome message.

The design system (`@grids/ui`) reads `--brand-*` CSS variables at runtime (`@theme inline`). The web app derives the full palette from the one primary colour with `color-mix()`, and picks a readable text colour from the colour's luminance.

Custom colours and logos require the `custom_branding` plan feature. The name and welcome message are always allowed.

## Live data & pagination

- **Lists:** every list endpoint is offset-paginated (`page`, `pageSize` ≤ 100) and returns `{items, total, page, pageSize}`.
- **Live pages:** Overview, Support, Billing, the logs and ticket threads auto-refresh every 15 s. Each has a manual refresh button and a pause toggle; the pause is remembered per browser.

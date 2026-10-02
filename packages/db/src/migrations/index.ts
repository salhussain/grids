import type { Migration, MigrationProvider } from 'kysely/migration';
import * as p0001 from './platform/0001_cells.js';
import * as p0002 from './platform/0002_tenants_identity.js';
import * as p0003 from './platform/0003_console_v2.js';
import * as p0004 from './platform/0004_tenant_plan_optional.js';
import * as p0005 from './platform/0005_staff_rbac.js';
import * as p0006 from './platform/0006_invitation_org_unit.js';
import * as p0007 from './platform/0007_preferences.js';
import * as i0001 from './identity/0001_identity.js';
import * as t0001 from './tenant/0001_rls_foundation.js';
import * as t0002 from './tenant/0002_tenant_profile.js';
import * as t0003 from './tenant/0003_workspace_access.js';
import * as t0004 from './tenant/0004_localization.js';
import * as t0005 from './tenant/0005_projects.js';
import * as t0006 from './tenant/0006_orchestration.js';
import * as t0007 from './tenant/0007_dashboards_forms.js';

// Explicit registries (not filesystem globbing) so migrations bundle and typecheck.
const platform: Record<string, Migration> = {
  '0001_cells': p0001,
  '0002_tenants_identity': p0002,
  '0003_console_v2': p0003,
  '0004_tenant_plan_optional': p0004,
  '0005_staff_rbac': p0005,
  '0006_invitation_org_unit': p0006,
  '0007_preferences': p0007,
};
const tenant: Record<string, Migration> = {
  '0001_rls_foundation': t0001,
  '0002_tenant_profile': t0002,
  '0003_workspace_access': t0003,
  '0004_localization': t0004,
  '0005_projects': t0005,
  '0006_orchestration': t0006,
  '0007_dashboards_forms': t0007,
};

const provider = (m: Record<string, Migration>): MigrationProvider => ({
  getMigrations: async () => m,
});

const identity: Record<string, Migration> = { '0001_identity': i0001 };

export const platformMigrations = provider(platform);
export const identityMigrations = provider(identity);
export const tenantMigrations = provider(tenant);

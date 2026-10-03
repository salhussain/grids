import type { Migration, MigrationProvider } from 'kysely/migration';
import * as p0001 from './platform/0001_cells.js';
import * as p0002 from './platform/0002_tenants_identity.js';
import * as p0003 from './platform/0003_console_v2.js';
import * as p0004 from './platform/0004_tenant_plan_optional.js';
import * as p0005 from './platform/0005_staff_rbac.js';
import * as p0006 from './platform/0006_invitation_org_unit.js';
import * as p0007 from './platform/0007_preferences.js';
import * as p0008 from './platform/0008_platform_settings_support.js';
import * as i0001 from './identity/0001_identity.js';
import * as t0001 from './tenant/0001_rls_foundation.js';
import * as t0002 from './tenant/0002_tenant_profile.js';
import * as t0003 from './tenant/0003_workspace_access.js';
import * as t0004 from './tenant/0004_localization.js';
import * as t0005 from './tenant/0005_projects.js';
import * as t0006 from './tenant/0006_orchestration.js';
import * as t0007 from './tenant/0007_dashboards_forms.js';
import * as t0008 from './tenant/0008_files.js';
import * as t0009 from './tenant/0009_change_events.js';
import * as t0010 from './tenant/0010_dashboard_filters.js';
import * as t0011 from './tenant/0011_map_overlays.js';
import * as t0012 from './tenant/0012_permission_groups.js';
import * as t0013 from './tenant/0013_triggers_sensors.js';
import * as t0014 from './tenant/0014_form_workflow.js';
import * as t0015 from './tenant/0015_project_profile_groups.js';

// Explicit registries (not filesystem globbing) so migrations bundle and typecheck.
const platform: Record<string, Migration> = {
  '0001_cells': p0001,
  '0002_tenants_identity': p0002,
  '0003_console_v2': p0003,
  '0004_tenant_plan_optional': p0004,
  '0005_staff_rbac': p0005,
  '0006_invitation_org_unit': p0006,
  '0007_preferences': p0007,
  '0008_platform_settings_support': p0008,
};
const tenant: Record<string, Migration> = {
  '0001_rls_foundation': t0001,
  '0002_tenant_profile': t0002,
  '0003_workspace_access': t0003,
  '0004_localization': t0004,
  '0005_projects': t0005,
  '0006_orchestration': t0006,
  '0007_dashboards_forms': t0007,
  '0008_files': t0008,
  '0009_change_events': t0009,
  '0010_dashboard_filters': t0010,
  '0011_map_overlays': t0011,
  '0012_permission_groups': t0012,
  '0013_triggers_sensors': t0013,
  '0014_form_workflow': t0014,
  '0015_project_profile_groups': t0015,
};

const provider = (m: Record<string, Migration>): MigrationProvider => ({
  getMigrations: async () => m,
});

const identity: Record<string, Migration> = { '0001_identity': i0001 };

export const platformMigrations = provider(platform);
export const identityMigrations = provider(identity);
export const tenantMigrations = provider(tenant);

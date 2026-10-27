import type { Migration, MigrationProvider } from 'kysely/migration';
import * as p0001 from './platform/0001_cells.js';
import * as p0002 from './platform/0002_tenants_identity.js';
import * as p0003 from './platform/0003_console_v2.js';
import * as p0004 from './platform/0004_tenant_plan_optional.js';
import * as p0005 from './platform/0005_staff_rbac.js';
import * as p0006 from './platform/0006_invitation_org_unit.js';
import * as p0007 from './platform/0007_preferences.js';
import * as p0008 from './platform/0008_platform_settings_support.js';
import * as p0009 from './platform/0009_audit_context.js';
import * as p0010 from './platform/0010_org_help_desk.js';
import * as p0011 from './platform/0011_support_threads.js';
import * as p0012 from './platform/0012_support_ticket_links.js';
import * as p0013 from './platform/0013_help_desk_contact.js';
import * as p0014 from './platform/0014_support_favorites.js';
import * as p0015 from './platform/0015_session_policy.js';
import * as p0016 from './platform/0016_access_blocked.js';
import * as p0017 from './platform/0017_billing_address.js';
import * as p0018 from './platform/0018_usage_counter.js';
import * as p0019 from './platform/0019_payments.js';
import * as p0020 from './platform/0020_payment_merchants.js';
import * as p0021 from './platform/0021_merchant_logo.js';
import * as p0022 from './platform/0022_pay_moved.js';
import * as p0023 from './platform/0023_payment_method.js';
import * as p0024 from './platform/0024_payment_surcharge.js';
import * as p0025 from './platform/0025_payment_receipts.js';
import * as i0001 from './identity/0001_identity.js';
import * as i0002 from './identity/0002_org_client.js';
import * as i0003 from './identity/0003_org_blocked.js';
import * as y0001 from './pay/0001_pay.js';
import * as y0002 from './pay/0002_methods.js';
import * as y0003 from './pay/0003_custom_methods.js';
import * as y0004 from './pay/0004_surcharge.js';
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
import * as t0016 from './tenant/0016_points_markers_admin_group.js';
import * as t0017 from './tenant/0017_workflow_engine.js';
import * as t0018 from './tenant/0018_project_entity.js';
import * as t0019 from './tenant/0019_public_permission.js';
import * as t0020 from './tenant/0020_permission_ids.js';
import * as t0021 from './tenant/0021_member_roles.js';
import * as t0022 from './tenant/0022_public_permission_name.js';
import * as t0023 from './tenant/0023_member_scopes.js';
import * as t0024 from './tenant/0024_member_permissions.js';
import * as t0025 from './tenant/0025_org_entity_types.js';
import * as t0026 from './tenant/0026_shared_entities.js';
import * as t0027 from './tenant/0027_dashboard_icon.js';
import * as t0028 from './tenant/0028_connections.js';
import * as t0029 from './tenant/0029_submission_outcome.js';
import * as t0030 from './tenant/0030_file_connections.js';
import * as t0031 from './tenant/0031_sql_datasets.js';
import * as t0032 from './tenant/0032_form_attachments.js';
import * as t0033 from './tenant/0033_form_links.js';
import * as t0034 from './tenant/0034_form_email_codes.js';
import * as t0035 from './tenant/0035_form_link_dates.js';
import * as t0036 from './tenant/0036_form_link_language.js';
import * as t0037 from './tenant/0037_work.js';
import * as t0038 from './tenant/0038_work_schedule.js';
import * as t0039 from './tenant/0039_form_document_revisions.js';
import * as t0040 from './tenant/0040_data_groups.js';
import * as t0041 from './tenant/0041_project_support.js';
import * as t0042 from './tenant/0042_dataset_settings.js';
import * as t0043 from './tenant/0043_remove_project_support.js';
import * as t0044 from './tenant/0044_dataset_versions.js';
import * as t0045 from './tenant/0045_dataset_variants.js';
import * as t0046 from './tenant/0046_live_datasets.js';
import * as t0047 from './tenant/0047_inline_metrics.js';
import * as t0048 from './tenant/0048_plan_allowance.js';

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
  '0009_audit_context': p0009,
  '0010_org_help_desk': p0010,
  '0011_support_threads': p0011,
  '0012_support_ticket_links': p0012,
  '0013_help_desk_contact': p0013,
  '0014_support_favorites': p0014,
  '0015_session_policy': p0015,
  '0016_access_blocked': p0016,
  '0017_billing_address': p0017,
  '0018_usage_counter': p0018,
  '0019_payments': p0019,
  '0020_payment_merchants': p0020,
  '0021_merchant_logo': p0021,
  '0022_pay_moved': p0022,
  '0023_payment_method': p0023,
  '0024_payment_surcharge': p0024,
  '0025_payment_receipts': p0025,
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
  '0016_points_markers_admin_group': t0016,
  '0017_workflow_engine': t0017,
  '0018_project_entity': t0018,
  '0019_public_permission': t0019,
  '0020_permission_ids': t0020,
  '0021_member_roles': t0021,
  '0022_public_permission_name': t0022,
  '0023_member_scopes': t0023,
  '0024_member_permissions': t0024,
  '0025_org_entity_types': t0025,
  '0026_shared_entities': t0026,
  '0027_dashboard_icon': t0027,
  '0028_connections': t0028,
  '0029_submission_outcome': t0029,
  '0030_file_connections': t0030,
  '0031_sql_datasets': t0031,
  '0032_form_attachments': t0032,
  '0033_form_links': t0033,
  '0034_form_email_codes': t0034,
  '0035_form_link_dates': t0035,
  '0036_form_link_language': t0036,
  '0037_work': t0037,
  '0038_work_schedule': t0038,
  '0039_form_document_revisions': t0039,
  '0040_data_groups': t0040,
  '0041_project_support': t0041,
  '0042_dataset_settings': t0042,
  '0043_remove_project_support': t0043,
  '0044_dataset_versions': t0044,
  '0045_dataset_variants': t0045,
  '0046_live_datasets': t0046,
  '0047_inline_metrics': t0047,
  '0048_plan_allowance': t0048,
};

const provider = (m: Record<string, Migration>): MigrationProvider => ({
  getMigrations: async () => m,
});

const identity: Record<string, Migration> = { '0001_identity': i0001, '0002_org_client': i0002, '0003_org_blocked': i0003 };

export const platformMigrations = provider(platform);
export const identityMigrations = provider(identity);
export const payMigrations = provider({ '0001_pay': y0001, '0002_methods': y0002, '0003_custom_methods': y0003, '0004_surcharge': y0004 });
export const tenantMigrations = provider(tenant);

import { z } from 'zod';
import { PageQuery } from '../common.js';

/**
 * Platform console permission catalogue: one permission per console action,
 * grouped by module. Roles bundle permissions; staff hold roles plus optional
 * individual permissions.
 */
export const STAFF_MODULES = [
  {
    id: 'overview',
    label: 'Overview',
    permissions: [['overview.view', 'View the platform overview']],
  },
  {
    id: 'tenants',
    label: 'Organisations',
    permissions: [
      ['tenants.view', 'View organisations'],
      ['tenants.create', 'Create organisations'],
      ['tenants.edit', 'Edit profiles and contacts'],
      ['tenants.lifecycle', 'Suspend, reactivate and cancel'],
      ['tenants.security', 'Change the 2FA policy'],
      ['tenants.domains', 'Manage custom domains'],
    ],
  },
  {
    id: 'people',
    label: 'People',
    permissions: [
      ['members.view', 'View members and invitations'],
      ['members.manage', 'Invite people, change roles, suspend'],
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    permissions: [
      ['billing.view', 'View revenue, subscriptions and invoices'],
      ['billing.subscriptions', 'Create and change subscriptions'],
      ['billing.invoices', 'Issue and void invoices'],
      ['billing.payments', 'Record payments'],
    ],
  },
  {
    id: 'plans',
    label: 'Plans & pricing',
    permissions: [
      ['plans.view', 'View plans and prices'],
      ['plans.manage', 'Create and edit plans and prices'],
    ],
  },
  {
    id: 'support',
    label: 'Support',
    permissions: [
      ['support.view', 'View tickets'],
      ['support.reply', 'Reply and add internal notes'],
      ['support.triage', 'Change status, priority and assignee'],
      ['support.create', 'Open tickets for organisations'],
    ],
  },
  {
    id: 'logs',
    label: 'Logs',
    permissions: [
      ['logs.system', 'View the system log'],
      ['logs.email', 'View the email log'],
    ],
  },
  {
    id: 'settings',
    label: 'Platform settings',
    permissions: [['settings.manage', 'Change platform branding, languages and organisation defaults']],
  },
  {
    id: 'staff',
    label: 'Staff & roles',
    permissions: [
      ['staff.view', 'View staff and roles'],
      ['staff.manage', 'Invite staff, manage roles and permissions'],
    ],
  },
] as const;

export const STAFF_PERMISSIONS = STAFF_MODULES.flatMap((m) => m.permissions.map(([p]) => p));
export type StaffPermission = (typeof STAFF_MODULES)[number]['permissions'][number][0];
export const StaffPermission = z.enum(STAFF_PERMISSIONS as [StaffPermission, ...StaffPermission[]]);

export const SUPER_ADMIN_ROLE = 'super_admin';

export const StaffRoleDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  /** Super admin always holds every permission and can't be edited. */
  locked: z.boolean(),
  memberCount: z.number().int(),
});
export type StaffRoleDto = z.infer<typeof StaffRoleDto>;

export const StaffRoleInput = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  permissions: z.array(StaffPermission).min(1, 'Pick at least one permission'),
});
export type StaffRoleInput = z.input<typeof StaffRoleInput>;

export const StaffUserDto = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  name: z.string(),
  status: z.enum(['invited', 'active', 'suspended']),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
  extraPermissions: z.array(z.string()),
  /** Union of role and individual permissions. */
  effectivePermissions: z.array(z.string()),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
});
export type StaffUserDto = z.infer<typeof StaffUserDto>;

export const InviteStaffInput = z.object({
  email: z.email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  roleIds: z.array(z.string()).default([]),
  extraPermissions: z.array(StaffPermission).default([]),
});
export type InviteStaffInput = z.input<typeof InviteStaffInput>;

export const UpdateStaffInput = z.object({
  roleIds: z.array(z.string()).optional(),
  extraPermissions: z.array(StaffPermission).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
export type UpdateStaffInput = z.infer<typeof UpdateStaffInput>;

export const StaffListQuery = PageQuery.extend({ q: z.string().trim().max(100).optional() });
export type StaffListQuery = z.infer<typeof StaffListQuery>;

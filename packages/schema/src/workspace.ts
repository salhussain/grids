import { z } from 'zod';
import { PageQuery } from './common.js';

/**
 * Organisation workspace permissions (spec §3). Tenant-wide unless marked
 * `scopable`: those can be granted for an org-unit subtree, e.g. a regional
 * manager who manages people in their region only.
 */
export const WORKSPACE_MODULES = [
  {
    id: 'organisation',
    label: 'Workspace',
    permissions: [['org.view', 'Use the workspace', false]],
  },
  {
    id: 'people',
    label: 'People',
    permissions: [
      ['people.view', 'View people and their details', true],
      ['people.invite', 'Invite people', true],
      ['people.manage', 'Suspend people, change placement and roles', true],
    ],
  },
  {
    id: 'projects',
    label: 'Projects',
    permissions: [
      ['projects.create', 'Create projects', false],
      ['projects.manage', 'Manage every project (as a project manager)', false],
    ],
  },
  {
    id: 'structure',
    label: 'Structure',
    permissions: [['structure.manage', 'Create, rename, move and delete org units', false]],
  },
  {
    id: 'access',
    label: 'Roles & access',
    permissions: [
      ['roles.view', 'View roles and who holds them', false],
      ['roles.manage', 'Create roles and grant access', false],
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    permissions: [
      ['branding.manage', 'Change branding', false],
      ['security.manage', 'Change the 2FA policy', false],
      ['domains.manage', 'Manage custom domains', false],
      ['languages.manage', 'Choose languages and adjust wording', false],
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    permissions: [['billing.view', 'View the subscription, usage and invoices', false]],
  },
  {
    id: 'support',
    label: 'Support',
    permissions: [
      ['support.view', 'View the organisation’s tickets', false],
      ['support.create', 'Raise tickets and reply', false],
      ['support.manage', 'Handle internal tickets and escalate them to the platform', false],
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    permissions: [['audit.view', 'View the activity log', false]],
  },
] as const;

export type WorkspacePermission = (typeof WORKSPACE_MODULES)[number]['permissions'][number][0];
export const WORKSPACE_PERMISSIONS = WORKSPACE_MODULES.flatMap((m) =>
  m.permissions.map(([p]) => p),
) as WorkspacePermission[];
export const SCOPABLE_PERMISSIONS = WORKSPACE_MODULES.flatMap((m) =>
  m.permissions.filter(([, , s]) => s).map(([p]) => p),
) as WorkspacePermission[];
export const WorkspacePermission = z.enum(
  WORKSPACE_PERMISSIONS as [WorkspacePermission, ...WorkspacePermission[]],
);

/** Built-in workspace roles, seeded per organisation. */
export const SYSTEM_WORKSPACE_ROLES: {
  key: string;
  name: string;
  description: string;
  permissions: WorkspacePermission[];
}[] = [
  {
    key: 'org_admin',
    name: 'Organisation admin',
    description: 'Full control of the workspace.',
    permissions: WORKSPACE_PERMISSIONS,
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Manages people; grant it for an org unit to limit it to that part of the organisation.',
    permissions: [
      'org.view',
      'people.view',
      'people.invite',
      'people.manage',
      'roles.view',
      'support.view',
      'support.create',
    ],
  },
  {
    key: 'member',
    name: 'Member',
    description: 'Everyone in the organisation.',
    permissions: ['org.view', 'support.view', 'support.create'],
  },
];

// ---------------------------------------------------------------- theme

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'A hex colour like #0f62fe');
export const Theme = z.object({
  appName: z.string().trim().max(40).default(''),
  primaryColor: Hex.default('#0f62fe'),
  /** Logo as a data URL (PNG/SVG/JPEG/WebP, ≤ 200 KB) or an https URL. */
  logo: z
    .string()
    .max(280_000)
    .regex(
      /^(data:image\/(png|svg\+xml|jpeg|webp);base64,|https:\/\/)/,
      'PNG, SVG, JPEG or WebP image',
    )
    .nullable()
    .default(null),
  sidebar: z.enum(['dark', 'light', 'brand']).default('light'),
  welcomeMessage: z.string().trim().max(500).default(''),
  /** Basemap style URLs (MapLibre/Mapbox style JSON, e.g. MapTiler with a key); null = the defaults. */
  mapStyles: z
    .object({ light: z.url().max(500).nullable().default(null), dark: z.url().max(500).nullable().default(null) })
    .default({ light: null, dark: null }),
});
export type Theme = z.infer<typeof Theme>;
export const DEFAULT_THEME: Theme = Theme.parse({});

// ---------------------------------------------------------------- org units

export const OrgUnitDto = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  code: z.string().nullable(),
  levelLabel: z.string().nullable(),
  depth: z.number().int(),
  memberCount: z.number().int(),
  childCount: z.number().int(),
});
export type OrgUnitDto = z.infer<typeof OrgUnitDto>;

export const OrgUnitInput = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(40).optional(),
  /** e.g. "Region", "Department", "Team" */
  levelLabel: z.string().trim().max(40).optional(),
  parentId: z.uuid().nullable().optional(),
});
export type OrgUnitInput = z.input<typeof OrgUnitInput>;

// ---------------------------------------------------------------- roles & grants

export const WorkspaceRoleDto = z.object({
  id: z.string(),
  key: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  locked: z.boolean(),
  grantCount: z.number().int(),
});
export type WorkspaceRoleDto = z.infer<typeof WorkspaceRoleDto>;

export const WorkspaceRoleInput = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  permissions: z.array(WorkspacePermission).min(1, 'Pick at least one permission'),
});
export type WorkspaceRoleInput = z.input<typeof WorkspaceRoleInput>;

export const GrantDto = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.object({ id: z.string(), name: z.string() }),
  /** null = whole organisation */
  orgUnit: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(),
});
export type GrantDto = z.infer<typeof GrantDto>;

export const GrantInput = z.object({
  userId: z.uuid(),
  roleId: z.uuid(),
  orgUnitId: z.uuid().nullable().default(null),
});
export type GrantInput = z.input<typeof GrantInput>;

export const PlacementInput = z.object({ orgUnitId: z.uuid().nullable() });

// ---------------------------------------------------------------- workspace context

// ---------------------------------------------------------------- languages

const LocaleCode = z.string().regex(/^[a-z]{2,3}$/, 'A language code like en or tpi');

/** Organisation language settings (plain shape, used for responses). */
export const LocalizationDto = z.object({
  /** Interface languages people in the organisation can choose from. */
  languages: z.array(z.string()),
  /** Used when a person has not chosen a language, or chose one that isn't enabled. */
  defaultLanguage: z.string(),
  /** Wording overrides per language: { fr: { "nav.people": "Équipe" } }. */
  overrides: z.record(z.string(), z.record(z.string(), z.string())),
});
export type LocalizationDto = z.infer<typeof LocalizationDto>;

export const LocalizationInput = z
  .object({
    languages: z.array(LocaleCode).min(1).max(20),
    defaultLanguage: LocaleCode,
    overrides: z
      .record(LocaleCode, z.record(z.string().max(120), z.string().trim().max(500)))
      .default({}),
  })
  .refine((l) => l.languages.includes(l.defaultLanguage), {
    message: 'The default language must be one of the enabled languages',
    path: ['defaultLanguage'],
  });
export type LocalizationInput = z.infer<typeof LocalizationInput>;

export const DEFAULT_LOCALIZATION: LocalizationDto = {
  languages: ['en'],
  defaultLanguage: 'en',
  overrides: {},
};

/** What the sign-in page may show about an organisation before anyone signs in. */
export const PublicBranding = z.object({
  tenantId: z.string(),
  name: z.string(),
  appName: z.string(),
  primaryColor: z.string(),
  logo: z.string().nullable(),
  welcomeMessage: z.string(),
  languages: z.array(z.string()),
  defaultLanguage: z.string(),
  /** Wording overrides that apply before sign-in (auth.* and common.* keys), per language. */
  overrides: z.record(z.string(), z.record(z.string(), z.string())),
});
export type PublicBranding = z.infer<typeof PublicBranding>;

export const WorkspaceDto = z.object({
  tenant: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    planName: z.string().nullable(),
  }),
  theme: Theme,
  localization: LocalizationDto,
  features: z.array(z.string()),
  me: z.object({
    role: z.enum(['org_admin', 'member']),
    /** Tenant-wide permissions. */
    permissions: z.array(z.string()),
    /** Permissions held only within org-unit subtrees. */
    scoped: z.array(
      z.object({ permission: z.string(), orgUnitId: z.string(), orgUnitName: z.string() }),
    ),
  }),
});
export type WorkspaceDto = z.infer<typeof WorkspaceDto>;

export const ActivityQuery = PageQuery;

/** Organisation-wide activity for the home dashboard. */
export const OrgInsightsDto = z.object({
  /** Last 30 days, oldest first. */
  submissionsByDay: z.array(z.object({ day: z.string(), count: z.number().int() })),
  submissions30: z.number().int(),
  submissionsPrev30: z.number().int(),
  toReview: z.number().int(),
  entities: z.number().int(),
  observations30: z.number().int(),
  projects: z.object({ live: z.number().int(), draft: z.number().int(), stale: z.number().int() }),
  members: z.object({ active: z.number().int(), suspended: z.number().int(), invited: z.number().int() }),
  tickets: z.object({ internalOpen: z.number().int(), platformOpen: z.number().int() }),
});
export type OrgInsightsDto = z.infer<typeof OrgInsightsDto>;

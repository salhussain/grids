import { sql, type Kysely } from 'kysely';

// Platform console staff: roles bundle console permissions; staff members hold
// one or more roles plus optional individual permissions. Existing platform
// admins become Super admins.
const ALL = [
  'overview.view',
  'tenants.view',
  'tenants.create',
  'tenants.edit',
  'tenants.lifecycle',
  'tenants.security',
  'tenants.domains',
  'members.view',
  'members.manage',
  'billing.view',
  'billing.subscriptions',
  'billing.invoices',
  'billing.payments',
  'plans.view',
  'plans.manage',
  'support.view',
  'support.reply',
  'support.triage',
  'support.create',
  'logs.system',
  'logs.email',
  'staff.view',
  'staff.manage',
];
const VIEW = ALL.filter((p) => p.endsWith('.view') || p.startsWith('logs.'));

const SYSTEM_ROLES: [string, string, string, string[]][] = [
  ['super_admin', 'Super admin', 'Full access to everything, including staff and roles.', ALL],
  [
    'operations',
    'Operations',
    'Onboards and manages organisations, people and subscriptions.',
    [
      'overview.view',
      'tenants.view',
      'tenants.create',
      'tenants.edit',
      'tenants.lifecycle',
      'tenants.security',
      'tenants.domains',
      'members.view',
      'members.manage',
      'billing.view',
      'billing.subscriptions',
      'plans.view',
      'support.view',
      'logs.system',
      'logs.email',
    ],
  ],
  [
    'billing_manager',
    'Billing manager',
    'Pricing, subscriptions, invoices and payments.',
    [
      'overview.view',
      'tenants.view',
      'billing.view',
      'billing.subscriptions',
      'billing.invoices',
      'billing.payments',
      'plans.view',
      'plans.manage',
      'logs.email',
    ],
  ],
  [
    'support_agent',
    'Support agent',
    'Works the support queue and helps organisations with their people.',
    [
      'overview.view',
      'tenants.view',
      'members.view',
      'support.view',
      'support.reply',
      'support.triage',
      'support.create',
      'logs.email',
    ],
  ],
  ['auditor', 'Auditor', 'Read-only access to everything, including logs.', VIEW],
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('staff_role')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('permissions', sql`text[]`, (c) => c.notNull())
    .addColumn('is_system', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('staff_member')
    .addColumn('user_id', 'uuid', (c) =>
      c.primaryKey().references('user_identity.id').onDelete('cascade'),
    )
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('active')
        .check(sql`status in ('active', 'suspended')`),
    )
    .addColumn('extra_permissions', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('invited_by', 'uuid', (c) => c.references('user_identity.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('staff_member_role')
    .addColumn('user_id', 'uuid', (c) =>
      c.notNull().references('staff_member.user_id').onDelete('cascade'),
    )
    .addColumn('role_id', 'text', (c) =>
      c.notNull().references('staff_role.id').onDelete('cascade'),
    )
    .addPrimaryKeyConstraint('staff_member_role_pk', ['user_id', 'role_id'])
    .execute();

  for (const [id, name, description, permissions] of SYSTEM_ROLES) {
    await sql`insert into staff_role (id, name, description, permissions, is_system)
              values (${id}, ${name}, ${description}, ${permissions}::text[], true)`.execute(db);
  }
  await sql`insert into staff_member (user_id) select id from user_identity where is_platform_admin`.execute(
    db,
  );
  await sql`insert into staff_member_role (user_id, role_id) select user_id, 'super_admin' from staff_member`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['staff_member_role', 'staff_member', 'staff_role'])
    await db.schema.dropTable(t).execute();
}

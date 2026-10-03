import { sql, type Kysely } from 'kysely';

// Platform console v2: organisation profile & contacts, pricing, subscriptions &
// invoices, member details/status, MFA policy, custom domains, support tickets,
// email log. Lifecycle becomes: created → subscribed (pending payment / trial) →
// provisioned → active; administrators are invited only after that.
export async function up(db: Kysely<unknown>): Promise<void> {
  // ----- organisation profile -----
  await sql`alter table tenant drop constraint tenant_status_check`.execute(db);
  await sql`
    alter table tenant
      add constraint tenant_status_check
        check (status in ('pending_payment', 'provisioning', 'active', 'suspended', 'cancelled')),
      add column legal_name text,
      add column industry text,
      add column company_size text,
      add column website text,
      add column registration_number text,
      add column tax_id text,
      add column email text,
      add column phone text,
      add column address_line1 text,
      add column address_line2 text,
      add column city text,
      add column region text,
      add column postal_code text,
      add column country char(2),
      add column timezone text not null default 'UTC',
      add column locale text not null default 'en',
      add column currency char(3) not null default 'USD',
      add column notes text,
      add column mfa_required boolean not null default false
  `.execute(db);

  await db.schema
    .createTable('tenant_contact')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) =>
      c.notNull().check(sql`kind in ('primary', 'billing', 'technical')`),
    )
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('email', sql`citext`, (c) => c.notNull())
    .addColumn('phone', 'text')
    .addColumn('job_title', 'text')
    .addUniqueConstraint('tenant_contact_kind_uq', ['tenant_id', 'kind'])
    .execute();

  // ----- pricing -----
  await sql`
    alter table plan
      add column description text not null default '',
      add column currency char(3) not null default 'USD',
      add column price_monthly integer not null default 0 check (price_monthly >= 0),
      add column yearly_discount_pct numeric(5,2) not null default 0
        check (yearly_discount_pct >= 0 and yearly_discount_pct <= 100),
      add column trial_days integer not null default 0 check (trial_days >= 0),
      add column is_public boolean not null default true,
      add column is_archived boolean not null default false,
      add column updated_at timestamptz not null default now()
  `.execute(db);
  await sql`
    update plan set
      price_monthly = case id when 'free' then 0 when 'team' then 9900 when 'business' then 49900 else 199900 end,
      yearly_discount_pct = case id when 'free' then 0 else 15 end,
      trial_days = case id when 'free' then 0 when 'enterprise' then 30 else 14 end,
      description = case id
        when 'free' then 'Try the platform with a single project.'
        when 'team' then 'For teams running a few projects with custom branding.'
        when 'business' then 'SSO, custom domains and DHIS2 interoperability.'
        else 'Unlimited scale, dedicated database and custom code.' end
  `.execute(db);

  // ----- subscriptions & invoices (amounts in minor units, e.g. cents) -----
  await db.schema
    .createTable('subscription')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    .addColumn('plan_id', 'text', (c) => c.notNull().references('plan.id'))
    .addColumn('interval', 'text', (c) => c.notNull().check(sql`interval in ('monthly', 'yearly')`))
    // Price snapshot: later plan price changes don't alter existing subscriptions.
    .addColumn('unit_price', 'integer', (c) => c.notNull())
    .addColumn('discount_pct', sql`numeric(5,2)`, (c) => c.notNull().defaultTo(0))
    .addColumn('currency', sql`char(3)`, (c) => c.notNull())
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .check(sql`status in ('pending_payment', 'trialing', 'active', 'past_due', 'cancelled')`),
    )
    .addColumn('trial_ends_at', 'timestamptz')
    .addColumn('current_period_start', 'timestamptz')
    .addColumn('current_period_end', 'timestamptz')
    .addColumn('cancel_at_period_end', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('cancelled_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index subscription_current_uq on subscription (tenant_id) where status <> 'cancelled'`.execute(
    db,
  );

  await sql`create sequence invoice_number_seq`.execute(db);
  await db.schema
    .createTable('invoice')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('number', 'text', (c) => c.notNull().unique())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    .addColumn('subscription_id', 'uuid', (c) => c.references('subscription.id'))
    .addColumn('status', 'text', (c) => c.notNull().check(sql`status in ('open', 'paid', 'void')`))
    .addColumn('currency', sql`char(3)`, (c) => c.notNull())
    .addColumn('subtotal', 'integer', (c) => c.notNull())
    .addColumn('discount', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('total', 'integer', (c) => c.notNull())
    .addColumn('lines', 'jsonb', (c) => c.notNull())
    .addColumn('period_start', 'timestamptz')
    .addColumn('period_end', 'timestamptz')
    .addColumn('issued_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('due_at', 'timestamptz', (c) => c.notNull())
    .addColumn('paid_at', 'timestamptz')
    .addColumn('payment_method', 'text')
    .addColumn('payment_reference', 'text')
    .addColumn('voided_at', 'timestamptz')
    .execute();
  await sql`create index invoice_tenant_idx on invoice (tenant_id, issued_at desc)`.execute(db);

  // ----- members & invitations: person details, per-tenant status -----
  await sql`
    alter table user_identity
      add column given_name text,
      add column family_name text,
      add column phone text
  `.execute(db);
  await sql`
    alter table membership
      add column status text not null default 'active' check (status in ('active', 'suspended')),
      add column job_title text,
      add column department text,
      add column phone text,
      add column status_changed_at timestamptz
  `.execute(db);
  await sql`
    alter table invitation
      add column first_name text,
      add column last_name text,
      add column job_title text,
      add column department text,
      add column phone text,
      add column message text,
      add column revoked_at timestamptz
  `.execute(db);

  // ----- custom domains -----
  await db.schema
    .createTable('tenant_domain')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    .addColumn('hostname', 'text', (c) => c.notNull().unique())
    .addColumn('status', 'text', (c) =>
      c.notNull().check(sql`status in ('pending', 'verified', 'failed')`),
    )
    .addColumn('verification_token', 'text', (c) => c.notNull())
    .addColumn('is_primary', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('last_checked_at', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('verified_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index tenant_domain_primary_uq on tenant_domain (tenant_id) where is_primary`.execute(
    db,
  );

  // ----- support -----
  await sql`create sequence ticket_number_seq start 1001`.execute(db);
  await db.schema
    .createTable('support_ticket')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('number', 'integer', (c) => c.notNull().unique())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    .addColumn('subject', 'text', (c) => c.notNull())
    .addColumn('category', 'text', (c) =>
      c
        .notNull()
        .check(
          sql`category in ('question', 'bug', 'billing', 'feature_request', 'account', 'other')`,
        ),
    )
    .addColumn('priority', 'text', (c) =>
      c.notNull().check(sql`priority in ('low', 'normal', 'high', 'urgent')`),
    )
    .addColumn('status', 'text', (c) =>
      c.notNull().check(sql`status in ('open', 'pending', 'resolved', 'closed')`),
    )
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('user_identity.id'))
    .addColumn('assignee_id', 'uuid', (c) => c.references('user_identity.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('resolved_at', 'timestamptz')
    .execute();
  await sql`create index support_ticket_queue_idx on support_ticket (status, updated_at desc)`.execute(
    db,
  );

  await db.schema
    .createTable('support_message')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('ticket_id', 'uuid', (c) =>
      c.notNull().references('support_ticket.id').onDelete('cascade'),
    )
    .addColumn('author_id', 'uuid', (c) => c.notNull().references('user_identity.id'))
    .addColumn('body', 'text', (c) => c.notNull())
    // Internal notes are visible to platform staff only.
    .addColumn('internal', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // ----- email log -----
  await db.schema
    .createTable('email_log')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.references('tenant.id').onDelete('set null'))
    .addColumn('template', 'text', (c) => c.notNull())
    .addColumn('to_address', 'text', (c) => c.notNull())
    .addColumn('subject', 'text', (c) => c.notNull())
    .addColumn('body_text', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().check(sql`status in ('sent', 'failed')`))
    .addColumn('error', 'text')
    .addColumn('provider_message_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index email_log_created_idx on email_log (created_at desc)`.execute(db);
  await sql`create index platform_audit_log_at_idx on platform_audit_log (at desc)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    'email_log',
    'support_message',
    'support_ticket',
    'tenant_domain',
    'invoice',
    'subscription',
    'tenant_contact',
  ]) {
    await db.schema.dropTable(t).execute();
  }
  await sql`drop sequence ticket_number_seq; drop sequence invoice_number_seq`.execute(db);
}

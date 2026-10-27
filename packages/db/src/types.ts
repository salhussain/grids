import type { ColumnType, Generated, GeneratedAlways, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T> = ColumnType<T, string | T, string | T>;
/** JSON column with a database default (optional on insert). */
type JsonDefault<T> = ColumnType<T, string | T | undefined, string | T>;

/** Plan limit keys; `null` means unlimited (spec §12). */
export interface PlanLimits {
  projects: number | null;
  users: number | null;
  forms: number | null;
  submissions_per_month: number | null;
  storage_gb: number | null;
  api_calls_per_month: number | null;
  rows_ingested_per_month: number | null;
  run_minutes_per_month: number | null;
}

// ---------- control plane ----------
type Text = string | null;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type Numeric = ColumnType<string, number | string | undefined, number | string>;

export type TenantStatus =
  'pending_payment' | 'provisioning' | 'active' | 'suspended' | 'cancelled';
export type SubscriptionStatus =
  'pending_payment' | 'trialing' | 'active' | 'past_due' | 'cancelled';
export type BillingInterval = 'monthly' | 'yearly';

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface PlatformDB {
  cell: {
    id: string;
    kind: 'shared' | 'dedicated';
    connection_secret_ref: string;
    accepting_tenants: Generated<boolean>;
    created_at: Timestamp;
  };
  plan: {
    id: string;
    name: string;
    sort_order: Generated<number>;
    limits: Json<PlanLimits>;
    features: JsonDefault<string[]>;
    description: Generated<string>;
    currency: Generated<string>;
    price_monthly: Generated<number>;
    yearly_discount_pct: Numeric;
    trial_days: Generated<number>;
    /** What Grids charges on each payment an organisation takes: `{ percent, fixed }` (null: nothing). */
    payment_fee: JsonDefault<{ percent: number; fixed: number } | null>;
    is_public: Generated<boolean>;
    is_archived: Generated<boolean>;
    updated_at: Timestamp;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: ColumnType<TenantStatus, TenantStatus | undefined, TenantStatus>;
    plan_id: string | null;
    cell_id: string;
    idp_org_id: string | null;
    legal_name: Text;
    industry: Text;
    company_size: Text;
    website: Text;
    registration_number: Text;
    tax_id: Text;
    email: Text;
    phone: Text;
    address_line1: Text;
    address_line2: Text;
    city: Text;
    region: Text;
    postal_code: Text;
    country: Text;
    timezone: Generated<string>;
    locale: Generated<string>;
    currency: Generated<string>;
    notes: Text;
    mfa_required: Generated<boolean>;
    session_policy: JsonDefault<Record<string, unknown> | null>;
    access_blocked: Generated<boolean>;
    billing_address: JsonDefault<Record<string, string | null> | null>;
    created_at: Timestamp;
    updated_at: Timestamp;
  };
  tenant_contact: {
    id: string;
    tenant_id: string;
    kind: 'primary' | 'billing' | 'technical';
    name: string;
    email: string;
    phone: Text;
    job_title: Text;
  };
  tenant_receipt_counter: { tenant_id: string; last: Generated<string | number> };
  payment: {
    id: string;
    tenant_id: string;
    provider: string;
    provider_ref: string | null;
    method: string | null;
    surcharge: Generated<string | number>;
    receipt_no: string | number | null;
    project_key: string;
    form_key: string;
    amount: string | number;
    currency: string;
    description: Generated<string>;
    payer_email: string | null;
    status: Generated<'pending' | 'succeeded' | 'failed' | 'cancelled'>;
    meta: JsonDefault<Record<string, unknown>>;
    fee_amount: Generated<string | number>;
    fee_invoice_id: string | null;
    submission_id: string | null;
    created_at: CreatedAt;
    paid_at: Date | null;
  };
  usage_counter: { tenant_id: string; month: Date | string; key: string; n: string | number };
  subscription: {
    id: string;
    tenant_id: string;
    plan_id: string;
    interval: BillingInterval;
    unit_price: number;
    discount_pct: Numeric;
    extra_discount_pct: Numeric;
    currency: string;
    status: SubscriptionStatus;
    trial_ends_at: Date | null;
    current_period_start: Date | null;
    current_period_end: Date | null;
    cancel_at_period_end: Generated<boolean>;
    cancelled_at: Date | null;
    created_at: CreatedAt;
  };
  invoice: {
    id: string;
    number: string;
    tenant_id: string;
    subscription_id: string | null;
    status: 'open' | 'paid' | 'void';
    currency: string;
    subtotal: number;
    discount: Generated<number>;
    total: number;
    lines: Json<InvoiceLine[]>;
    period_start: Date | null;
    period_end: Date | null;
    issued_at: CreatedAt;
    due_at: Date;
    paid_at: Date | null;
    payment_method: Text;
    payment_reference: Text;
    voided_at: Date | null;
  };
  user_identity: {
    id: string;
    idp_subject: string;
    email: string | null;
    display_name: string | null;
    given_name: Text;
    family_name: Text;
    phone: Text;
    is_platform_admin: Generated<boolean>;
    created_at: Timestamp;
    last_seen_at: Date | null;
    preferences: JsonDefault<Record<string, unknown>>;
  };
  membership: {
    tenant_id: string;
    user_id: string;
    role: 'org_admin' | 'member';
    status: Generated<'active' | 'suspended'>;
    job_title: Text;
    department: Text;
    phone: Text;
    status_changed_at: Date | null;
    created_at: Timestamp;
  };
  invitation: {
    id: string;
    tenant_id: string;
    email: string;
    role: 'org_admin' | 'member';
    token_hash: string;
    invited_by: string | null;
    first_name: Text;
    last_name: Text;
    job_title: Text;
    department: Text;
    phone: Text;
    message: Text;
    org_unit_id: string | null;
    expires_at: Timestamp;
    accepted_at: Date | null;
    accepted_by: string | null;
    revoked_at: Date | null;
    created_at: Timestamp;
  };
  tenant_domain: {
    id: string;
    tenant_id: string;
    hostname: string;
    status: 'pending' | 'verified' | 'failed';
    verification_token: string;
    is_primary: Generated<boolean>;
    last_checked_at: Date | null;
    last_error: Text;
    verified_at: Date | null;
    created_at: CreatedAt;
  };
  support_ticket: {
    id: string;
    number: number;
    tenant_id: string;
    subject: string;
    category: 'question' | 'bug' | 'billing' | 'feature_request' | 'account' | 'other';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    status: 'open' | 'pending' | 'resolved' | 'closed';
    created_by: string | null;
    assignee_id: string | null;
    created_at: CreatedAt;
    updated_at: Timestamp;
    resolved_at: Date | null;
    audience: Generated<'organisation' | 'platform'>;
    escalated_at: Date | null;
    /** Someone with no account is known by what they typed. */
    requester_name: string | null;
    requester_email: string | null;
    requester_phone: string | null;
    /** member: raised in the workspace · help: asked from a project's page or the portal. */
    channel: Generated<'member' | 'help'>;
    /** The project whose page it came from. */
    source_project: string | null;
    /** One of the organisation's own stages. */
    stage: string | null;
    /** Keys of the organisation's own labels. */
    labels: Generated<string[]>;
  };
  support_favorite: {
    user_id: string;
    ticket_id: string;
    created_at: Generated<Date>;
  };
  support_email_code: {
    id: string;
    tenant_id: string;
    email: string;
    code_hash: string;
    expires_at: Date;
    attempts: Generated<number>;
    used_at: Date | null;
    created_at: Generated<Date>;
  };
  support_ticket_link: {
    id: string;
    tenant_id: string;
    kind: 'parent' | 'blocks' | 'related';
    source_id: string;
    target_id: string;
    created_by: string | null;
    created_at: Generated<Date>;
  };
  support_file: {
    id: string;
    tenant_id: string;
    ticket_id: string | null;
    name: string;
    content_type: string;
    size: number;
    content: Buffer;
    created_at: Generated<Date>;
  };
  support_desk: {
    tenant_id: string;
    config: JsonDefault<Record<string, unknown>>;
    updated_at: Generated<Date>;
  };
  platform_setting: {
    key: string;
    value: Json<Record<string, unknown>>;
    updated_at: Timestamp;
  };
  support_message: {
    id: string;
    ticket_id: string;
    author_id: string | null;
    body: string;
    internal: Generated<boolean>;
    /** requester | staff | platform | system */
    author_kind: string | null;
    author_name: string | null;
    attachments: JsonDefault<unknown[]>;
    /** An answer in a thread under another message. */
    parent_id: string | null;
    edited_at: Date | null;
    /** Every earlier wording, oldest first. */
    edits: JsonDefault<unknown[]>;
    resolved_at: Date | null;
    resolved_by: string | null;
    created_at: CreatedAt;
  };
  email_log: {
    id: string;
    tenant_id: string | null;
    template: string;
    to_address: string;
    subject: string;
    body_text: string;
    status: 'sent' | 'failed';
    error: Text;
    provider_message_id: Text;
    created_at: CreatedAt;
  };
  staff_role: {
    id: string;
    name: string;
    description: Generated<string>;
    permissions: string[];
    is_system: Generated<boolean>;
    created_at: CreatedAt;
    updated_at: Timestamp;
  };
  staff_member: {
    user_id: string;
    status: Generated<'active' | 'suspended'>;
    extra_permissions: ColumnType<string[], string[] | undefined, string[]>;
    invited_by: string | null;
    created_at: CreatedAt;
  };
  staff_member_role: {
    user_id: string;
    role_id: string;
  };
  platform_audit_log: {
    id: Generated<string>;
    at: Timestamp;
    actor_id: string | null;
    tenant_id: string | null;
    action: string;
    details: JsonDefault<Record<string, unknown>>;
    project_key: string | null;
    category: Generated<string>;
    ip: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    user_agent: string | null;
  };
}

export type Tenant = Selectable<PlatformDB['tenant']>;
export type NewTenant = Insertable<PlatformDB['tenant']>;
export type TenantUpdate = Updateable<PlatformDB['tenant']>;
export type Plan = Selectable<PlatformDB['plan']>;
export type UserIdentity = Selectable<PlatformDB['user_identity']>;
export type Invitation = Selectable<PlatformDB['invitation']>;

// ---------- tenant data cell ----------
export interface CellDB {
  org_unit: {
    id: string;
    tenant_id: string;
    parent_id: string | null;
    name: string;
    code: string | null;
    level_label: string | null;
    path: string;
    created_at: CreatedAt;
  };
  workspace_role: {
    id: string;
    tenant_id: string;
    key: string | null;
    name: string;
    description: Generated<string>;
    permissions: string[];
    is_system: Generated<boolean>;
    created_at: CreatedAt;
    updated_at: Timestamp;
  };
  role_grant: {
    id: string;
    tenant_id: string;
    user_id: string;
    role_id: string;
    org_unit_id: string | null;
    created_by: string | null;
    created_at: CreatedAt;
  };
  member_placement: {
    tenant_id: string;
    user_id: string;
    org_unit_id: string;
  };
  tenant_profile: {
    tenant_id: string;
    name: string;
    theme: JsonDefault<Record<string, unknown>>;
    localization: JsonDefault<Record<string, unknown>>;
    /** The plan's allowances, copied from the platform for the worker. */
    limits: JsonDefault<Record<string, number | null> | null>;
    created_at: Timestamp;
  };

  // ---------- projects & canonical model (M3) ----------
  project: {
    id: string;
    tenant_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    visibility: Generated<'private' | 'organisation' | 'public'>;
    template: string | null;
    color: Generated<string>;
    icon: Generated<string>;
    settings: JsonDefault<Record<string, unknown>>;
    created_by: string | null;
    created_at: CreatedAt;
    updated_at: Timestamp;
    archived_at: Date | null;
    status: Generated<'draft' | 'live'>;
    logo: string | null;
    cover_image: string | null;
  };
  project_member: {
    project_id: string;
    tenant_id: string;
    user_id: string;
    role: 'manager' | 'viewer';
    /** Entities the member is limited to (each with its subtree); empty = the whole project. */
    root_entity_ids: Generated<string[]>;
    /** Permissions (ids) the member holds. */
    permission_groups: Generated<string[]>;
    created_at: CreatedAt;
  };
  entity_type: {
    id: string;
    tenant_id: string;
    /** null = the shared row of an organisation type. */
    project_id: string | null;
    key: string;
    name: string;
    plural: string;
    icon: Generated<string>;
    color: Generated<string>;
    geometry: Generated<'none' | 'point' | 'polygon' | 'line'>;
    /** How places of this type are drawn on maps: { style, rotateBy }. */
    marker: JsonDefault<{ style: 'dot' | 'pin' | 'icon'; rotateBy: string | null }>;
    attributes: JsonDefault<unknown[]>;
    parent_types: ColumnType<string[], string[] | undefined, string[]>;
    /** The hidden type of a project's own entity (`this_project`): not listed, not editable. */
    system: Generated<boolean>;
    sort: Generated<number>;
    /** Set for a type defined by the organisation: linked to it and edited there. */
    org_type_id: string | null;
    /** Most entities of this type one project may hold; null = no limit. */
    max_per_project: number | null;
    created_at: CreatedAt;
  };
  /** An entity type defined for the whole organisation; every project holds a linked copy. */
  org_entity_type: {
    id: string;
    tenant_id: string;
    key: string;
    name: string;
    plural: string;
    icon: Generated<string>;
    color: Generated<string>;
    geometry: Generated<'none' | 'point' | 'polygon' | 'line'>;
    marker: JsonDefault<{ style: 'dot' | 'pin' | 'icon'; rotateBy: string | null }>;
    attributes: JsonDefault<unknown[]>;
    parent_types: ColumnType<string[], string[] | undefined, string[]>;
    max_per_project: number | null;
    sort: Generated<number>;
    created_at: CreatedAt;
  };
  entity: {
    id: string;
    tenant_id: string;
    /** null = a shared entity: it belongs to the organisation and shows in every project. */
    project_id: string | null;
    type_id: string;
    code: string;
    name: string;
    parent_id: string | null;
    path: string;
    attributes: JsonDefault<Record<string, unknown>>;
    /** PostGIS; read with ST_AsGeoJSON, write with ST_GeomFromGeoJSON. */
    geom: unknown;
    /** Optional centre point (PostGIS Point), e.g. where to pin an area on a map. */
    point: unknown;
    version: Generated<number>;
    created_at: CreatedAt;
    updated_at: Timestamp;
  };
  entity_change: {
    id: Generated<string>;
    tenant_id: string;
    entity_id: string;
    changes: Json<Record<string, unknown>>;
    source: string;
    source_ref: string | null;
    actor_id: string | null;
    at: Timestamp;
  };
  data_element: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    value_type: Generated<'number' | 'text' | 'boolean'>;
    unit: Generated<string>;
    aggregation: Generated<'sum' | 'avg' | 'min' | 'max' | 'last' | 'count'>;
    /** The data group it is in (`general` unless chosen). */
    group_key: Generated<string>;
    /** How things refer to it: its key, with the group in front unless it is in `general`. Made by the database. */
    ref: GeneratedAlways<string>;
    created_at: CreatedAt;
  };
  observation: {
    tenant_id: string;
    project_id: string;
    entity_id: string;
    element_id: string;
    at: Timestamp;
    value_num: number | null;
    value_text: string | null;
    source: Generated<string>;
    source_ref: string | null;
    recorded_at: Timestamp;
  };

  project_variable: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    description: Generated<string>;
    value_enc: string;
    updated_by: string | null;
    created_at: CreatedAt;
    updated_at: Generated<Date>;
  };
  project_connection: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    kind: 'http' | 'postgres' | 'redshift' | 'mysql' | 'mariadb' | 'mssql' | 'oracle' | 'clickhouse' | 'snowflake' | 'bigquery' | 'file' | 's3' | 'azure_blob' | 'gcs' | 'gdrive';
    target: string;
    headers: JsonDefault<{ name: string; value: string }[]>;
    options: JsonDefault<Record<string, string>>;
    test: Generated<string>;
    last_test: Json<Record<string, unknown> | null>;
    created_at: CreatedAt;
    updated_at: Generated<Date>;
  };

  // ---------- orchestration (M4) ----------
  job: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    steps: JsonDefault<unknown[]>;
    schedule: string | null;
    timezone: Generated<string>;
    enabled: Generated<boolean>;
    max_retries: Generated<number>;
    timeout_seconds: Generated<number>;
    freshness_minutes: number | null;
    run_on_upload: Generated<boolean>;
    triggers: JsonDefault<Record<string, unknown>>;
    sensor: Json<Record<string, unknown> | null>;
    webhook_token: string | null;
    created_at: CreatedAt;
    updated_at: Timestamp;
  };
  run: {
    id: string;
    tenant_id: string;
    project_id: string;
    job_id: string;
    status: Generated<'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'>;
    trigger: string;
    triggered_by: string | null;
    attempt: Generated<number>;
    queued_at: Timestamp;
    started_at: Date | null;
    finished_at: Date | null;
    error: string | null;
    stats: JsonDefault<Record<string, number>>;
    worker: string | null;
    context: JsonDefault<Record<string, unknown>>;
  };
  run_log: {
    id: Generated<string>;
    tenant_id: string;
    run_id: string;
    at: Timestamp;
    level: 'info' | 'warn' | 'error';
    step: string | null;
    message: string;
  };
  job_queue: {
    run_id: string;
    tenant_id: string;
    available_at: Timestamp;
    locked_by: string | null;
    locked_until: Date | null;
  };
  job_sensor: {
    job_id: string;
    tenant_id: string;
    every_minutes: number;
    next_check_at: Timestamp;
    last_checked_at: Date | null;
    cursor: string | null;
    last_error: string | null;
  };
  job_schedule: {
    job_id: string;
    tenant_id: string;
    cron: string;
    timezone: Generated<string>;
    next_run_at: Date;
  };
  dataset: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    columns: JsonDefault<unknown[]>;
    row_count: Generated<number>;
    last_materialised_at: Date | null;
    last_run_id: string | null;
    freshness_minutes: number | null;
    /** DatasetSource: rows (job or upload), a database connection, or local SQL. */
    source: JsonDefault<Record<string, unknown>>;
    column_types: JsonDefault<Record<string, string>>;
    /** DatasetSettings: time column, metrics, parameters. */
    settings: JsonDefault<Record<string, unknown>>;
    refresh_error: string | null;
    created_at: CreatedAt;
  };
  dataset_version: {
    dataset_id: string;
    tenant_id: string;
    version: number;
    /** name, description, freshnessMinutes, source and settings as saved. */
    definition: Json<Record<string, unknown>>;
    saved_by: string | null;
    saved_at: CreatedAt;
  };
  /** A dataset run again for the values a viewer picked. */
  dataset_variant: {
    id: string;
    tenant_id: string;
    dataset_id: string;
    key: string;
    params: JsonDefault<Record<string, unknown>>;
    row_count: Generated<number>;
    refreshed_at: Generated<Date>;
    last_used_at: Generated<Date>;
  };
  dataset_variant_row: {
    id: Generated<string>;
    tenant_id: string;
    variant_id: string;
    data: Json<Record<string, unknown>>;
  };
  dataset_row: {
    id: Generated<string>;
    tenant_id: string;
    dataset_id: string;
    data: Json<Record<string, unknown>>;
  };
  permission_group: {
    id: string;
    tenant_id: string;
    project_id: string;
    name: string;
    description: Generated<string>;
    parent_id: string | null;
    /** A built-in permission: can't be deleted or moved. */
    system: Generated<boolean>;
    /** Which built-in one: the project admin or the public permission. */
    kind: 'admin' | 'public' | null;
    created_at: CreatedAt;
  };
  map_overlay: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    config: Json<Record<string, unknown>>;
    is_public: Generated<boolean>;
    sort: Generated<number>;
    created_at: CreatedAt;
    updated_at: Timestamp;
    group_id: string | null;
  };
  map_overlay_group: {
    id: string;
    tenant_id: string;
    project_id: string;
    parent_id: string | null;
    name: string;
    sort: Generated<number>;
    created_at: CreatedAt;
  };
  project_file: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    content_type: string;
    size: number;
    sha256: string;
    content: Buffer;
    uploaded_by: string | null;
    uploaded_at: Generated<Date>;
  };

  form_attachment: {
    id: string;
    tenant_id: string;
    project_id: string;
    form_key: string;
    name: string;
    content_type: string;
    size: number;
    content: Buffer;
    uploaded_by: string | null;
    uploaded_at: Generated<Date>;
  };

  work_type: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    icon: Generated<string>;
    color: Generated<string>;
    prefix: Generated<string>;
    states: Json<{ key: string; label: string; kind: 'open' | 'active' | 'done' }[]>;
    sla: JsonDefault<{ respondHours?: Partial<Record<string, number>>; resolveHours?: Partial<Record<string, number>> }>;
    next_number: Generated<number>;
    created_at: Generated<Date>;
  };
  work_item: {
    id: string;
    tenant_id: string;
    project_id: string;
    type_id: string;
    number: number;
    title: string;
    description: Generated<string>;
    state: string;
    priority: Generated<'low' | 'normal' | 'high' | 'urgent'>;
    assignee_id: string | null;
    requester_id: string | null;
    requester_name: string | null;
    entity_id: string | null;
    submission_id: string | null;
    due_at: Date | null;
    respond_by: Date | null;
    resolve_by: Date | null;
    first_response_at: Date | null;
    resolved_at: Date | null;
    source: Generated<string>;
    created_by: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  work_event: {
    id: string;
    tenant_id: string;
    item_id: string;
    actor_id: string | null;
    kind: string;
    body: Generated<string>;
    internal: Generated<boolean>;
    data: JsonDefault<Record<string, unknown>>;
    created_at: Generated<Date>;
  };

  work_schedule: {
    id: string;
    tenant_id: string;
    project_id: string;
    type_id: string;
    key: string;
    name: string;
    title: string;
    description: Generated<string>;
    priority: Generated<'low' | 'normal' | 'high' | 'urgent'>;
    assignee_id: string | null;
    entity_id: string | null;
    entity_type: string | null;
    every_days: number | null;
    meter_attribute: string | null;
    meter_every: number | null;
    lead_days: Generated<number>;
    active: Generated<boolean>;
    created_at: Generated<Date>;
  };
  work_schedule_target: {
    schedule_id: string;
    entity_id: string;
    tenant_id: string;
    next_due_at: Date | null;
    last_meter: number | null;
    item_id: string | null;
  };

  form_link: {
    id: string;
    tenant_id: string;
    project_id: string;
    form_id: string;
    kind: 'shared' | 'invite';
    token: string;
    label: Generated<string>;
    email: string | null;
    entity_id: string | null;
    max_uses: number | null;
    uses: Generated<number>;
    opens_at: string | null;
    closes_at: string | null;
    /** The language it opens the form in; null: the person's own choice. */
    language: string | null;
    revoked_at: Date | null;
    created_by: string | null;
    created_at: Generated<Date>;
    last_used_at: Date | null;
  };

  form_email_code: {
    id: string;
    tenant_id: string;
    form_id: string;
    email: string;
    code_hash: string;
    attempts: Generated<number>;
    expires_at: Date;
    used_at: Date | null;
    created_at: Generated<Date>;
  };

  data_group: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    created_at: Generated<Date>;
  };

  form_document_revision: {
    id: Generated<string>;
    tenant_id: string;
    form_id: string;
    document_id: string;
    action: string;
    snapshot: unknown;
    actor_id: string | null;
    created_at: Generated<Date>;
  };

  // ---------- dashboards (M5) & forms (M6) ----------
  dashboard: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    widgets: JsonDefault<unknown[]>;
    is_public: Generated<boolean>;
    filters: JsonDefault<Record<string, unknown>>;
    permission_group: string | null;
    icon: Generated<string>;
    sort: Generated<number>;
    created_at: CreatedAt;
    updated_at: Timestamp;
  };
  form: {
    id: string;
    tenant_id: string;
    project_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    subject_type_id: string | null;
    draft: Json<Record<string, unknown>>;
    current_version: number | null;
    group_id: string | null;
    settings: JsonDefault<Record<string, unknown>>;
    created_at: CreatedAt;
    updated_at: Timestamp;
    archived_at: Date | null;
  };
  form_group: {
    id: string;
    tenant_id: string;
    project_id: string | null;
    parent_id: string | null;
    name: string;
    icon: Generated<string>;
    sort: Generated<number>;
    created_at: CreatedAt;
  };
  form_version: {
    form_id: string;
    tenant_id: string;
    version: number;
    definition: Json<Record<string, unknown>>;
    published_at: Timestamp;
    published_by: string | null;
  };
  submission: {
    id: string;
    tenant_id: string;
    project_id: string;
    form_id: string;
    form_version: number;
    entity_id: string | null;
    answers: Json<Record<string, unknown>>;
    submitted_by: string | null;
    collected_at: Timestamp;
    submitted_at: Timestamp;
    location: unknown;
    status: Generated<'complete' | 'in_review' | 'approved' | 'rejected' | 'returned'>;
    stage: number | null;
    /** Workflow node the submission is parked on (null: derive from `stage`, or no workflow). */
    node_id: string | null;
    /** The end node a finished submission reached; its name is the outcome shown. */
    outcome_node: string | null;
    decided_at: Date | null;
    /** The link the person came in through, when they had no account. */
    link_id: string | null;
    /** The name or email they typed, for a submission that came in through a link. */
    submitter: string | null;
  };
  submission_review: {
    id: Generated<string>;
    tenant_id: string;
    submission_id: string;
    stage: number | null;
    stage_name: string | null;
    node_id: string | null;
    decision: 'submitted' | 'resubmitted' | 'approved' | 'rejected' | 'returned' | 'timed_out';
    comment: Generated<string>;
    actor_id: string | null;
    at: Timestamp;
  };
  /** Outbox and timers of the form workflow engine (email, webhook, SLA/wait timers). */
  workflow_task: {
    id: string;
    tenant_id: string;
    project_id: string;
    submission_id: string;
    node_id: string;
    kind: 'email' | 'webhook' | 'timer';
    status: Generated<'pending' | 'done' | 'failed' | 'cancelled'>;
    due_at: Timestamp;
    locked_until: Date | null;
    attempts: Generated<number>;
    last_error: string | null;
    payload: JsonDefault<Record<string, unknown>>;
    created_at: CreatedAt;
    done_at: Date | null;
  };
}

// ---------- identity provider ----------
export interface IdentityDB {
  account: {
    id: string;
    email: string;
    email_verified: Generated<boolean>;
    password_hash: string | null;
    given_name: string | null;
    family_name: string | null;
    locale: string | null;
    status: Generated<'active' | 'disabled'>;
    failed_logins: Generated<number>;
    locked_until: Date | null;
    last_login_at: Date | null;
    password_changed_at: Date | null;
    created_at: CreatedAt;
  };
  account_totp: {
    account_id: string;
    secret_enc: string;
    confirmed_at: Date | null;
    last_used_step: string | null;
    created_at: CreatedAt;
  };
  account_recovery_code: { account_id: string; code_hash: string; used_at: Date | null };
  org: {
    id: string;
    name: string;
    mfa_required: Generated<boolean>;
    allow_registration: Generated<boolean>;
    blocked: Generated<boolean>;
    created_at: CreatedAt;
  };
  account_org: { account_id: string; org_id: string };
  email_token: {
    id: string;
    account_id: string;
    kind: 'verify' | 'reset' | 'setup';
    token_hash: string;
    attempts: Generated<number>;
    expires_at: Date;
    used_at: Date | null;
    created_at: CreatedAt;
  };
  oidc_model: {
    kind: string;
    id: string;
    payload: Json<Record<string, unknown>>;
    grant_id: string | null;
    uid: string | null;
    user_code: string | null;
    expires_at: Date | null;
    consumed_at: Date | null;
  };
  org_client: {
    client_id: string;
    org_id: string;
    name: string;
    secret_enc: string | null;
    redirect_uris: Json<string[]>;
    post_logout_redirect_uris: Json<string[]>;
    disabled: Generated<boolean>;
    created_at: CreatedAt;
  };
  signing_key: { kid: string; private_jwk: Json<Record<string, unknown>>; active: Generated<boolean>; created_at: CreatedAt };
  pending_login: {
    uid: string;
    account_id: string;
    stage: 'verify_email' | 'mfa' | 'mfa_setup';
    remember: Generated<boolean>;
    expires_at: Date;
  };
  login_event: {
    id: Generated<string>;
    account_id: string | null;
    email: string | null;
    ip: string | null;
    event: string;
    success: boolean;
    at: CreatedAt;
  };
}

/** GridPay's own database: the merchants organisations add and the payments taken through them. */
export interface PayDB {
  merchant: {
    id: string;
    org_id: string;
    name: string;
    merchant_ref: Generated<string>;
    credentials_enc: string | null;
    logo: string | null;
    methods: JsonDefault<string[]>;
    mode: Generated<'test' | 'live'>;
    enabled: Generated<boolean>;
    created_at: CreatedAt;
  };
  pay_method: {
    org_id: string;
    id: string;
    name: string;
    kind: 'card' | 'wallet' | 'bank' | 'instalments';
    logo: string | null;
    surcharge_percent: Generated<string | number>;
    surcharge_fixed: Generated<string | number>;
    instalments: Generated<number>;
    sort: Generated<number>;
    created_at: CreatedAt;
  };
  payment: {
    id: string;
    org_id: string;
    merchant_id: string | null;
    project_key: string;
    form_key: string;
    amount: string | number;
    currency: string;
    description: Generated<string>;
    payer_email: string | null;
    status: Generated<'pending' | 'succeeded' | 'failed' | 'cancelled'>;
    return_url: string;
    method: string | null;
    surcharge: Generated<string | number>;
    notified_at: Date | null;
    created_at: CreatedAt;
    paid_at: Date | null;
  };
}

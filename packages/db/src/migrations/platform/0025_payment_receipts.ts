import { sql, type Kysely } from 'kysely';

// Each successful payment gets a receipt number, counting up from 1 for each organisation (shown as R-000123).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment add column receipt_no bigint`.execute(db);
  await sql`create table tenant_receipt_counter (tenant_id uuid primary key references tenant(id) on delete cascade, last bigint not null default 0)`.execute(db);
  // Payments that already went through are numbered in the order they were paid.
  await sql`
    update payment p set receipt_no = n.rn
    from (select id, row_number() over (partition by tenant_id order by coalesce(paid_at, created_at), id) as rn from payment where status = 'succeeded') n
    where p.id = n.id`.execute(db);
  await sql`
    insert into tenant_receipt_counter (tenant_id, last)
    select tenant_id, max(receipt_no) from payment where receipt_no is not null group by tenant_id`.execute(db);
  await sql`create unique index payment_receipt_idx on payment (tenant_id, receipt_no) where receipt_no is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index payment_receipt_idx`.execute(db);
  await sql`drop table tenant_receipt_counter`.execute(db);
  await sql`alter table payment drop column receipt_no`.execute(db);
}

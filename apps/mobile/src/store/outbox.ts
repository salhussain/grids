import { type OutboxBlob, type OutboxItem, type OutboxStatus, type OutboxStore } from '@grids/offline';
import { uuidv7 } from '@grids/schema';
import { db } from '../db';

interface Row {
  id: string;
  target: string;
  form_name: string;
  version: number;
  entity_id: string | null;
  answers: string;
  collected_at: string;
  location: string | null;
  submitter: string | null;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
  owner: string;
}

const LINK_OWNER = 'link';

const toItem = (r: Row): OutboxItem => ({
  id: r.id,
  target: JSON.parse(r.target),
  formName: r.form_name,
  version: r.version,
  entityId: r.entity_id,
  answers: JSON.parse(r.answers),
  collectedAt: r.collected_at,
  location: r.location ? JSON.parse(r.location) : null,
  submitter: r.submitter,
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at,
  lastError: r.last_error,
  createdAt: r.created_at,
  sentAt: r.sent_at,
});

const COLUMNS: Record<string, string> = {
  status: 'status',
  attempts: 'attempts',
  nextAttemptAt: 'next_attempt_at',
  lastError: 'last_error',
  sentAt: 'sent_at',
  answers: 'answers',
  entityId: 'entity_id',
  location: 'location',
  collectedAt: 'collected_at',
  version: 'version',
  submitter: 'submitter',
};

/** The queue on the device. Account items are sent only while their account is signed in; link items by anyone. */
export class SqliteOutbox implements OutboxStore {
  constructor(private readonly subject: () => string | null) {}

  private owners() {
    const s = this.subject();
    return s ? [s, LINK_OWNER] : [LINK_OWNER];
  }

  async due(now: number, ignoreBackoff: boolean) {
    const d = await db();
    const owners = this.owners();
    const rows = await d.getAllAsync<Row>(
      `select * from outbox where status = 'queued' and owner in (${owners.map(() => '?').join(',')}) ${ignoreBackoff ? '' : 'and (next_attempt_at is null or next_attempt_at <= ?)'} order by created_at`,
      ...owners,
      ...(ignoreBackoff ? [] : [now]),
    );
    return rows.map(toItem);
  }

  async get(id: string) {
    const r = await (await db()).getFirstAsync<Row>('select * from outbox where id = ?', id);
    return r ? toItem(r) : undefined;
  }

  async update(id: string, patch: Partial<Omit<OutboxItem, 'id'>>) {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMNS[k];
      if (!col) continue;
      sets.push(`${col} = ?`);
      values.push(v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : (v as string | number));
    }
    if (sets.length) await (await db()).runAsync(`update outbox set ${sets.join(', ')} where id = ?`, ...values, id);
  }

  async blobsOf(itemId: string): Promise<OutboxBlob[]> {
    const rows = await (await db()).getAllAsync<{ id: string; item_id: string; name: string; content_type: string; uri: string; size: number; remote_id: string | null }>('select * from blobs where item_id = ?', itemId);
    return rows.map((r) => ({ id: r.id, itemId: r.item_id, name: r.name, contentType: r.content_type, uri: r.uri, size: r.size, remoteId: r.remote_id }));
  }

  async setBlobRemote(blobId: string, remoteId: string) {
    await (await db()).runAsync('update blobs set remote_id = ? where id = ?', remoteId, blobId);
  }

  async recoverInterrupted() {
    await (await db()).runAsync(`update outbox set status = 'queued' where status = 'sending'`);
  }

  // ----- what the screens use -----

  /** Saves a form being filled in (or finished): a draft until it is queued. */
  async save(item: Omit<OutboxItem, 'attempts' | 'nextAttemptAt' | 'lastError' | 'sentAt' | 'createdAt'> & { createdAt?: number }, blobs: OutboxBlob[]) {
    const d = await db();
    const owner = item.target.kind === 'link' ? LINK_OWNER : (this.subject() ?? '');
    await d.withTransactionAsync(async () => {
      await d.runAsync(
        `insert into outbox (id, target, form_name, version, entity_id, answers, collected_at, location, submitter, status, attempts, next_attempt_at, last_error, created_at, sent_at, owner)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, null, ?, null, ?)
         on conflict (id) do update set answers = excluded.answers, entity_id = excluded.entity_id, location = excluded.location, collected_at = excluded.collected_at, submitter = excluded.submitter, status = excluded.status, version = excluded.version, attempts = 0, next_attempt_at = null, last_error = null
         where outbox.status in ('draft', 'needs_attention')`,
        item.id,
        JSON.stringify(item.target),
        item.formName,
        item.version,
        item.entityId,
        JSON.stringify(item.answers),
        item.collectedAt,
        item.location ? JSON.stringify(item.location) : null,
        item.submitter ?? null,
        item.status,
        item.createdAt ?? Date.now(),
        owner,
      );
      await d.runAsync('delete from blobs where item_id = ? and id not in (' + (blobs.map(() => '?').join(',') || "''") + ')', item.id, ...blobs.map((b) => b.id));
      for (const b of blobs) {
        await d.runAsync('insert or ignore into blobs (id, item_id, name, content_type, uri, size, remote_id) values (?, ?, ?, ?, ?, ?, ?)', b.id, b.itemId, b.name, b.contentType, b.uri, b.size, b.remoteId);
      }
    });
  }

  async list(statuses: OutboxStatus[]): Promise<OutboxItem[]> {
    const owners = this.owners();
    const rows = await (await db()).getAllAsync<Row>(
      `select * from outbox where status in (${statuses.map(() => '?').join(',')}) and owner in (${owners.map(() => '?').join(',')}) order by created_at desc`,
      ...statuses,
      ...owners,
    );
    return rows.map(toItem);
  }

  /** How many are waiting, and how many need attention. */
  async counts() {
    const owners = this.owners();
    const rows = await (await db()).getAllAsync<{ status: OutboxStatus; n: number }>(
      `select status, count(*) as n from outbox where owner in (${owners.map(() => '?').join(',')}) group by status`,
      ...owners,
    );
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return { draft: by['draft'] ?? 0, waiting: (by['queued'] ?? 0) + (by['sending'] ?? 0), attention: by['needs_attention'] ?? 0, sent: by['sent'] ?? 0 };
  }

  /** Items of other accounts still waiting on this device. */
  async foreignWaiting() {
    const owners = this.owners();
    const r = await (await db()).getFirstAsync<{ n: number }>(`select count(*) as n from outbox where status in ('queued','needs_attention') and owner not in (${owners.map(() => '?').join(',')})`, ...owners);
    return r?.n ?? 0;
  }

  async blobs(itemId: string) {
    return this.blobsOf(itemId);
  }

  async remove(id: string) {
    await (await db()).runAsync('delete from outbox where id = ?', id);
  }

  /** Sent items older than this stay only as history on the server. */
  async clearSent(olderThan: number) {
    await (await db()).runAsync(`delete from outbox where status = 'sent' and sent_at < ?`, olderThan);
  }
}

export const newId = () => uuidv7();

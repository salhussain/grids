/** History for the status page: every check, each status change, and incidents (SQLite, no server needed). */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Result, Status } from './probes.js';

export interface IncidentRow {
  id: number;
  service: string;
  severity: Status;
  started: number;
  ended: number | null;
  detail: string;
}
export interface EventRow {
  ts: number;
  service: string;
  from: Status | null;
  to: Status;
  detail: string;
}
export interface WindowStats {
  total: number;
  up: number;
  degraded: number;
  down: number;
}

/** Consecutive bad (or good) checks before an incident opens (or closes), so one blip is not an incident. */
const CONFIRM = 2;
const DAY = 86_400_000;

export class Store {
  private readonly db: DatabaseSync;
  private readonly last = new Map<string, Status>();
  private readonly streak = new Map<string, { bad: number; good: number; firstBad: number }>();
  private readonly open = new Map<string, IncidentRow>();

  constructor(
    file: string,
    private readonly retentionDays: number,
  ) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS checks (ts INTEGER NOT NULL, service TEXT NOT NULL, status TEXT NOT NULL, ms INTEGER, detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS checks_service_ts ON checks (service, ts);
      CREATE TABLE IF NOT EXISTS events (ts INTEGER NOT NULL, service TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
      CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT NOT NULL, severity TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER, detail TEXT NOT NULL);
    `);
    for (const r of this.rows<IncidentRow>('SELECT * FROM incidents WHERE ended IS NULL')) this.open.set(r.service, r);
    for (const r of this.rows<{ service: string; status: Status }>('SELECT service, status FROM checks WHERE ts = (SELECT max(ts) FROM checks c WHERE c.service = checks.service)')) this.last.set(r.service, r.status);
  }

  private rows<T>(sql: string, ...args: (string | number)[]): T[] {
    return this.db.prepare(sql).all(...args) as unknown as T[];
  }

  record(r: Result, ts = Date.now()) {
    this.db.prepare('INSERT INTO checks (ts, service, status, ms, detail) VALUES (?, ?, ?, ?, ?)').run(ts, r.id, r.status, r.ms, r.detail);
    const prev = this.last.get(r.id) ?? null;
    if (prev !== r.status) {
      this.db.prepare('INSERT INTO events (ts, service, from_status, to_status, detail) VALUES (?, ?, ?, ?, ?)').run(ts, r.id, prev, r.status, r.detail);
      this.last.set(r.id, r.status);
    }
    const s = this.streak.get(r.id) ?? { bad: 0, good: 0, firstBad: 0 };
    const inc = this.open.get(r.id);
    if (r.status === 'up') {
      s.good++;
      s.bad = 0;
      if (inc && s.good >= CONFIRM) {
        this.db.prepare('UPDATE incidents SET ended = ? WHERE id = ?').run(ts, inc.id);
        this.open.delete(r.id);
      }
    } else {
      if (s.bad === 0) s.firstBad = ts;
      s.bad++;
      s.good = 0;
      if (!inc && s.bad >= CONFIRM) {
        const row = this.db.prepare('INSERT INTO incidents (service, severity, started, detail) VALUES (?, ?, ?, ?) RETURNING id').get(r.id, r.status, s.firstBad, r.detail) as { id: number };
        this.open.set(r.id, { id: row.id, service: r.id, severity: r.status, started: s.firstBad, ended: null, detail: r.detail });
      } else if (inc && (r.status === 'down' && inc.severity !== 'down')) {
        inc.severity = 'down';
        inc.detail = r.detail;
        this.db.prepare('UPDATE incidents SET severity = ?, detail = ? WHERE id = ?').run('down', r.detail, inc.id);
      }
    }
    this.streak.set(r.id, s);
  }

  openIncident(service: string) {
    return this.open.get(service) ?? null;
  }

  window(service: string, since: number): WindowStats & { first: number | null } {
    const r = this.db
      .prepare(
        `SELECT count(*) AS total, coalesce(sum(status = 'up'), 0) AS up, coalesce(sum(status = 'degraded'), 0) AS degraded, coalesce(sum(status = 'down'), 0) AS down, min(ts) AS first
         FROM checks WHERE service = ? AND ts >= ?`,
      )
      .get(service, since) as unknown as WindowStats & { first: number | null };
    return r;
  }

  /** Per-day totals for the last `days` days (local time), oldest first. */
  daily(service: string, days: number) {
    return this.rows<{ day: string } & WindowStats>(
      `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day, count(*) AS total, sum(status = 'up') AS up, sum(status = 'degraded') AS degraded, sum(status = 'down') AS down
       FROM checks WHERE service = ? AND ts >= ? GROUP BY day ORDER BY day`,
      service,
      Date.now() - days * DAY,
    );
  }

  events(limit: number, service?: string): EventRow[] {
    const base = 'SELECT ts, service, from_status AS "from", to_status AS "to", detail FROM events';
    return service ? this.rows<EventRow>(`${base} WHERE service = ? ORDER BY ts DESC LIMIT ?`, service, limit) : this.rows<EventRow>(`${base} ORDER BY ts DESC LIMIT ?`, limit);
  }

  incidents(limit: number): IncidentRow[] {
    return this.rows<IncidentRow>('SELECT * FROM incidents ORDER BY started DESC LIMIT ?', limit);
  }

  prune() {
    this.db.prepare('DELETE FROM checks WHERE ts < ?').run(Date.now() - this.retentionDays * DAY);
  }
}

import './polyfills';
import { Outbox, SyncError, syncPlaces, type OutboxApi, type OutboxItem, type OutboxBlob } from '@grids/offline';
import NetInfo from '@react-native-community/netinfo';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { loadSession, sessionSubject } from './auth';
import { catalogKey, readCatalog, writeCatalog } from './store/catalog';
import { SqliteOutbox } from './store/outbox';
import { sqlitePlaces } from './store/places';
import { liteOf, scopeOf, type FormLite, type HistoryRow, type ProjectLite } from './types';

export const outboxStore = new SqliteOutbox(sessionSubject);

// ----- what the screens can show -----

export interface SyncStatus {
  online: boolean;
  running: boolean;
  /** The last time a sync ended well (epoch ms). */
  lastSyncAt: number | null;
  /** What the last attempt ran into, if it did. */
  error: string | null;
  signedOut: boolean;
  counts: { draft: number; waiting: number; attention: number; sent: number };
  /** Bumped whenever something in the queue or the downloads changed: screens reload on it. */
  version: number;
}

let status: SyncStatus = { online: true, running: false, lastSyncAt: null, error: null, signedOut: false, counts: { draft: 0, waiting: 0, attention: 0, sent: 0 }, version: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch, version: status.version + 1 };
  for (const l of listeners) l();
};

export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );

/** Call after the queue changed (a form was saved, an item removed). */
export async function refreshCounts() {
  set({ counts: await outboxStore.counts() });
}

// ----- upwards: the outbox -----

const bytesOf = async (b: OutboxBlob) => (await fetch(b.uri)).blob();

const outboxApi: OutboxApi = {
  async upload(item: OutboxItem, b: OutboxBlob) {
    const file = await bytesOf(b).catch(() => {
      // The file is gone from the device: sending again will not help.
      throw new SyncError('File missing', 410, `The file “${b.name}” is no longer on this device.`);
    });
    const t = item.target;
    return t.kind === 'link' ? api.linkUpload(t.path, file, b.name, b.contentType) : api.upload(t.tenantId, t.project, t.form, file, b.name, b.contentType);
  },
  async submit(item, answers) {
    const t = item.target;
    if (t.kind === 'link') {
      await api.linkSubmit(t.path, { id: item.id, version: item.version, answers, collectedAt: item.collectedAt, submitter: item.submitter ?? null, emailCode: null, captcha: null });
    } else {
      await api.submit(t.tenantId, t.project, t.form, { id: item.id, version: item.version, entityId: item.entityId, answers, collectedAt: item.collectedAt, location: item.location });
    }
  },
};

export const outbox = new Outbox(outboxStore, outboxApi, { onChange: () => void refreshCounts() });

// ----- downwards: projects, forms, places -----

export interface Catalog {
  tenants: { tenantId: string; tenantName: string; projects: ProjectLite[] }[];
}

/** Who and which organisations the device knows, from the last time it was online. */
export async function readTenants() {
  return (await readCatalog<{ tenantId: string; tenantName: string }[]>(catalogKey.me))?.value ?? [];
}
export async function readProjects(tenantId: string) {
  return (await readCatalog<ProjectLite[]>(catalogKey.projects(tenantId)))?.value ?? [];
}
export async function readForms(tenantId: string, project: string) {
  return (await readCatalog<FormLite[]>(catalogKey.forms(tenantId, project)))?.value ?? [];
}
export async function readHistory(tenantId: string, project: string) {
  return (await readCatalog<HistoryRow[]>(catalogKey.history(tenantId, project))) ?? null;
}
const defKey = (tenantId: string, project: string, form: string, version: number) => `def:${tenantId}:${project}:${form}:${version}`;
/** A published version of a form. Versions the device has seen are kept, so a half-filled form can be finished on the version it started on. */
export async function readDefinition(tenantId: string, project: string, form: string, version: number) {
  return (await readCatalog<FormLite['published']>(defKey(tenantId, project, form, version)))?.value ?? null;
}

async function refreshCatalog() {
  const me = await api.me();
  const active = me.memberships.filter((m) => m.status === 'active');
  await writeCatalog(catalogKey.me, active.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenantName })));
  for (const m of active) {
    const projects = await api.projects(m.tenantId);
    const lite = projects.filter((p) => !p.archived).map((p): ProjectLite => ({ key: p.key, name: p.name, color: p.color, icon: p.icon, myRole: p.myRole }));
    await writeCatalog(catalogKey.projects(m.tenantId), lite);
    for (const p of lite) {
      const forms = (await api.forms(m.tenantId, p.key)).filter((f) => f.currentVersion !== null && f.published);
      await writeCatalog(catalogKey.forms(m.tenantId, p.key), forms.map(liteOf));
      for (const f of forms) await writeCatalog(defKey(m.tenantId, p.key, f.key, f.currentVersion!), f.published);
      // What this account has sent from here, to read offline. A form that cannot be listed is skipped.
      const history: HistoryRow[] = [];
      for (const f of forms) {
        try {
          const page = await api.mySubmissions(m.tenantId, p.key, f.key);
          history.push(...page.items.map((s): HistoryRow => ({ id: s.id, formName: s.formName, status: s.status, stageName: s.stageName, outcome: s.outcome, entity: s.entity?.name ?? null, collectedAt: s.collectedAt, submittedAt: s.submittedAt })));
        } catch (e) {
          if (e instanceof SyncError && e.status === undefined) throw e;
        }
      }
      await writeCatalog(catalogKey.history(m.tenantId, p.key), history.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 200));
      // Places for the entity questions: the whole project, as far as the account may see it.
      await syncPlaces(sqlitePlaces, { page: (since, after) => api.placesSync(m.tenantId, p.key, { since, after, limit: 1000 }) }, scopeOf(m.tenantId, p.key));
    }
  }
}

// ----- the whole round -----

let round: Promise<void> | null = null;

/**
 * Sends what is waiting, then brings forms and places up to date. `manual`: the person asked, so
 * items that were waiting out a delay are tried too and problems are shown.
 */
export function syncAll(manual = false): Promise<void> {
  round ??= (async () => {
    set({ running: true, error: null });
    let failure: string | null = null;
    try {
      await loadSession();
      const net = await NetInfo.fetch();
      if (net.isConnected === false) {
        set({ online: false });
        return;
      }
      const report = await outbox.sync(manual);
      if (report.stopped === 'signed_out') {
        set({ signedOut: true });
        return;
      }
      if (report.stopped === 'offline') {
        set({ online: false });
        return;
      }
      if (sessionSubject()) await refreshCatalog();
      set({ online: true, signedOut: false, lastSyncAt: Date.now() });
    } catch (e) {
      failure = e instanceof SyncError && e.status === 401 ? null : e instanceof Error ? e.message : 'Could not sync';
      if (e instanceof SyncError && e.status === 401) set({ signedOut: true });
      else if (e instanceof SyncError && e.status === undefined) set({ online: false });
    } finally {
      round = null;
      set({ running: false, error: manual || !failure ? failure : null, counts: await outboxStore.counts() });
    }
  })();
  return round;
}

/** Sync when the connection comes back, when the app is opened again, and now and then while it is open. */
export function startAutoSync() {
  void refreshCounts();
  let was: boolean | null = null;
  const net = NetInfo.addEventListener((s) => {
    const online = s.isConnected !== false && s.isInternetReachable !== false;
    set({ online });
    if (online && was === false) void syncAll(false);
    was = online;
  });
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncAll(false);
  });
  const timer = setInterval(() => {
    if (AppState.currentState === 'active') void syncAll(false);
  }, 5 * 60_000);
  void syncAll(false);
  return () => {
    net();
    app.remove();
    clearInterval(timer);
  };
}

// ----- while the app is closed -----

const TASK = 'grids-background-sync';

// Runs headless: only the upward part. Downloads wait until the app is opened.
TaskManager.defineTask(TASK, async () => {
  try {
    await loadSession();
    await outbox.sync(false);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  try {
    if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    }
  } catch {
    /* not available on this device (a simulator, for one) */
  }
}

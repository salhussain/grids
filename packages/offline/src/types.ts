export type OutboxStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'needs_attention';

/** A submission kept on the device until the server has it. */
export interface OutboxItem {
  /** Client-generated UUID: the server treats a resend of the same id as a no-op. */
  id: string;
  /** Signed-in people send to a project; people with a link send to the link. */
  target: { kind: 'project'; tenantId: string; project: string; form: string } | { kind: 'link'; path: string };
  formName: string;
  version: number;
  entityId: string | null;
  /** Pictures and files are `local:<blobId>` until they are uploaded. */
  answers: Record<string, unknown>;
  collectedAt: string;
  location: { lat: number; lon: number } | null;
  /** Public links only. */
  submitter?: string | null;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; not tried before this unless the person asks for a sync. */
  nextAttemptAt: number | null;
  lastError: string | null;
  createdAt: number;
  sentAt: number | null;
}

/** A picture or file waiting to go up with a submission. */
export interface OutboxBlob {
  id: string;
  itemId: string;
  name: string;
  contentType: string;
  /** Where the bytes are on the device. */
  uri: string;
  size: number;
  /** Set once uploaded. */
  remoteId: string | null;
}

export const LOCAL_PREFIX = 'local:';
export const localRef = (blobId: string) => `${LOCAL_PREFIX}${blobId}`;
export const isLocalRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith(LOCAL_PREFIX);
export const blobIdOf = (ref: string) => ref.slice(LOCAL_PREFIX.length);

/** What went wrong when talking to the server. */
export class SyncError extends Error {
  constructor(
    message: string,
    /** HTTP status; none when the request never got an answer (no connection, timeout). */
    readonly status?: number,
    /** The server's explanation, shown to the person. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

export interface OutboxStore {
  /** Items that could be sent now (`queued`, due), oldest first. */
  due(now: number, ignoreBackoff: boolean): Promise<OutboxItem[]>;
  get(id: string): Promise<OutboxItem | undefined>;
  update(id: string, patch: Partial<Omit<OutboxItem, 'id'>>): Promise<void>;
  blobsOf(itemId: string): Promise<OutboxBlob[]>;
  setBlobRemote(blobId: string, remoteId: string): Promise<void>;
  /** Items left `sending` by a crash go back to `queued`. */
  recoverInterrupted(): Promise<void>;
}

export interface OutboxApi {
  /** Throws `SyncError`. */
  upload(item: OutboxItem, blob: OutboxBlob): Promise<{ id: string }>;
  submit(item: OutboxItem, answers: Record<string, unknown>): Promise<void>;
}

export interface SyncReport {
  sent: number;
  failed: number;
  /** Left in the queue to try later. */
  waiting: number;
  /** Stopped early: offline, or signed out. */
  stopped: 'offline' | 'signed_out' | null;
}

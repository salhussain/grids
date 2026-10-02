import type { ChangeEvent } from '@grids/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

const open = new Set<() => void>();

/** Ends every open stream (server shutdown). */
export function closeAllStreams() {
  for (const end of [...open]) end();
}

/** What a client receives: enough to refetch the right things, nothing more. */
const toMessage = (e: ChangeEvent) => (e.kind === 'run' ? { kind: 'run', run: e.run } : { kind: 'data', table: e.table });

/**
 * Streams change events as server-sent events. Data events are coalesced (a burst
 * of writes becomes one message per `coalesceMs`); run events go out as they
 * happen. A comment line every 25 s keeps proxies from closing the stream.
 */
export async function streamEvents(
  req: FastifyRequest,
  reply: FastifyReply,
  subscribe: (fn: (e: ChangeEvent) => void) => Promise<() => void>,
  coalesceMs = 750,
) {
  let pendingData: ChangeEvent | null = null;
  let flushTimer: NodeJS.Timeout | null = null;
  const raw = reply.raw;
  const write = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const unsubscribe = await subscribe((e) => {
    if (e.kind === 'run') return void write('change', toMessage(e));
    pendingData = e;
    flushTimer ??= setTimeout(() => {
      flushTimer = null;
      if (pendingData) write('change', toMessage(pendingData));
      pendingData = null;
    }, coalesceMs);
  });

  reply.hijack();
  // Hijacked replies skip Fastify's header handling, so carry over CORS headers.
  raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  raw.write('retry: 5000\n\n');
  write('ready', { at: new Date().toISOString() });
  const ping = setInterval(() => raw.write(': ping\n\n'), 25_000);

  const close = () => {
    if (!open.delete(end)) return;
    clearInterval(ping);
    if (flushTimer) clearTimeout(flushTimer);
    unsubscribe();
  };
  const end = () => {
    close();
    raw.end();
  };
  open.add(end);
  req.raw.on('close', close);
}

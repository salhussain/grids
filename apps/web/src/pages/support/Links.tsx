import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { LinkedTicket, TicketDetail, TicketLinkKind } from '@grids/schema';
import { Button, Dialog, Input, Listbox, cx, useToast } from '@grids/ui';
import {
  ArrowDownToLine,
  CornerDownRight,
  Link2,
  Network,
  OctagonX,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { PriorityIcon, StageDot } from './shared';

const KINDS: { id: TicketLinkKind; label: string; icon: typeof Link2 }[] = [
  { id: 'sub', label: 'Sub-issue', icon: CornerDownRight },
  { id: 'parent', label: 'Parent', icon: ArrowDownToLine },
  { id: 'blocked_by', label: 'Blocked by', icon: OctagonX },
  { id: 'blocks', label: 'Blocking', icon: OctagonX },
  { id: 'related', label: 'Related', icon: Link2 },
];

/** A linked ticket as one line: its stage, number and subject; opens it. */
function Line({
  tenantId,
  t,
  onRemove,
}: {
  tenantId: string;
  t: LinkedTicket;
  onRemove?: () => void;
}) {
  return (
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-100">
      {t.stage ? (
        <StageDot kind={t.stage.kind} stageKey={t.stage.key} />
      ) : (
        <span className="size-4" />
      )}
      <Link
        to="/o/$tenantId/support/$ticketId"
        params={{ tenantId, ticketId: t.id }}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <span className="shrink-0 font-mono text-xs text-zinc-500">#{t.number}</span>
        <span className={cx('truncate', t.stage?.kind === 'done' && 'text-zinc-500 line-through')}>
          {t.subject}
        </span>
      </Link>
      <PriorityIcon priority={t.priority} />
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove link to #${t.number}`}
          onClick={onRemove}
          className="p-0.5 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-700 focus-visible:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}

/** Finds a ticket of the organisation and links it. */
export function LinkDialog({
  tenantId,
  t,
  kind: first,
  onClose,
  onChange,
}: {
  tenantId: string;
  t: TicketDetail;
  kind: TicketLinkKind;
  onClose(): void;
  onChange(d: TicketDetail): void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<TicketLinkKind>(first);
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['ticket-pick', tenantId, q],
    queryFn: () =>
      api.tickets(tenantId, {
        audience: 'organisation',
        pageSize: 20,
        ...(q.trim() && { q: q.trim() }),
      }),
  });
  const linked = new Set([
    t.id,
    t.links.parent?.id,
    ...t.links.subs.map((x) => x.id),
    ...t.links.related.map((x) => x.id),
    ...t.links.blocks.map((x) => x.id),
    ...t.links.blockedBy.map((x) => x.id),
  ]);
  const add = useMutation({
    mutationFn: (ticketId: string) => api.linkTicket(tenantId, t.id, { kind, ticketId }),
    onSuccess: (d) => (onChange(d), onClose()),
    onError: (e) => toast(e instanceof Error ? e.message : 'The tickets could not be linked'),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Link a ticket"
      description="Pick how the other ticket relates to this one, then the ticket."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="space-y-3">
        <Listbox
          label="The other ticket is"
          value={kind}
          onChange={(k) => setKind(k as TicketLinkKind)}
          options={KINDS.map((k) => ({ value: k.id, label: k.label, icon: k.icon }))}
        />
        <Input
          icon={Search}
          autoFocus
          aria-label="Find a ticket"
          placeholder="Find by number or title"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-72 overflow-y-auto">
          {(found.data?.items ?? [])
            .filter((x) => !linked.has(x.id))
            .map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => add.mutate(x.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-zinc-100"
                >
                  {x.stage && <StageDot kind={x.stage.kind} stageKey={x.stage.key} />}
                  <span className="shrink-0 font-mono text-xs text-zinc-500">#{x.number}</span>
                  <span className="truncate">{x.subject}</span>
                </button>
              </li>
            ))}
          {found.data && !found.data.items.filter((x) => !linked.has(x.id)).length && (
            <li className="px-2 py-6 text-center text-sm text-zinc-500">No tickets to link.</li>
          )}
        </ul>
      </div>
    </Dialog>
  );
}

/** Sub-issues under the description, with how many are done. */
export function SubIssues({
  tenantId,
  t,
  editable,
  onChange,
}: {
  tenantId: string;
  t: TicketDetail;
  editable: boolean;
  onChange(d: TicketDetail): void;
}) {
  const [adding, setAdding] = useState(false);
  const un = useMutation({
    mutationFn: (id: string) => api.unlinkTicket(tenantId, t.id, id),
    onSuccess: onChange,
  });
  const subs = t.links.subs;
  if (!subs.length && !editable) return null;
  const done = subs.filter((s) => s.stage?.kind === 'done').length;
  return (
    <section aria-label="Sub-issues">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-500">
          <Network className="size-4" /> Sub-issues{' '}
          {subs.length > 0 && (
            <span className="num text-zinc-400">
              {done}/{subs.length}
            </span>
          )}
        </h2>
        {subs.length > 0 && (
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200" aria-hidden>
            <span
              className="block h-full rounded-full bg-emerald-500"
              style={{ width: `${(done / subs.length) * 100}%` }}
            />
          </span>
        )}
        {editable && (
          <button
            type="button"
            aria-label="Add a sub-issue"
            onClick={() => setAdding(true)}
            className="ms-auto p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {subs.length > 0 && (
        <ul>
          {subs.map((s) => (
            <Line
              key={s.id}
              tenantId={tenantId}
              t={s}
              onRemove={editable ? () => un.mutate(s.linkId) : undefined}
            />
          ))}
        </ul>
      )}
      {adding && (
        <LinkDialog
          tenantId={tenantId}
          t={t}
          kind="sub"
          onClose={() => setAdding(false)}
          onChange={onChange}
        />
      )}
    </section>
  );
}

/** The sidebar's Relations: the parent, what blocks it and what it blocks, and related tickets. */
export function Relations({
  tenantId,
  t,
  editable,
  onChange,
}: {
  tenantId: string;
  t: TicketDetail;
  editable: boolean;
  onChange(d: TicketDetail): void;
}) {
  const [adding, setAdding] = useState(false);
  const un = useMutation({
    mutationFn: (id: string) => api.unlinkTicket(tenantId, t.id, id),
    onSuccess: onChange,
  });
  const l = t.links;
  const groups: { title: string; icon: typeof Link2; items: LinkedTicket[] }[] = [
    { title: 'Parent', icon: ArrowDownToLine, items: l.parent ? [l.parent] : [] },
    { title: 'Blocked by', icon: OctagonX, items: l.blockedBy },
    { title: 'Blocking', icon: OctagonX, items: l.blocks },
    { title: 'Related', icon: Link2, items: l.related },
  ].filter((g) => g.items.length);
  if (!groups.length && !editable) return null;
  return (
    <section>
      <div className="mb-1 flex items-center px-2">
        <h2 className="text-sm font-medium text-zinc-500">Relations</h2>
        {editable && (
          <button
            type="button"
            aria-label="Link a ticket"
            onClick={() => setAdding(true)}
            className="ms-auto p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.title} className="mb-2">
          <div className="flex items-center gap-1.5 px-2 text-xs text-zinc-400">
            <g.icon className="size-3.5" /> {g.title}
          </div>
          <ul>
            {g.items.map((x) => (
              <Line
                key={x.linkId}
                tenantId={tenantId}
                t={x}
                onRemove={editable ? () => un.mutate(x.linkId) : undefined}
              />
            ))}
          </ul>
        </div>
      ))}
      {!groups.length && <p className="px-2 text-sm text-zinc-400">No linked tickets.</p>}
      {adding && (
        <LinkDialog
          tenantId={tenantId}
          t={t}
          kind="blocked_by"
          onClose={() => setAdding(false)}
          onChange={onChange}
        />
      )}
    </section>
  );
}

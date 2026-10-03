import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import type { TicketDetail } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, Listbox, Textarea, cx } from '@grids/ui';
import { Building2, CheckCircle2, LifeBuoy, X } from 'lucide-react';
import { useState } from 'react';
import { api } from './api';
import { useCan, useWorkspace } from './session';

const CATEGORIES = [
  ['question', 'Question'],
  ['bug', 'Something isn’t working'],
  ['account', 'Access or account'],
  ['feature_request', 'Idea or request'],
  ['other', 'Other'],
] as const;

/**
 * Help from anywhere in the workspace: raise an issue with the organisation's own
 * admins (they can escalate it), or, for admins, straight to the Grids team.
 */
export function SupportBubble() {
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const page = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: '', body: '', category: 'question' as (typeof CATEGORIES)[number][0], audience: 'organisation' as 'organisation' | 'platform' });
  const [done, setDone] = useState<TicketDetail | null>(null);
  const send = useMutation({
    mutationFn: () => api.createTicket(ws.tenant.id, { ...f, priority: 'normal', page }),
    onSuccess: (t) => {
      setDone(t);
      setF({ ...f, subject: '', body: '' });
      void qc.invalidateQueries({ queryKey: ['tickets', ws.tenant.id] });
    },
  });
  if (!can('support.create')) return null;
  const admin = can('support.manage');
  return (
    <div className="fixed end-5 bottom-5 z-40 print:hidden">
      {open && (
        <div role="dialog" aria-label="Get help" className="absolute end-0 bottom-14 w-[min(92vw,380px)] border border-zinc-300 bg-snow shadow-2xl">
          <header className="flex items-center justify-between border-b border-zinc-200 bg-ink px-4 py-3 text-canvas">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <LifeBuoy className="size-4" /> Get help
            </span>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="opacity-70 hover:opacity-100">
              <X className="size-4" />
            </button>
          </header>
          {done ? (
            <div className="space-y-3 p-5 text-sm">
              <p className="flex items-center gap-2 font-medium text-emerald-700">
                <CheckCircle2 className="size-5" /> Ticket #{done.number} raised
              </p>
              <p className="text-zinc-600">{done.audience === 'organisation' ? 'Your organisation’s admins have been notified.' : 'The Grids team has been notified.'} You’ll get replies by email and in Support.</p>
              <div className="flex gap-2">
                <Link to="/o/$tenantId/support/$ticketId" params={{ tenantId: ws.tenant.id, ticketId: done.id }} onClick={() => setOpen(false)} className="inline-flex h-8 items-center bg-accent-600 px-3 text-sm font-medium text-on-accent">
                  View ticket
                </Link>
                <Button size="sm" variant="secondary" onClick={() => setDone(null)}>
                  Raise another
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-3 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate();
              }}
            >
              <ErrorNotice error={send.error} />
              {admin && (
                <div role="radiogroup" aria-label="Send to" className="grid grid-cols-2 border border-zinc-300 text-xs">
                  {(
                    [
                      ['organisation', 'Our organisation', Building2],
                      ['platform', 'The Grids team', LifeBuoy],
                    ] as const
                  ).map(([v, l, Icon]) => (
                    <button key={v} type="button" role="radio" aria-checked={f.audience === v} onClick={() => setF({ ...f, audience: v })} className={cx('flex items-center justify-center gap-1.5 py-2', f.audience === v ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-50')}>
                      <Icon className="size-3.5" /> {l}
                    </button>
                  ))}
                </div>
              )}
              {!admin && <p className="text-xs text-zinc-500">Your organisation’s admins will pick this up, and can pass it to the Grids team.</p>}
              <Field label="What’s it about?">
                <Listbox label="Category" value={f.category} onChange={(category) => setF({ ...f, category })} options={CATEGORIES.map(([value, label]) => ({ value, label }))} />
              </Field>
              <Field label="Subject">
                <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={4} />
              </Field>
              <Field label="Details">
                <Textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <Link to="/o/$tenantId/support" params={{ tenantId: ws.tenant.id }} onClick={() => setOpen(false)} className="text-xs text-accent-700 hover:underline">
                  My tickets
                </Link>
                <Button type="submit" loading={send.isPending} disabled={f.subject.trim().length < 4 || !f.body.trim()}>
                  Send
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label={open ? 'Close help' : 'Get help'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex size-12 items-center justify-center bg-accent-600 text-on-accent shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
      >
        {open ? <X className="size-5" /> : <LifeBuoy className="size-5" />}
      </button>
    </div>
  );
}

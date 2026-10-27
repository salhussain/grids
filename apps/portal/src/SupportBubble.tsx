import { useMutation } from '@tanstack/react-query';
import type { TicketDetail } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, Listbox, Textarea, cx } from '@grids/ui';
import { CheckCircle2, LifeBuoy, X } from 'lucide-react';
import { useState } from 'react';
import { api } from './api';

const CATEGORIES = [
  ['question', 'Question'],
  ['bug', 'Something isn’t working'],
  ['account', 'Access or account'],
  ['feature_request', 'Idea or request'],
  ['other', 'Other'],
] as const;

/**
 * Help from anywhere in the portal. A ticket always goes to the person's own organisation first;
 * its admins answer it, and can pass it on to the platform team if they need to.
 */
export function SupportBubble({ tenantId, side = 'start' }: { tenantId: string; side?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: '', body: '', category: 'question' as (typeof CATEGORIES)[number][0] });
  const [done, setDone] = useState<TicketDetail | null>(null);
  const send = useMutation({
    mutationFn: () => api.createTicket(tenantId, { ...f, audience: 'organisation', priority: 'normal', page: window.location.pathname }),
    onSuccess: (t) => {
      setDone(t);
      setF({ ...f, subject: '', body: '' });
    },
  });
  return (
    <div className={cx('fixed bottom-5 z-40 print:hidden', side === 'start' ? 'start-5' : 'end-5')}>
      {open && (
        <div role="dialog" aria-label="Get help" className={cx('absolute bottom-14 w-[min(92vw,360px)] border border-zinc-300 bg-snow shadow-2xl', side === 'start' ? 'start-0' : 'end-0')}>
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
              <p className="text-zinc-600">Your organisation’s admins have been notified. You’ll get their reply by email.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button size="sm" onClick={() => setDone(null)}>
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
              <p className="text-xs text-zinc-500">Goes to your organisation’s admins first. They can pass it on to the platform team if needed.</p>
              <Field label="What’s it about?">
                <Listbox label="Category" value={f.category} onChange={(category) => setF({ ...f, category })} options={CATEGORIES.map(([value, label]) => ({ value, label }))} />
              </Field>
              <Field label="Subject">
                <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={4} placeholder="e.g. A dashboard shows no data" />
              </Field>
              <Field label="Details">
                <Textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required placeholder="What happened, and what did you expect?" />
              </Field>
              <div className="flex justify-end">
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
        className="flex size-12 items-center justify-center rounded-full bg-accent-600 text-on-accent shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
      >
        {open ? <X className="size-5" /> : <LifeBuoy className="size-5" />}
      </button>
    </div>
  );
}

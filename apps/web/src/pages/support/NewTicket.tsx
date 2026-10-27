import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button, Dialog, ErrorNotice, Listbox, cx, humanize, useToast } from '@grids/ui';
import {
  Bug,
  CreditCard,
  FileText,
  HelpCircle,
  Lightbulb,
  Loader2,
  Paperclip,
  Shapes,
  Tag,
  UserRound,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useRef, useState } from 'react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import {
  Avatar,
  PRIORITY_LABEL,
  PriorityIcon,
  dotIcon,
  priorityIcon,
  useDesk,
  useHandlers,
  type Priority,
} from './shared';

const CATEGORIES = ['question', 'bug', 'billing', 'feature_request', 'account', 'other'] as const;
const CATEGORY_ICON: Record<(typeof CATEGORIES)[number], ComponentType<{ className?: string }>> = {
  question: HelpCircle,
  bug: Bug,
  billing: CreditCard,
  feature_request: Lightbulb,
  account: UserRound,
  other: Shapes,
};

/** A ticket raised by a member: to the organisation's own team first, which can pass it on to Grids. */
export function NewTicket({ onClose }: { onClose(): void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [v, setV] = useState<{
    subject: string;
    category: (typeof CATEGORIES)[number];
    priority: Priority;
    body: string;
  }>({ subject: '', category: 'question', priority: 'normal', body: '' });
  const desk = useDesk(ws.tenant.id);
  const handlers = useHandlers(ws.tenant.id);
  const [assignee, setAssignee] = useState('__none');
  const [labels, setLabels] = useState<string[]>([]);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const pick = useRef<HTMLInputElement>(null);
  const addFiles = async (picked: File[]) => {
    const list = picked.slice(0, 5 - files.length);
    if (!list.length) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of list) {
        const up = await api.uploadSupportFile(ws.tenant.id, f, f.name);
        setFiles((cur) => [...cur, { id: up.id, name: up.name }]);
      }
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const create = useMutation({
    mutationFn: async () => {
      const made = await api.createTicket(ws.tenant.id, {
        ...v,
        audience: 'organisation',
        attachments: files.map((f) => f.id),
      });
      // Who has it and its labels are set on the ticket once it exists.
      if (assignee !== '__none' || labels.length)
        await api.updateOrgTicket(ws.tenant.id, made.id, {
          ...(assignee !== '__none' && { assigneeId: assignee }),
          ...(labels.length && { labels }),
        });
      return made;
    },
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ['tickets', ws.tenant.id] });
      toast(`Ticket #${t.number} raised`);
      onClose();
      void navigate({
        to: '/o/$tenantId/support/$ticketId',
        params: { tenantId: ws.tenant.id, ticketId: t.id },
      });
    },
  });
  const chip =
    'inline-flex h-8 max-w-full items-center gap-2 border border-zinc-200 bg-snow px-2.5 text-sm text-zinc-700 hover:bg-zinc-50';
  const who = (handlers.data ?? []).find((h) => h.id === assignee);
  const CatIcon = CATEGORY_ICON[v.category];
  const picked = labels.map((k) => desk.data?.labels.find((l) => l.key === k)).filter((l) => !!l);
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="New ticket"
      footer={
        <>
          <input
            ref={pick}
            type="file"
            multiple
            hidden
            onChange={(e) => (void addFiles([...(e.target.files ?? [])]), (e.target.value = ''))}
          />
          <button
            type="button"
            aria-label="Attach files"
            title="Attach files (up to 5): or drop them anywhere here"
            disabled={busy || files.length >= 5}
            onClick={() => pick.current?.click()}
            className="me-auto flex size-8 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={v.subject.trim().length < 4 || !v.body.trim() || busy}
          >
            Create ticket
          </Button>
        </>
      }
    >
      <div
        className={cx(
          'relative -m-1 space-y-4 p-1',
          over && 'outline-2 -outline-offset-2 outline-accent-600 outline-dashed',
        )}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        <p className="text-sm text-zinc-500">Goes to your organisation’s support team.</p>
        <input
          autoFocus
          aria-label="Subject"
          placeholder="Ticket title"
          value={v.subject}
          maxLength={200}
          onChange={(e) => setV({ ...v, subject: e.target.value })}
          className="block w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-zinc-300"
        />
        <textarea
          aria-label="Description"
          placeholder="What happened, and what you expected. Include steps to reproduce, if any…"
          rows={7}
          value={v.body}
          onChange={(e) => setV({ ...v, body: e.target.value })}
          className="block w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-zinc-400"
        />
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-1.5 bg-zinc-100 py-1 ps-2 pe-1 text-xs"
              >
                <FileText className="size-3.5 text-zinc-500" /> {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles(files.filter((x) => x.id !== f.id))}
                  className="p-0.5 text-zinc-500 hover:text-ink"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
          <Listbox
            searchable
            label="Category"
            value={v.category}
            onChange={(category) => setV({ ...v, category })}
            trigger={{
              className: chip,
              children: (
                <>
                  <CatIcon className="size-4 text-zinc-500" /> {humanize(v.category)}
                </>
              ),
            }}
            options={CATEGORIES.map((c) => ({
              value: c,
              label: humanize(c),
              icon: CATEGORY_ICON[c],
            }))}
          />
          <Listbox
            searchable
            label="Priority"
            value={v.priority}
            onChange={(priority) => setV({ ...v, priority })}
            trigger={{
              className: chip,
              children: (
                <>
                  <PriorityIcon priority={v.priority} /> {PRIORITY_LABEL[v.priority]}
                </>
              ),
            }}
            options={(['urgent', 'high', 'normal', 'low'] as const).map((p) => ({
              value: p,
              label: PRIORITY_LABEL[p],
              icon: priorityIcon(p),
            }))}
          />
          <Listbox
            searchable
            label="Assign to"
            value={assignee}
            onChange={setAssignee}
            trigger={{
              className: chip,
              children: who ? (
                <>
                  <Avatar name={who.name} size={18} /> {who.name}
                </>
              ) : (
                <>
                  <UserRound className="size-4 text-zinc-500" /> Assignee
                </>
              ),
            }}
            options={[
              { value: '__none', label: 'Unassigned', icon: UserRound },
              ...(handlers.data ?? []).map((h) => ({ value: h.id, label: h.name })),
            ]}
          />
          <Listbox
            searchable
            label="Labels"
            value={null}
            values={labels}
            onChangeMany={setLabels}
            trigger={{
              className: chip,
              children: picked.length ? (
                <span className="flex min-w-0 items-center gap-2">
                  {picked.slice(0, 2).map((l) => (
                    <span key={l!.key} className="inline-flex items-center gap-1.5 truncate">
                      <i
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: l!.color }}
                      />
                      {l!.label}
                    </span>
                  ))}
                  {picked.length > 2 && <span className="text-zinc-500">+{picked.length - 2}</span>}
                </span>
              ) : (
                <>
                  <Tag className="size-4 text-zinc-500" /> Labels
                </>
              ),
            }}
            options={(desk.data?.labels ?? []).map((l) => ({
              value: l.key,
              label: l.label,
              icon: dotIcon(l.color),
            }))}
          />
        </div>
        <ErrorNotice error={create.error ?? err} />
      </div>
    </Dialog>
  );
}

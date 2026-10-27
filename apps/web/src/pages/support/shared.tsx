import { useQuery } from '@tanstack/react-query';
import type { HelpDeskConfig, SupportLabel, TicketSummary } from '@grids/schema';
import { cx } from '@grids/ui';
import type { ComponentType } from 'react';
import { api } from '../../api';

export type Priority = TicketSummary['priority'];
export type Stage = NonNullable<TicketSummary['stage']>;

/** The organisation's stages, labels and replies (the starting set until it changes them). */
let ORDER: readonly { key: string; kind: Stage['kind'] }[] = [];
export function useDesk(tenantId: string, enabled = true) {
  const q = useQuery({
    queryKey: ['support-desk', tenantId],
    queryFn: () => api.supportDesk(tenantId),
    enabled,
    staleTime: 30_000,
  });
  // The stage icons fill up as a ticket moves along, so they need to know the order the organisation put its stages in.
  if (q.data) ORDER = q.data.stages;
  return q;
}
/** The people a ticket can be given to. */
export function useHandlers(tenantId: string, enabled = true) {
  return useQuery({
    queryKey: ['support-handlers', tenantId],
    queryFn: () => api.supportHandlers(tenantId),
    enabled,
    staleTime: 60_000,
  });
}

export const KIND_TEXT = {
  open: 'Waiting to be picked up',
  active: 'Being worked on',
  done: 'Finished',
} as const;

/** Where a ticket is: a coloured dot and the organisation's own name for the stage. */
const KIND_COLOR = { open: '#a1a1aa', active: '#f59e0b', done: '#10b981' } as const;
/**
 * Where a ticket is, as Linear draws it: a dashed ring for waiting, a ring that fills up through the stages being
 * worked on, a tick for finished (and a cross for "closed").
 */
export function StageDot({
  kind,
  stageKey,
  size = 16,
  className,
}: {
  kind: Stage['kind'];
  stageKey?: string;
  size?: number;
  className?: string;
}) {
  const color = stageKey === 'closed' ? '#71717a' : KIND_COLOR[kind];
  const same = ORDER.filter((x) => x.kind === 'active');
  const at = same.findIndex((x) => x.key === stageKey);
  const f = kind === 'active' ? (at < 0 ? 0.5 : (at + 1) / (same.length + 1)) : 0;
  const a = f * Math.PI * 2;
  const [x, y] = [8 + 3 * Math.sin(a), 8 - 3 * Math.cos(a)];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cx('shrink-0', className)}
      aria-hidden
    >
      {kind === 'open' && (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeDasharray="2 2"
        />
      )}
      {kind === 'active' && (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.6" />
          <path
            d={`M8 8 L8 5 A3 3 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`}
            fill={color}
          />
        </>
      )}
      {kind === 'done' && (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          {stageKey === 'closed' ? (
            <path
              d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"
              stroke="#fff"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M4.8 8.2l2.2 2.2 4.2-4.4"
              fill="none"
              stroke="#fff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </>
      )}
    </svg>
  );
}
export function StagePill({ stage }: { stage: Stage | null }) {
  if (!stage) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-zinc-700">
      <StageDot kind={stage.kind} stageKey={stage.key} /> {stage.label}
    </span>
  );
}

const BARS: Record<Priority, number> = { low: 1, normal: 2, high: 3, urgent: 4 };
export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};
/** How pressing it is, as Linear draws it: bars, and a red mark for urgent. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === 'urgent')
    return (
      <span
        className={cx(
          'inline-flex size-4 items-center justify-center bg-red-600 text-[10px] leading-none font-bold text-white',
          className,
        )}
        title="Urgent"
        aria-label="Urgent"
      >
        !
      </span>
    );
  return (
    <span
      className={cx('inline-flex size-4 items-end gap-[2px]', className)}
      title={PRIORITY_LABEL[priority]}
      aria-label={PRIORITY_LABEL[priority]}
    >
      {[1, 2, 3].map((n) => (
        <i
          key={n}
          className={cx('w-[3px]', n <= BARS[priority] ? 'bg-zinc-600' : 'bg-zinc-300')}
          style={{ height: `${n * 4 + 2}px` }}
        />
      ))}
    </span>
  );
}

export function LabelChip({ label, onRemove }: { label: SupportLabel; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs whitespace-nowrap text-zinc-700">
      <span className="size-1.5 rounded-full" style={{ background: label.color }} /> {label.label}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label.label}`}
          onClick={onRemove}
          className="text-zinc-400 hover:text-ink"
        >
          ×
        </button>
      )}
    </span>
  );
}
export const labelsOf = (desk: HelpDeskConfig | undefined, keys: string[]): SupportLabel[] =>
  keys.flatMap((k) => desk?.labels.find((l) => l.key === k) ?? []);

const HUES = [
  '#0f62fe',
  '#007d79',
  '#8a3ffc',
  '#d12771',
  '#b28600',
  '#198038',
  '#da1e28',
  '#0072c3',
];
/** A person as their initials on a colour that stays theirs. */
export function Avatar({
  name,
  size = 22,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  const hue = HUES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]!;
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        className,
      )}
      style={{ width: size, height: size, background: hue, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** A file that came with a message, opened with the sign-in token. */
export async function openSupportFile(id: string) {
  const url = URL.createObjectURL(await api.supportFile(id));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A small round colour, as an option's icon (cached, so a list does not remount it on every render). */
const dots = new Map<string, ComponentType<{ className?: string }>>();
export function dotIcon(color: string): ComponentType<{ className?: string }> {
  let c = dots.get(color);
  if (!c) {
    c = ({ className }) => (
      <span
        className={cx('inline-block size-2.5 rounded-full', className)}
        style={{ background: color }}
      />
    );
    dots.set(color, c);
  }
  return c;
}
const stageIcons = new Map<string, ComponentType<{ className?: string }>>();
/** The stage's icon for a menu (drawn from where the stage sits among the others). */
export function stageIcon(
  kind: Stage['kind'],
  key?: string,
): ComponentType<{ className?: string }> {
  const id = `${kind}:${key ?? ''}:${ORDER.map((o) => o.key).join(',')}`;
  let c = stageIcons.get(id);
  if (!c) {
    c = ({ className }) => <StageDot kind={kind} stageKey={key} className={className} />;
    stageIcons.set(id, c);
  }
  return c;
}
const prioIcons = new Map<Priority, ComponentType<{ className?: string }>>();
export function priorityIcon(p: Priority): ComponentType<{ className?: string }> {
  let c = prioIcons.get(p);
  if (!c) {
    c = () => <PriorityIcon priority={p} />;
    prioIcons.set(p, c);
  }
  return c;
}

/** What a ready-made reply can carry: write the code, and the ticket's own detail takes its place when the reply is used. */
export interface ReplyContext {
  person: { name: string; email: string | null; phone: string | null };
  ticket: {
    number: number;
    subject: string;
    project: string | null;
    stage: string;
    priority: string;
  };
  agent: string;
  organisation: string;
}
export const REPLY_FIELDS: { code: string; label: string; value(c: ReplyContext): string }[] = [
  {
    code: '{name}',
    label: 'Their first name',
    value: (c) => c.person.name.split(' ')[0] ?? c.person.name,
  },
  { code: '{fullName}', label: 'Their full name', value: (c) => c.person.name },
  { code: '{email}', label: 'Their email', value: (c) => c.person.email ?? '' },
  { code: '{phone}', label: 'Their phone number', value: (c) => c.person.phone ?? '' },
  { code: '{ticket}', label: 'Ticket number', value: (c) => `#${c.ticket.number}` },
  { code: '{subject}', label: 'Ticket subject', value: (c) => c.ticket.subject },
  { code: '{project}', label: 'The project it came from', value: (c) => c.ticket.project ?? '' },
  { code: '{stage}', label: 'Its stage', value: (c) => c.ticket.stage },
  { code: '{priority}', label: 'Its priority', value: (c) => c.ticket.priority },
  { code: '{agent}', label: 'Your full name', value: (c) => c.agent },
  {
    code: '{agentFirst}',
    label: 'Your first name',
    value: (c) => c.agent.split(' ')[0] ?? c.agent,
  },
  { code: '{organisation}', label: 'Your organisation', value: (c) => c.organisation },
  {
    code: '{date}',
    label: 'Today’s date',
    value: () =>
      new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
  },
];
/** A reply with its codes replaced by this ticket's detail. */
export const fillReply = (body: string, c: ReplyContext) =>
  REPLY_FIELDS.reduce((text, f) => text.replaceAll(f.code, f.value(c)), body);

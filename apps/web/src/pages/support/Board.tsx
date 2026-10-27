import type { HelpDeskConfig, TicketSummary } from '@grids/schema';
import { cx } from '@grids/ui';
import { Building2, Globe2, MoreHorizontal, Network, OctagonX, Plus } from 'lucide-react';
import { useState } from 'react';
import { Avatar, PRIORITY_LABEL, PriorityIcon, StageDot, dotIcon, labelsOf } from './shared';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(new Date(iso).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
  });

/** A small rounded pill, like the property chips on a Linear card. */
const Pill = ({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) => (
  <span
    title={title}
    className={cx(
      'inline-flex h-7 max-w-full items-center gap-1.5 pe-2.5 text-[13px] text-zinc-600',
      className,
    )}
  >
    {children}
  </span>
);

/** One card, as Linear draws it: the number and who has it, the title with its stage, the properties as pills, and when it came. */
function Card({
  t,
  desk,
  onOpen,
  dragging,
}: {
  t: TicketSummary;
  desk: HelpDeskConfig | undefined;
  onOpen(): void;
  dragging: boolean;
}) {
  const labels = labelsOf(desk, t.labels);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => (
        e.dataTransfer.setData('text/plain', t.id),
        (e.dataTransfer.effectAllowed = 'move')
      )}
      onClick={onOpen}
      className={cx(
        'block w-full border border-zinc-200/80 bg-snow px-3.5 pt-3 pb-3 text-start shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-shadow hover:shadow-[0_4px_14px_rgb(16_24_40/0.08)]',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-2 text-[13px] text-zinc-500">
        <span className="font-mono">#{t.number}</span>
        {t.audience === 'platform' && (
          <Building2 className="size-3.5 text-violet-500" aria-label="With the Grids team" />
        )}
        {t.channel === 'help' && (
          <Globe2 className="size-3.5 text-sky-500" aria-label="From the help window" />
        )}
        <span className="ms-auto">
          {t.assignee ? (
            <Avatar name={t.assignee.name} size={22} />
          ) : (
            <span
              className="inline-block size-[22px] rounded-full border border-dashed border-zinc-300"
              title="Unassigned"
            />
          )}
        </span>
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        {t.stage && (
          <StageDot kind={t.stage.kind} stageKey={t.stage.key} size={18} className="mt-0.5" />
        )}
        <span className="line-clamp-3 text-[15px] leading-snug font-medium">{t.subject}</span>
      </div>
      <p
        className={cx(
          'mt-1.5 line-clamp-2 text-[13px] leading-snug',
          t.stage && 'ps-[26px]',
          t.excerpt ? 'text-zinc-600' : 'text-zinc-400 italic',
        )}
      >
        {t.excerpt || 'No description available yet'}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill
          title={`${PRIORITY_LABEL[t.priority]} priority`}
          // Under the stage dot, so "Created" starts where the title and description do.
          className={cx('pe-0', t.stage && '-me-1 w-[18px] justify-center')}
        >
          <PriorityIcon priority={t.priority} />
        </Pill>
        <span className="text-[13px] text-zinc-400">Created {when(t.createdAt)}</span>
        {t.subTotal > 0 && (
          <Pill title={`${t.subDone} of ${t.subTotal} sub-issues done`} className="pe-0">
            <Network className="size-3.5" /> {t.subDone}/{t.subTotal}
          </Pill>
        )}
        {t.blockedBy > 0 && (
          <Pill
            title={`Blocked by ${t.blockedBy} open ${t.blockedBy === 1 ? 'ticket' : 'tickets'}`}
            className="pe-0 text-red-700"
          >
            <OctagonX className="size-3.5" /> {t.blockedBy}
          </Pill>
        )}
      </div>
      {labels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-1 gap-y-0.5">
          {labels.slice(0, 3).map((l) => (
            <Pill key={l.key}>
              {(() => {
                const Dot = dotIcon(l.color);
                return <Dot className="size-2.5" />;
              })()}
              <span className="truncate">{l.label}</span>
            </Pill>
          ))}
          {labels.length > 3 && <Pill>+{labels.length - 3}</Pill>}
        </div>
      )}
    </button>
  );
}

/** The tickets as a board: a column for each stage; drag a card to another column to change its stage. */
export function Board({
  items,
  desk,
  show,
  onOpen,
  onMove,
  onCreate,
}: {
  items: TicketSummary[];
  desk: HelpDeskConfig | undefined;
  show: (kind: 'open' | 'active' | 'done') => boolean;
  onOpen(t: TicketSummary): void;
  onMove(t: TicketSummary, stage: string): void;
  onCreate?: () => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const stages = (desk?.stages ?? []).filter((s) => show(s.kind));
  return (
    <div className="flex items-stretch gap-4 overflow-x-auto" role="list" aria-label="Board">
      {stages.map((s) => {
        const col = items.filter((t) => (t.stage?.key ?? '') === s.key);
        return (
          <section
            key={s.key}
            role="listitem"
            aria-label={s.label}
            onDragOver={(e) => (e.preventDefault(), setOver(s.key))}
            onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const t = items.find((x) => x.id === e.dataTransfer.getData('text/plain'));
              setOver(null);
              setDrag(null);
              if (t && t.stage?.key !== s.key) onMove(t, s.key);
            }}
            onDragEnd={() => (setDrag(null), setOver(null))}
            className={cx(
              'flex w-[22rem] shrink-0 flex-col bg-zinc-100/70 px-2 pb-2 transition-colors',
              over === s.key && 'bg-accent-50 ring-2 ring-accent-500/30',
            )}
          >
            <h3 className="flex items-center gap-2.5 px-2.5 py-3 text-[15px] font-medium">
              <StageDot kind={s.kind} stageKey={s.key} size={18} /> {s.label}{' '}
              <span className="num text-zinc-400">{col.length}</span>
              <span className="ms-auto flex items-center text-zinc-400">
                <MoreHorizontal className="size-4" aria-hidden />
                {onCreate && s.kind !== 'done' && (
                  <button
                    type="button"
                    aria-label={`New ticket in ${s.label}`}
                    onClick={onCreate}
                    className="ms-2 rounded-full p-1 hover:bg-zinc-200/70 hover:text-ink"
                  >
                    <Plus className="size-4" />
                  </button>
                )}
              </span>
            </h3>
            <ul
              className="flex-1 space-y-2.5"
              onDragStart={(e) =>
                setDrag((e.target as HTMLElement).closest('li')?.dataset.id ?? null)
              }
            >
              {col.map((t) => (
                <li key={t.id} data-id={t.id}>
                  <Card t={t} desk={desk} onOpen={() => onOpen(t)} dragging={drag === t.id} />
                </li>
              ))}
              {!col.length && (
                <li className="px-2 py-6 text-center text-sm text-zinc-400">Drop a ticket here</li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

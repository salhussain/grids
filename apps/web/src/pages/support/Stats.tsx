import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TicketStats } from '@grids/schema';
import { ErrorNotice, Loading, cx, relTime, useLiveInterval } from '@grids/ui';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Flag,
  Inbox,
  Tag,
  UserRound,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import { Avatar, PRIORITY_LABEL, PriorityIcon, StageDot, labelsOf, useDesk } from './shared';

const Card = ({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={cx('rounded-xl bg-zinc-50 p-4', className)}>
    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-500">
      <Icon className="size-4" /> {title}
    </h3>
    {children}
  </section>
);
const Kpi = ({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
}) => (
  <div className="rounded-xl bg-zinc-50 p-4">
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <Icon className="size-4" /> {label}
    </div>
    <div className="num mt-1 text-3xl font-semibold tracking-tight">{value}</div>
    {hint && <div className="mt-0.5 text-xs text-zinc-400">{hint}</div>}
  </div>
);
/** A row with a bar sized against the largest in its list. */
const Bar = ({
  icon,
  label,
  n,
  max,
  color = 'bg-accent-500',
}: {
  icon?: React.ReactNode;
  label: string;
  n: number;
  max: number;
  color?: string;
}) => (
  <li className="flex items-center gap-3 text-sm">
    <span className="flex w-44 min-w-0 items-center gap-2">
      {icon}
      <span className="truncate">{label}</span>
    </span>
    <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
      <span
        className={cx('block h-full rounded-full', color)}
        style={{ width: `${max ? Math.max(3, (n / max) * 100) : 0}%`, opacity: n ? 1 : 0 }}
      />
    </span>
    <span className="num w-8 text-end text-zinc-600">{n}</span>
  </li>
);

/** Overview tab: how the organisation's tickets stand. */
export function StatsPanel() {
  const id = useWorkspace().tenant.id;
  const live = useLiveInterval();
  const desk = useDesk(id);
  const q = useQuery({
    queryKey: ['ticket-stats', id],
    queryFn: () => api.ticketStats(id),
    refetchInterval: live,
  });
  if (q.isPending) return <Loading />;
  if (q.error || !q.data) return <ErrorNotice error={q.error} />;
  const s: TicketStats = q.data;
  const peak = Math.max(1, ...s.days.flatMap((d) => [d.opened, d.finished]));
  const labels = labelsOf(
    desk.data,
    s.byLabel.map((l) => l.key),
  );
  const labelCount = new Map(s.byLabel.map((l) => [l.key, l.count]));
  return (
    <div className="space-y-4">
      {s.partial && (
        <p className="text-xs text-zinc-500">Counting the most recent 2,000 tickets.</p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={CircleDot} label="Open" value={s.open} hint={`${s.total} in all`} />
        <Kpi icon={UserRound} label="Unassigned" value={s.unassigned} hint="open, nobody has it" />
        <Kpi icon={AlertTriangle} label="Urgent" value={s.urgent} hint="open and urgent" />
        <Kpi icon={CheckCircle2} label="Finished" value={s.done} hint="resolved or closed" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Last 14 days" icon={CalendarDays}>
          <div
            className="flex h-32 items-end gap-1.5"
            role="img"
            aria-label="Tickets opened and finished each day"
          >
            {s.days.map((d) => (
              <div
                key={d.day}
                className="flex h-full flex-1 items-end justify-center gap-0.5"
                title={`${d.day}: ${d.opened} opened, ${d.finished} finished`}
              >
                <span
                  className="w-full max-w-2.5 rounded-t bg-accent-500"
                  style={{ height: `${(d.opened / peak) * 100}%` }}
                />
                <span
                  className="w-full max-w-2.5 rounded-t bg-emerald-400"
                  style={{ height: `${(d.finished / peak) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-accent-500" /> Opened{' '}
              {s.days.reduce((n, d) => n + d.opened, 0)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-emerald-400" /> Finished{' '}
              {s.days.reduce((n, d) => n + d.finished, 0)}
            </span>
          </div>
        </Card>
        <Card title="By stage" icon={CircleDashed}>
          <ul className="space-y-2">
            {s.byStage.map((x) => (
              <Bar
                key={x.key}
                icon={<StageDot kind={x.kind} stageKey={x.key} />}
                label={x.label}
                n={x.count}
                max={Math.max(...s.byStage.map((y) => y.count))}
              />
            ))}
          </ul>
        </Card>
        <Card title="Open by priority" icon={Flag}>
          <ul className="space-y-2">
            {s.byPriority.map((x) => (
              <Bar
                key={x.priority}
                icon={<PriorityIcon priority={x.priority} />}
                label={PRIORITY_LABEL[x.priority]}
                n={x.count}
                max={Math.max(...s.byPriority.map((y) => y.count))}
                color={x.priority === 'urgent' ? 'bg-red-500' : 'bg-zinc-500'}
              />
            ))}
          </ul>
        </Card>
        <Card title="Open by person" icon={UserRound}>
          {s.byAssignee.length ? (
            <ul className="space-y-2">
              {s.byAssignee.map((x) => (
                <Bar
                  key={x.id ?? 'none'}
                  icon={
                    x.id ? (
                      <Avatar name={x.name} size={18} />
                    ) : (
                      <span className="size-[18px] rounded-full border border-dashed border-zinc-300" />
                    )
                  }
                  label={x.name}
                  n={x.count}
                  max={s.byAssignee[0]!.count}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-400">Nothing open.</p>
          )}
        </Card>
        <Card title="Open by label" icon={Tag}>
          {labels.length ? (
            <ul className="space-y-2">
              {labels.map((l) => (
                <Bar
                  key={l.key}
                  icon={<i className="size-2.5 rounded-full" style={{ background: l.color }} />}
                  label={l.label}
                  n={labelCount.get(l.key) ?? 0}
                  max={s.byLabel[0]!.count}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-400">No labels on open tickets.</p>
          )}
        </Card>
        <Card title="Where open tickets come from" icon={Inbox}>
          <ul className="space-y-2">
            <Bar
              label="Your team"
              n={s.byChannel.member}
              max={Math.max(1, s.byChannel.member, s.byChannel.help)}
            />
            <Bar
              label="Help window"
              n={s.byChannel.help}
              max={Math.max(1, s.byChannel.member, s.byChannel.help)}
            />
          </ul>
          {s.oldest && (
            <p className="mt-4 text-sm text-zinc-500">
              Oldest open:{' '}
              <Link
                to="/o/$tenantId/support/$ticketId"
                params={{ tenantId: id, ticketId: s.oldest.id }}
                className="text-accent-700 hover:underline"
              >
                #{s.oldest.number} {s.oldest.subject}
              </Link>{' '}
              ({relTime(s.oldest.createdAt)})
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

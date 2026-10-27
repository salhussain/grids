import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Empty, ErrorNotice, Loading, PageHeader } from '@grids/ui';
import { CheckCircle2, MapPin } from 'lucide-react';
import { api } from '../api';
import { iconOf } from './projects/context';
import { Due, PriorityMark, StatePill } from './projects/WorkTab';
import { useWorkspace } from '../session';

/** Work given to the person, from every project: what is late, what is due soon, and the rest. */
export function MyWorkPage() {
  const ws = useWorkspace();
  const work = useQuery({ queryKey: ['my-work', ws.tenant.id], queryFn: () => api.myWork(ws.tenant.id), refetchInterval: 60_000 });
  const items = work.data ?? [];
  const day = 86_400_000;
  const now = Date.now();
  const groups = [
    { title: 'Overdue', tone: 'text-red-700', items: items.filter((w) => w.overdue) },
    { title: 'Due in the next week', tone: '', items: items.filter((w) => !w.overdue && w.dueAt && new Date(w.dueAt).getTime() - now < 7 * day) },
    { title: 'Later', tone: '', items: items.filter((w) => !w.overdue && w.dueAt && new Date(w.dueAt).getTime() - now >= 7 * day) },
    { title: 'No due date', tone: '', items: items.filter((w) => !w.dueAt) },
  ].filter((g) => g.items.length);
  return (
    <div>
      <PageHeader eyebrow="Work" title="My work" meta="What is waiting on you, across every project." />
      <ErrorNotice error={work.error} />
      {work.isPending ? (
        <Loading />
      ) : !items.length ? (
        <div className="border border-zinc-200 bg-snow">
          <Empty icon={CheckCircle2} title="You are all caught up">
            Tickets, tasks and visits given to you appear here.
          </Empty>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className={`mb-2 text-xs font-semibold tracking-[0.1em] uppercase ${g.tone || 'text-zinc-500'}`}>
                {g.title} · {g.items.length}
              </h2>
              <ul className="divide-y divide-zinc-100 border border-zinc-200 bg-snow">
                {g.items.map((w) => {
                  const I = iconOf(w.type.icon);
                  return (
                    <li key={w.id}>
                      <Link to={`/o/${ws.tenant.id}/p/${w.project.key}/work`} search={{ item: w.id } as never} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 hover:bg-zinc-50">
                        <span className="flex size-8 items-center justify-center text-white" style={{ background: w.type.color }}>
                          <I className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="shrink-0 font-mono text-xs text-zinc-500">{w.ref}</span>
                            <span className="truncate font-medium">{w.title}</span>
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                            <span className="inline-flex items-center gap-1.5">
                              <i className="size-2 rounded-full" style={{ background: w.project.color }} /> {w.project.name}
                            </span>
                            <PriorityMark priority={w.priority} />
                            {w.entity && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="size-3.5" /> {w.entity.name}
                              </span>
                            )}
                            <Due at={w.dueAt} late={w.overdue} />
                          </span>
                        </span>
                        <StatePill state={w.state} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

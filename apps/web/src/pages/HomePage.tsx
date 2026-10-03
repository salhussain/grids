import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PageHeader, Panel, Stat, cx, relTime } from '@grids/ui';
import type { Inbox} from 'lucide-react';
import { AlertTriangle, ArrowRight, ClipboardCheck, FolderKanban, KeyRound, LifeBuoy, MailPlus, Network, PencilRuler, Users } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { useCan, useMe, useWorkspace } from '../session';
import { Chart, type ChartOption } from '@grids/viz';
import { FreshnessBadge } from '@grids/viz';
import { brandColor, INK, useScheme } from '@grids/viz';
import { iconOf } from './projects/context';

const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : null);
const humanAction = (a: string) => a.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The organisation's home: what is happening, what needs attention, where to go next. */
export function HomePage() {
  const ws = useWorkspace();
  const me = useMe();
  const can = useCan();
  const t = useT();
  const id = ws.tenant.id;
  const admin = ws.me.role === 'org_admin';
  const insights = useQuery({ queryKey: ['insights', id], queryFn: () => api.insights(id), refetchInterval: 60_000 });
  const projects = useQuery({ queryKey: ['projects', id, false], queryFn: () => api.projects(id, false) });
  const activity = useQuery({ queryKey: ['activity', id, 'home'], queryFn: () => api.activity(id, { page: 1, pageSize: 8 }), enabled: can('audit.view') });
  const billing = useQuery({ queryKey: ['billing', id], queryFn: () => api.billing(id), enabled: can('billing.view') });
  const name = (me.displayName ?? me.email ?? '').split(' ')[0];
  const i = insights.data;
  const change = i ? pct(i.submissions30, i.submissionsPrev30) : null;

  const attention = [
    i?.toReview ? { icon: ClipboardCheck, text: `${i.toReview} submission${i.toReview === 1 ? '' : 's'} waiting for review`, to: `/o/${id}/inbox`, tone: 'warn' } : null,
    i?.tickets.internalOpen && can('support.manage') ? { icon: LifeBuoy, text: `${i.tickets.internalOpen} open internal ticket${i.tickets.internalOpen === 1 ? '' : 's'}`, to: `/o/${id}/support`, tone: 'warn' } : null,
    i?.projects.stale ? { icon: AlertTriangle, text: `${i.projects.stale} project${i.projects.stale === 1 ? ' has' : 's have'} stale data`, to: `/o/${id}/projects`, tone: 'bad' } : null,
    i?.members.invited && can('people.view', { anywhere: true }) ? { icon: MailPlus, text: `${i.members.invited} invitation${i.members.invited === 1 ? '' : 's'} not yet accepted`, to: `/o/${id}/people`, tone: 'info' } : null,
    i?.projects.draft && admin ? { icon: PencilRuler, text: `${i.projects.draft} draft project${i.projects.draft === 1 ? '' : 's'} not live yet`, to: `/o/${id}/projects`, tone: 'info' } : null,
    billing.data?.outstanding.overdue ? { icon: AlertTriangle, text: `${billing.data.outstanding.overdue} overdue invoice${billing.data.outstanding.overdue === 1 ? '' : 's'}`, to: `/o/${id}/billing`, tone: 'bad' } : null,
  ].filter((x): x is { icon: typeof Inbox; text: string; to: string; tone: string } => !!x);

  return (
    <>
      <PageHeader
        eyebrow={ws.tenant.name}
        title={name ? t('web.home.welcomeName', { name }) : t('web.home.welcome')}
        meta={ws.theme.welcomeMessage ? <span>{ws.theme.welcomeMessage}</span> : <span>{t('web.home.plan', { plan: ws.tenant.planName ?? '—' })}</span>}
      />
      <div className="stat-strip mb-6 grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200 md:grid-cols-3 xl:grid-cols-5 [&>*]:border-0">
        <Stat label={t('web.home.people')} value={i ? i.members.active.toLocaleString() : '–'} sub={i ? t('web.home.invitationsPending', { count: i.members.invited }) : undefined} />
        <Stat label={t('web.home.projects')} value={i ? (i.projects.live + i.projects.draft).toLocaleString() : '–'} sub={i ? `${i.projects.live} live · ${i.projects.draft} draft` : undefined} tone={i?.projects.stale ? 'warn' : undefined} />
        <Stat label="Submissions (30 days)" value={i ? i.submissions30.toLocaleString() : '–'} sub={change === null ? 'No earlier period' : `${change > 0 ? '+' : ''}${change}% vs previous 30 days`} />
        <Stat label="Data points (30 days)" value={i ? i.observations30.toLocaleString() : '–'} sub={i ? `${i.entities.toLocaleString()} entities` : undefined} />
        <Stat label={t('web.home.tickets')} value={i ? (i.tickets.internalOpen + i.tickets.platformOpen).toLocaleString() : '–'} sub={i ? `${i.tickets.internalOpen} internal · ${i.tickets.platformOpen} with Grids` : undefined} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Submissions per day" description="All projects, last 30 days">
          <div className="h-56">{i && <SubmissionsChart days={i.submissionsByDay} />}</div>
        </Panel>
        <Panel title="Needs attention" flush>
          {attention.length ? (
            <ul>
              {attention.map((a) => (
                <li key={a.text}>
                  <Link to={a.to} className="flex items-center gap-3 border-t border-zinc-100 px-5 py-3 text-sm first:border-t-0 hover:bg-zinc-50">
                    <a.icon className={cx('size-4 shrink-0', a.tone === 'bad' ? 'text-red-600' : a.tone === 'warn' ? 'text-amber-600' : 'text-accent-600')} />
                    <span className="flex-1">{a.text}</span>
                    <ArrowRight className="size-4 text-zinc-400 rtl:rotate-180" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">All clear: nothing needs you right now.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={t('web.home.projects')}
          flush
          actions={
            <Link to="/o/$tenantId/projects" params={{ tenantId: id }} aria-label={t('web.nav.projects')} className="flex size-8 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink">
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          }
        >
          {projects.data?.length ? (
            <ul className="divide-y divide-zinc-200">
              {projects.data.slice(0, 6).map((p) => {
                const Icon = iconOf(p.icon);
                return (
                  <li key={p.id}>
                    <Link to="/o/$tenantId/p/$project" params={{ tenantId: id, project: p.key }} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50">
                      {p.logo ? (
                        <img src={p.logo} alt="" className="size-8 shrink-0 border border-zinc-200 object-contain p-0.5" />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center text-white" style={{ background: p.color }}>
                          <Icon className="size-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {p.name}
                          {p.status === 'draft' && <span className="ms-2 border border-amber-300 bg-amber-50 px-1 py-px text-[10px] font-medium text-amber-800">Draft</span>}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {p.counts.entities.toLocaleString()} entities · {p.counts.dashboards} dashboards · {p.counts.forms} forms
                        </span>
                      </span>
                      <FreshnessBadge value={p.freshness} compact />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Link to="/o/$tenantId/projects" params={{ tenantId: id }} className="flex items-center gap-3 px-5 py-6 text-sm hover:bg-zinc-50">
              <FolderKanban className="size-5 text-accent-600" />
              <span className="flex-1">
                <span className="block font-medium">{t('web.home.projects')}</span>
                <span className="text-xs text-zinc-500">{t('web.home.projectsText')}</span>
              </span>
            </Link>
          )}
        </Panel>
        {can('audit.view') ? (
          <Panel
            title="Recent activity"
            flush
            actions={
              <Link to="/o/$tenantId/activity" params={{ tenantId: id }} aria-label="All activity" className="flex size-8 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            }
          >
            <ol>
              {activity.data?.items.map((a) => (
                <li key={a.id} className="border-t border-zinc-100 px-5 py-2.5 text-sm first:border-t-0">
                  <div className="truncate">{humanAction(a.action)}</div>
                  <div className="text-xs text-zinc-500">
                    {a.actorEmail ?? 'System'} · {relTime(a.at)}
                  </div>
                </li>
              ))}
              {activity.data && !activity.data.items.length && <li className="px-5 py-6 text-center text-sm text-zinc-500">No activity yet.</li>}
            </ol>
          </Panel>
        ) : (
          <Panel title={t('web.home.getStarted')}>
            <ul className="space-y-3 text-sm">
              {[
                { to: 'structure', icon: Network, title: t('web.home.model'), show: true },
                { to: 'people', icon: Users, title: t('web.home.invite'), show: can('people.invite', { anywhere: true }) },
                { to: 'access', icon: KeyRound, title: t('web.home.roles'), show: can('roles.view') },
              ]
                .filter((x) => x.show)
                .map((x) => (
                  <li key={x.to}>
                    <Link to={`/o/${id}/${x.to}`} className="flex items-center gap-2 hover:text-accent-700">
                      <x.icon className="size-4 text-accent-600" /> {x.title}
                    </Link>
                  </li>
                ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}

function SubmissionsChart({ days }: { days: { day: string; count: number }[] }) {
  const scheme = useScheme();
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    return {
      grid: { left: 8, right: 8, top: 12, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: ink.tooltip, borderColor: ink.axis, borderRadius: 0, textStyle: { color: ink.text } },
      xAxis: { type: 'category', data: days.map((d) => d.day.slice(5)), axisLabel: { color: ink.muted, hideOverlap: true }, axisLine: { lineStyle: { color: ink.axis } }, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid } } },
      series: [{ type: 'bar', data: days.map((d) => d.count), itemStyle: { color: brandColor() }, barMaxWidth: 14, name: 'Submissions' }],
    };
  }, [days, scheme]);
  return <Chart option={option} label="Submissions per day" />;
}

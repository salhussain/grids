import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, FolderKanban, KeyRound, LifeBuoy, Network, Users } from 'lucide-react';
import { PageHeader, Panel, Stat, Tag } from '@grids/ui';
import { api } from '../api';
import { useT } from '../i18n';
import { useCan, useMe, useWorkspace } from '../session';
import { FreshnessBadge } from '../viz/Freshness';
import { iconOf } from './projects/context';

export function HomePage() {
  const ws = useWorkspace();
  const me = useMe();
  const can = useCan();
  const t = useT();
  const id = ws.tenant.id;
  const people = useQuery({
    queryKey: ['members', id],
    queryFn: () => api.members(id),
    enabled: can('people.view', { anywhere: true }),
  });
  const units = useQuery({ queryKey: ['units', id], queryFn: () => api.units(id) });
  const tickets = useQuery({
    queryKey: ['tickets', id, { status: 'active' }],
    queryFn: () => api.tickets(id, { status: 'active', pageSize: 5 }),
    enabled: can('support.view'),
  });
  const projects = useQuery({ queryKey: ['projects', id, false], queryFn: () => api.projects(id, false) });
  const name = (me.displayName ?? me.email ?? '').split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={ws.tenant.name}
        title={name ? t('web.home.welcomeName', { name }) : t('web.home.welcome')}
        meta={
          ws.theme.welcomeMessage ? (
            <span>{ws.theme.welcomeMessage}</span>
          ) : (
            <span>{t('web.home.plan', { plan: ws.tenant.planName ?? '—' })}</span>
          )
        }
      />
      <div className="stat-strip mb-6 grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200 lg:grid-cols-3 [&>*]:border-0">
        <Stat
          label={t('web.home.people')}
          value={people.data ? people.data.members.length : '–'}
          sub={
            people.data
              ? t('web.home.invitationsPending', { count: people.data.invitations.length })
              : t('web.home.peopleHidden')
          }
        />
        <Stat
          label={t('web.home.units')}
          value={units.data?.length ?? '–'}
          sub={t('web.home.levels', {
            count: new Set(units.data?.map((u) => u.levelLabel).filter(Boolean)).size || 0,
          })}
        />
        <Stat label={t('web.home.tickets')} value={tickets.data?.total ?? '–'} />
      </div>
      {!!projects.data?.length && (
        <Panel
          className="mb-6"
          title={t('web.home.projects')}
          flush
          actions={
            <Link to="/o/$tenantId/projects" params={{ tenantId: id }} aria-label={t('web.nav.projects')} className="flex size-8 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink">
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          }
        >
          <ul className="divide-y divide-zinc-200">
            {projects.data.slice(0, 5).map((p) => {
              const Icon = iconOf(p.icon);
              return (
                <li key={p.id}>
                  <Link to="/o/$tenantId/p/$project" params={{ tenantId: id, project: p.key }} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50">
                    <span className="flex size-8 shrink-0 items-center justify-center text-white" style={{ background: p.color }}>
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      {p.description && <span className="block truncate text-xs text-zinc-500">{p.description}</span>}
                    </span>
                    <FreshnessBadge value={p.freshness} compact />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={t('web.home.getStarted')}>
          <ul className="grid gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-2">
            {[
              {
                to: 'structure',
                icon: Network,
                title: t('web.home.model'),
                text: t('web.home.modelText'),
                show: true,
              },
              {
                to: 'people',
                icon: Users,
                title: t('web.home.invite'),
                text: t('web.home.inviteText'),
                show: can('people.invite', { anywhere: true }),
              },
              {
                to: 'access',
                icon: KeyRound,
                title: t('web.home.roles'),
                text: t('web.home.rolesText'),
                show: can('roles.view'),
              },
              {
                to: 'support',
                icon: LifeBuoy,
                title: t('web.home.help'),
                text: t('web.home.helpText'),
                show: can('support.create'),
              },
            ]
              .filter((x) => x.show)
              .map((x) => (
                <li key={x.to} className="bg-snow">
                  <Link to={`/o/${id}/${x.to}`} className="flex gap-3 p-4 hover:bg-zinc-50">
                    <x.icon className="mt-0.5 size-5 shrink-0 text-accent-600" />
                    <div>
                      <div className="text-sm font-medium">{x.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{x.text}</div>
                    </div>
                  </Link>
                </li>
              ))}
            <li className="bg-snow sm:col-span-2">
              <Link to={`/o/${id}/projects`} className="flex gap-3 p-4 hover:bg-zinc-50">
                <FolderKanban className="mt-0.5 size-5 shrink-0 text-accent-600" />
                <div>
                  <div className="text-sm font-medium">{t('web.home.projects')}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{t('web.home.projectsText')}</div>
                </div>
              </Link>
            </li>
          </ul>
        </Panel>
        <Panel title={t('web.home.yourAccess')}>
          <p className="text-sm">
            <span className="font-medium">
              {ws.me.role === 'org_admin' ? t('web.shell.orgAdmin') : t('web.shell.member')}
            </span>
            <span className="text-zinc-500">
              {' '}
              · {t('web.home.orgWide', { count: ws.me.permissions.length })}
            </span>
          </p>
          {ws.me.scoped.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-zinc-500">
                {t('web.home.withinPart')}
              </div>
              <ul className="space-y-1.5 text-sm">
                {groupByUnit(ws.me.scoped).map(([unit, perms]) => (
                  <li key={unit}>
                    <span className="font-medium">{unit}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {perms.map((p) => (
                        <Tag key={p}>{p}</Tag>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function groupByUnit(scoped: { permission: string; orgUnitName: string }[]): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const s of scoped) m.set(s.orgUnitName, [...(m.get(s.orgUnitName) ?? []), s.permission]);
  return [...m.entries()];
}

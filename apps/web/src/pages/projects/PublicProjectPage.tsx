import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ErrorNotice, Spinner } from '@grids/ui';
import { useEffect, useMemo } from 'react';
import { api } from '../../api';
import { Explorer, SupportWidget } from '@grids/viz';
import { publicSource } from '../../explorer/source';
import { usePublicEvents } from '../../live';
import { applyTheme, tabTitle } from '../../theme';
import { LiveIndicator } from '@grids/viz';
import { visitorSupport } from '../../support/clients';

/** Anonymous, read-only explorer of a public project (spec §13): public overlays and dashboards only. */
export function PublicProjectPage() {
  const { tenant, project } = useParams({ strict: false }) as { tenant: string; project: string };
  const view = useQuery({ queryKey: ['public', tenant, project], queryFn: () => api.publicProject(tenant, project), retry: false });
  const live = usePublicEvents(tenant, project);
  useEffect(() => {
    if (!view.data) return;
    const t = view.data.tenant;
    applyTheme({ primaryColor: view.data.project.color || t.primaryColor, favicon: t.favicon, logo: t.logo, chartColors: t.chartColors } as never);
    document.title = `${view.data.project.name} · ${t.name}`;
  }, [view.data]);
  const support = useMemo(() => visitorSupport(tenant), [tenant]);
  const source = useMemo(() => (view.data ? publicSource(tenant, project, view.data.dashboards, view.data.elements) : null), [tenant, project, view.data]);

  if (view.isPending)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  if (view.isError || !source)
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorNotice error={view.error} />
      </div>
    );
  const v = view.data;
  return (
    <>
    <Explorer
      source={source}
      title={v.project.name}
      accent={v.tenant.primaryColor}
      mapStyles={v.tenant.mapStyles}
      subtitle={v.tenant.name}
      helpCorner={v.tenant.helpPosition === 'right'}
      logo={
        v.tenant.logo ? (
          <img src={v.tenant.logo} alt="" className="size-9 rounded-xl object-contain" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-600 font-semibold text-on-accent">{v.tenant.name[0]}</span>
        )
      }
      live={<LiveIndicator status={live} />}
      actions={
        v.tenant.poweredBy || v.tenant.footer ? (
          <span className="hidden px-2 text-xs text-zinc-500 lg:inline">{[v.tenant.footer, v.tenant.poweredBy && 'Powered by Grids'].filter(Boolean).join(' · ')}</span>
        ) : undefined
      }
    />
    <SupportWidget client={support} project={project} side={v.tenant.helpPosition === 'right' ? 'end' : 'start'} className={v.tenant.helpPosition === 'right' ? 'bottom-5!' : undefined} />
    </>
  );
}

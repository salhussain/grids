import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ErrorNotice, Spinner } from '@grids/ui';
import { useEffect, useMemo } from 'react';
import { api } from '../../api';
import { Explorer } from '../../explorer/Explorer';
import { publicSource } from '../../explorer/source';
import { usePublicEvents } from '../../live';
import { applyTheme } from '../../theme';
import { LiveIndicator } from '../../viz/Freshness';

/** Anonymous, read-only explorer of a public project (spec §13): public overlays and dashboards only. */
export function PublicProjectPage() {
  const { tenant, project } = useParams({ strict: false }) as { tenant: string; project: string };
  const view = useQuery({ queryKey: ['public', tenant, project], queryFn: () => api.publicProject(tenant, project), retry: false });
  const live = usePublicEvents(tenant, project);
  useEffect(() => {
    if (!view.data) return;
    applyTheme({ primaryColor: view.data.tenant.primaryColor } as never);
    document.title = `${view.data.project.name} · ${view.data.tenant.name}`;
  }, [view.data]);
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
    <Explorer
      source={source}
      title={v.project.name}
      accent={v.tenant.primaryColor}
      subtitle={v.tenant.name}
      logo={
        v.tenant.logo ? (
          <img src={v.tenant.logo} alt="" className="size-9 rounded-xl object-contain" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-600 font-semibold text-on-accent">{v.tenant.name[0]}</span>
        )
      }
      live={<LiveIndicator status={live} />}
      actions={<span className="hidden px-2 text-xs text-zinc-500 lg:inline">Powered by Grids</span>}
    />
  );
}

import { Link } from '@tanstack/react-router';
import { LayoutGrid, LogOut } from 'lucide-react';
import { useMemo } from 'react';
import { memberSource } from '../../explorer/source';
import { Explorer } from '../../explorer/Explorer';
import { useProjectEvents } from '../../live';
import { BrandMark } from '../../router';
import { useMe, useWorkspace } from '../../session';
import { LiveIndicator } from '../../viz/Freshness';
import { useProject } from './context';

/** A project's default view for members: the map-first explorer. */
export function ProjectExplorer() {
  const { tenantId, project, base, can } = useProject();
  const ws = useWorkspace();
  const me = useMe();
  const live = useProjectEvents(tenantId, project.key);
  const source = useMemo(() => memberSource(tenantId, project.key), [tenantId, project.key]);
  return (
    <Explorer
      source={source}
      title={project.name}
      accent={ws.theme.primaryColor}
      subtitle={ws.theme.appName || ws.tenant.name}
      logo={<BrandMark className="size-9" />}
      live={<LiveIndicator status={live} />}
      emptyOverlays={
        can('manager') ? (
          <>
            No map overlays yet.{' '}
            <Link to={`${base}/overlays`} className="underline hover:text-white">
              Set one up
            </Link>{' '}
            to colour places by an indicator.
          </>
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-1">
          <Link to={`${base}/dashboards`} className="flex h-10 items-center gap-2 px-3 text-sm text-white/85 hover:bg-white/8 hover:text-white">
            <LayoutGrid className="size-4" /> Studio
          </Link>
          <Link to="/o/$tenantId" params={{ tenantId }} className="hidden h-10 items-center gap-2 border-s border-white/10 ps-4 pe-2 text-sm text-white/75 hover:text-white md:flex" title="Back to the workspace">
            <span className="max-w-40 truncate">{me.displayName ?? me.email}</span>
            <span className="text-white/45">|</span>
            <span className="max-w-40 truncate text-white/55">{ws.tenant.name}</span>
            <LogOut className="ms-1 size-4 rotate-180 text-white/45" />
          </Link>
        </div>
      }
    />
  );
}

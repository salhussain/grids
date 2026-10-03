import { Link } from '@tanstack/react-router';
import { LayoutGrid, LogOut } from 'lucide-react';
import { useMemo } from 'react';
import { memberSource } from '../../explorer/source';
import { Explorer } from '@grids/viz';
import { useProjectEvents } from '../../live';
import { BrandMark } from '../../router';
import { useMe, useWorkspace } from '../../session';
import { LiveIndicator } from '@grids/viz';
import { HeaderControls } from '../../prefs';
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
      mapStyles={ws.theme.mapStyles}
      subtitle={ws.theme.appName || ws.tenant.name}
      logo={<BrandMark className="size-9" />}
      live={<LiveIndicator status={live} />}
      emptyOverlays={
        can('manager') ? (
          <>
            No map overlays yet.{' '}
            <Link to={`${base}/overlays`} className="font-medium text-accent-700 underline">
              Set one up
            </Link>{' '}
            to colour places by an indicator.
          </>
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-1">
          <HeaderControls me={me} localization={ws.localization} className="me-1 hidden md:flex" />
          <Link to={base} className="flex h-9 items-center gap-2 rounded-lg bg-ink px-3 text-sm font-medium text-canvas hover:opacity-90">
            <LayoutGrid className="size-4" /> Studio
          </Link>
          <Link to="/o/$tenantId" params={{ tenantId }} className="hidden h-9 items-center gap-2 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-ink lg:flex" title={`Back to ${ws.tenant.name}`}>
            <span className="flex size-6 items-center justify-center bg-zinc-200 text-[11px] font-semibold text-zinc-700">{(me.displayName ?? me.email ?? '?').slice(0, 1).toUpperCase()}</span>
            <span className="max-w-32 truncate">{me.displayName ?? me.email}</span>
            <LogOut className="size-4 rotate-180 text-zinc-400" />
          </Link>
        </div>
      }
    />
  );
}

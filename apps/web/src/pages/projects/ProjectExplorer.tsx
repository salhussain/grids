import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LayoutGrid, LogOut, X } from 'lucide-react';
import { useMemo } from 'react';
import { memberSource } from '../../explorer/source';
import { Explorer } from '@grids/viz';
import { useProjectEvents } from '../../live';
import { BrandMark } from '../../router';
import { useMe, useWorkspace } from '../../session';
import { LiveIndicator } from '@grids/viz';
import { HeaderControls } from '../../prefs';
import { api } from '../../api';
import { useProject } from './context';

/** A project's default view for members: the map-first explorer. */
/** `onClose`: shown in a pop-up over the studio, so the header closes it instead of linking away. */
export function ProjectExplorer({ onClose }: { onClose?: () => void } = {}) {
  const { tenantId, project, base, can } = useProject();
  const ws = useWorkspace();
  const me = useMe();
  const qc = useQueryClient();
  const saveView = useMutation({ mutationFn: api.setPreferences, onSuccess: (next) => qc.setQueryData(['me'], next) });
  const live = useProjectEvents(tenantId, project.key);
  const source = useMemo(() => memberSource(tenantId, project.key), [tenantId, project.key]);
  return (
    <Explorer
      source={source}
      title={project.name}
      accent={project.color}
      mapStyles={ws.theme.mapStyles}
      subtitle={ws.theme.appName || ws.tenant.name}
      logo={<BrandMark className="size-9" />}
      live={<LiveIndicator status={live} />}
      modeToggle={false}
      savedView={me.preferences.dashboard ?? null}
      onSaveView={(dashboard) => saveView.mutate({ dashboard })}
      reporting={project.reporting}
      layout={project.explorer.layout}
      hideOnLayer={project.explorer.hideOnLayer}
      panelStart={project.explorer.panelStart}
      emptyOverlays={
        can('manager') && !onClose ? (
          <>
            No map overlays yet.{' '}
            <Link to={`${base}/overlays`} className="font-medium text-accent-700 underline">
              Set one up
            </Link>{' '}
            to colour places by an indicator.
          </>
        ) : undefined
      }
      endActions={
        onClose ? (
          <button type="button" onClick={onClose} aria-label="Close preview" className="flex size-9 items-center justify-center text-zinc-500 hover:text-ink" title="Close preview (Esc)">
            <X className="size-5" />
          </button>
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-2">
          <HeaderControls me={me} localization={ws.localization} />
          {onClose ? null : (
            <>
          <Link
            to={base}
            className="flex h-9 items-center gap-2 bg-ink px-3 text-sm font-medium text-canvas hover:opacity-90"
          >
            <LayoutGrid className="size-4" /> <span className="hidden sm:inline">Studio</span>
          </Link>
          <Link
            to="/o/$tenantId"
            params={{ tenantId }}
            className="hidden h-9 items-center gap-2 px-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-ink xl:flex"
            title={`Back to ${ws.tenant.name}`}
          >
            <span className="flex size-6 items-center justify-center bg-zinc-200 text-[11px] font-semibold text-zinc-700">
              {(me.displayName ?? me.email ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-32 truncate">{me.displayName ?? me.email}</span>
            <LogOut className="size-4 rotate-180 text-zinc-400" />
          </Link>
            </>
          )}
        </div>
      }
    />
  );
}

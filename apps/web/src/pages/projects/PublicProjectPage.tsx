import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { applyColorMode, cx, ErrorNotice, Spinner, storedColorMode, type ColorMode } from '@grids/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { usePublicEvents } from '../../live';
import { applyTheme } from '../../theme';
import { WidgetView } from '../../viz/WidgetView';

/** Anonymous, read-only view of a public project's public dashboards (spec §13). */
export function PublicProjectPage() {
  const { tenant, project } = useParams({ strict: false }) as { tenant: string; project: string };
  const view = useQuery({ queryKey: ['public', tenant, project], queryFn: () => api.publicProject(tenant, project), retry: false });
  usePublicEvents(tenant, project);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<ColorMode>(storedColorMode);
  useEffect(() => applyColorMode(mode), [mode]);
  useEffect(() => {
    if (!view.data) return;
    applyTheme({ primaryColor: view.data.tenant.primaryColor } as never);
    document.title = `${view.data.project.name} · ${view.data.tenant.name}`;
  }, [view.data]);

  if (view.isPending)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  if (view.isError)
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorNotice error={view.error} />
      </div>
    );
  const v = view.data;
  const current = v.dashboards.find((d) => d.key === selected) ?? v.dashboards[0];
  return (
    <div className="min-h-full bg-canvas">
      <header className="chrome bg-chrome text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-4 py-4 sm:px-8">
          {v.tenant.logo ? <img src={v.tenant.logo} alt="" className="size-9 object-contain" /> : <span className="flex size-9 items-center justify-center bg-accent-600 font-semibold">{v.tenant.name[0]}</span>}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-400">{v.tenant.name}</div>
            <h1 className="truncate text-lg font-semibold">{v.project.name}</h1>
          </div>
          <div role="radiogroup" aria-label="Appearance" className="flex border border-white/20">
            {(
              [
                ['light', Sun],
                ['dark', Moon],
                ['system', Monitor],
              ] as const
            ).map(([m, Icon]) => (
              <button key={m} role="radio" aria-checked={mode === m} aria-label={m} onClick={() => setMode(m)} className={cx('flex size-8 items-center justify-center', mode === m ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white')}>
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-8">
        {v.project.description && <p className="text-sm text-zinc-600">{v.project.description}</p>}
        {v.dashboards.length > 1 && (
          <div role="tablist" className="flex flex-wrap gap-px border border-zinc-300 bg-zinc-300">
            {v.dashboards.map((d) => (
              <button key={d.key} role="tab" aria-selected={d.key === current?.key} onClick={() => setSelected(d.key)} className={cx('px-3 py-1.5 text-sm', d.key === current?.key ? 'bg-ink text-canvas' : 'bg-snow')}>
                {d.name}
              </button>
            ))}
          </div>
        )}
        {current ? (
          <>
            {current.description && <p className="text-sm text-zinc-600">{current.description}</p>}
            <div className="grid grid-cols-12 gap-4">
              {current.widgets.map((w) => (
                <WidgetView key={w.id} widget={w} queryKey={['public-widget', tenant, project, current.key]} load={() => api.publicWidget(tenant, project, current.key, w.id)} />
              ))}
            </div>
          </>
        ) : (
          <p className="py-16 text-center text-sm text-zinc-500">Nothing is published here yet.</p>
        )}
        <footer className="pt-6 text-center text-xs text-zinc-500">Powered by Grids</footer>
      </main>
    </div>
  );
}

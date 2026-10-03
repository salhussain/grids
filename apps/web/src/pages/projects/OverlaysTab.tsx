import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { MapOverlayInput} from '@grids/schema';
import { AGGREGATIONS, OVERLAY_DISPLAYS, OVERLAY_PALETTES, type MapOverlayDto, type OverlayDisplay, type OverlayGroupDto } from '@grids/schema';
import { Listbox, Button, Dialog, Empty, ErrorNotice, Field, Input, Loading, Select, SwitchField, Textarea, cx, useToast } from '@grids/ui';
import { Box, CircleDot, Flame, Globe, Layers, Map as MapIcon, Pencil, Plus, SquareStack } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { z } from 'zod';
import { api } from '../../api';
import { paletteSwatch } from '@grids/viz';
import { useProject } from './context';
import { GroupTree } from './GroupTree';
import { GroupSelect, LockBadge } from './permissions';

const WINDOWS: [number | null, string][] = [
  [null, 'Latest value per place'],
  [24 * 7, 'Last 7 days'],
  [24 * 28, 'Last 4 weeks'],
  [24 * 7 * 12, 'Last 12 weeks'],
  [24 * 365, 'Last 12 months'],
];
const AGG_LABEL: Record<string, string> = { sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum', count: 'Number of reports', distinct: 'Places reporting', last: 'Latest value' };
const DISPLAY_INFO: Record<OverlayDisplay, { label: string; hint: string; icon: typeof Box }> = {
  shade: { label: 'Shaded areas', hint: 'Colour each place', icon: SquareStack },
  extrude: { label: '3D columns', hint: 'Height by value', icon: Box },
  bubbles: { label: 'Bubbles', hint: 'Size by value', icon: CircleDot },
  heatmap: { label: 'Heatmap', hint: 'Hotspots of many points', icon: Flame },
};
const windowLabel = (h: number | null) => WINDOWS.find(([w]) => w === h)?.[1] ?? `Last ${h} hours`;

/** Studio: the map overlays offered on the project's explorer. */
export function OverlaysTab() {
  const { tenantId, project, can, base } = useProject();
  const list = useQuery({ queryKey: ['overlays', tenantId, project.key], queryFn: () => api.overlays(tenantId, project.key) });
  const [editing, setEditing] = useState<MapOverlayDto | 'new' | null>(null);
  const qc = useQueryClient();
  const groupList = useQuery({ queryKey: ['overlay-groups', tenantId, project.key], queryFn: () => api.overlayGroups(tenantId, project.key) });
  const setGroups = (d: unknown) => {
    qc.setQueryData(['overlay-groups', tenantId, project.key], d);
    void qc.invalidateQueries({ queryKey: ['overlays', tenantId, project.key] });
  };
  const groups = useMemo(() => {
    const m = new Map<string, MapOverlayDto[]>();
    for (const o of list.data ?? []) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()];
  }, [list.data]);

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorNotice error={list.error} />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-zinc-600">
          Overlays colour the places on the explorer map by an indicator. Each place’s value rolls up everything inside it, so the same overlay works at every level.
        </p>
        <div className="flex gap-2">
          <Link to={`${base}/explore`} className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm hover:bg-zinc-50">
            <MapIcon className="size-4" /> Open explorer
          </Link>
          {can('manager') && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              New overlay
            </Button>
          )}
        </div>
      </div>
      {!list.data.length ? (
        <div className="border border-zinc-200 bg-snow">
          <Empty icon={Layers} title="No map overlays yet" action={can('manager') ? <Button icon={Plus} onClick={() => setEditing('new')}>New overlay</Button> : undefined}>
            Pick a data element, how to aggregate it and a colour scale.
          </Empty>
        </div>
      ) : (
        groups.map(([g, items]) => (
          <section key={g}>
            <h2 className="mb-2 text-xs font-semibold tracking-[0.12em] text-zinc-500 uppercase">{g}</h2>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((o) => (
                <li key={o.key} className="group flex flex-col border border-zinc-200 bg-snow p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">{o.name}</h3>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {AGG_LABEL[o.aggregation]} of {o.elementName.toLowerCase()} · {windowLabel(o.hours).toLowerCase()}
                      </p>
                    </div>
                    <LockBadge group={o.permissionGroup} />
                    {o.isPublic && (
                      <span className="inline-flex items-center gap-1 border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600">
                        <Globe className="size-3" /> Public
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex h-2.5">
                    {paletteSwatch(o.palette).map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                    <span>{o.level ? `Shows each ${o.level.replace(/_/g, ' ')}` : 'Shows the places inside the selection'}</span>
                    {can('manager') && (
                      <button type="button" onClick={() => setEditing(o)} className="inline-flex items-center gap-1 text-zinc-600 opacity-70 group-hover:opacity-100 hover:text-ink">
                        <Pencil className="size-3.5" /> Edit
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <GroupTree
        title="Overlay groups"
        description="Levels in the explorer’s overlay picker, e.g. Health › Malaria."
        noun="overlay"
        canEdit={can('manager')}
        error={groupList.error}
        groups={(groupList.data ?? []).map((g) => ({ id: g.id, parentId: g.parentId, name: g.name, count: g.overlayCount }))}
        onSave={async (input, id) => setGroups(await api.saveOverlayGroup(tenantId, project.key, input, id))}
        onDelete={async (id) => setGroups(await api.deleteOverlayGroup(tenantId, project.key, id))}
      />
      {editing && <OverlayEditor overlay={editing === 'new' ? null : editing} groupOptions={groupList.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OverlayEditor({ overlay, groupOptions, onClose }: { overlay: MapOverlayDto | null; groupOptions: OverlayGroupDto[]; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const types = useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
  const [f, setF] = useState<z.input<typeof MapOverlayInput>>(
    overlay ?? { key: '', name: '', group: 'General', groupId: null, element: '', aggregation: 'sum', hours: 24 * 28, level: null, palette: 'heat', display: 'shade', thresholds: [], higherIsBetter: false, unit: '', decimals: 0, isPublic: false, description: '', permissionGroup: null },
  );
  const [breaks, setBreaks] = useState((overlay?.thresholds ?? []).join(', '));
  const parsedBreaks = breaks.trim() ? breaks.split(/[,\s]+/).filter(Boolean).map(Number) : [];
  const badBreaks = parsedBreaks.some((n) => !Number.isFinite(n));
  const save = useMutation({
    mutationFn: () => api.saveOverlay(tenantId, project.key, { ...f, thresholds: parsedBreaks }, overlay?.key),
    onSuccess: (data) => {
      qc.setQueryData(['overlays', tenantId, project.key], data);
      toast('Overlay saved');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteOverlay(tenantId, project.key, overlay!.key),
    onSuccess: (data) => {
      qc.setQueryData(['overlays', tenantId, project.key], data);
      onClose();
    },
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={overlay ? `Edit ${overlay.name}` : 'New map overlay'}
      footer={
        <>
          {overlay && (
            <Button variant="danger" className="me-auto" onClick={() => confirm(`Delete ${overlay.name}?`) && remove.mutate()}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name || !f.key || !f.element || badBreaks}>
            Save overlay
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={save.error ?? remove.error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set({ name: e.target.value, key: overlay ? f.key : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'o_$1') })} />
          </Field>
          <Field label="Group" hint="Set up groups and levels below the overlay list">
            <Listbox
              label="Group"
              value={f.groupId ?? 'none'}
              onChange={(v) => set(v === 'none' ? { groupId: null, group: 'General' } : { groupId: v, group: groupOptions.find((g) => g.id === v)?.path ?? 'General' })}
              options={[{ value: 'none', label: 'General (no group)' }, ...groupOptions.map((g) => ({ value: g.id, label: g.path }))]}
            />
          </Field>
          <Field label="Data element">
            <Select value={f.element} onChange={(e) => set({ element: e.target.value })}>
              <option value="">Choose…</option>
              {elements.data?.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aggregate">
            <Select value={f.aggregation} onChange={(e) => set({ aggregation: e.target.value as typeof f.aggregation })}>
              {AGGREGATIONS.map((a) => (
                <option key={a} value={a}>
                  {AGG_LABEL[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period">
            <Select value={f.hours === null ? '' : String(f.hours)} onChange={(e) => set({ hours: e.target.value ? Number(e.target.value) : null })}>
              {WINDOWS.map(([h, l]) => (
                <option key={l} value={h === null ? '' : h}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Show" hint="Which places get coloured">
            <Select value={f.level ?? ''} onChange={(e) => set({ level: e.target.value || null })}>
              <option value="">The places inside the selection</option>
              {types.data?.map((t) => (
                <option key={t.key} value={t.key}>
                  Every {t.name.toLowerCase()} in the selection
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit">
            <Input value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="e.g. cases" />
          </Field>
          <Field label="Decimals">
            <Input type="number" min={0} max={6} value={f.decimals} onChange={(e) => set({ decimals: Number(e.target.value) })} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Style</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {OVERLAY_DISPLAYS.map((d) => {
              const Icon = DISPLAY_INFO[d].icon;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => set({ display: d })}
                  aria-pressed={(f.display ?? 'shade') === d}
                  className={cx('flex flex-col items-start gap-1.5 rounded-xl border p-3 text-start', (f.display ?? 'shade') === d ? 'border-accent-600 bg-accent-50 ring-1 ring-accent-600' : 'border-zinc-300 hover:border-zinc-400')}
                >
                  <Icon className="size-5 text-accent-600" />
                  <span className="text-sm font-medium">{DISPLAY_INFO[d].label}</span>
                  <span className="text-xs text-zinc-500">{DISPLAY_INFO[d].hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Colour scale</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {OVERLAY_PALETTES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ palette: p })}
                aria-pressed={f.palette === p}
                className={cx('border p-2 text-start text-xs capitalize', f.palette === p ? 'border-accent-600 ring-1 ring-accent-600' : 'border-zinc-300 hover:border-zinc-400')}
              >
                <div className="mb-1.5 flex h-3">
                  {paletteSwatch(p).map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
                {p === 'performance' ? 'Performance (good → bad)' : p}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class breaks" hint="Optional, e.g. 1, 5, 10. Without breaks the scale runs from the lowest to the highest value shown." error={badBreaks ? 'Use numbers separated by commas' : undefined}>
            <Input value={breaks} onChange={(e) => setBreaks(e.target.value)} className="font-mono" />
          </Field>
          <div className="space-y-3 pt-6">
            {f.palette === 'performance' && <SwitchField label="Higher is better" checked={!!f.higherIsBetter} onChange={(v) => set({ higherIsBetter: v })} />}
            <SwitchField label="Public" description={project.visibility === 'public' ? 'Shown on the public explorer' : 'Needs a public project'} checked={!!f.isPublic} onChange={(v) => set({ isPublic: v })} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <GroupSelect value={f.permissionGroup} onChange={(g) => set({ permissionGroup: g })} />
          <Field label="Description">
            <Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} rows={2} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

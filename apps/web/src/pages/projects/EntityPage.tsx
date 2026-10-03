import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button, ErrorNotice, KeyValues, Loading, Panel, Tag, cx, dateTime, relTime } from '@grids/ui';
import { ChevronRight, ClipboardList, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { Chart, type ChartOption } from '../../viz/Chart';
import { MapView } from '../../viz/MapView';
import { brandColor, INK, useScheme } from '../../viz/scheme';
import { iconOf, useProject } from './context';
import { EntityDialog, fmtAttr, useTypes } from './EntitiesTab';

export function EntityPage() {
  const { tenantId, project, base, can } = useProject();
  const { entityId } = useParams({ strict: false }) as { entityId: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const types = useTypes();
  const [editing, setEditing] = useState(false);
  const [element, setElement] = useState<string | null>(null);
  const e = useQuery({ queryKey: ['entity', tenantId, project.key, entityId], queryFn: () => api.entity(tenantId, project.key, entityId) });
  const children = useQuery({
    queryKey: ['entities', tenantId, project.key, 'children', entityId],
    queryFn: () => api.entities(tenantId, project.key, { parentId: entityId, pageSize: 50 }),
  });
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const remove = useMutation({
    mutationFn: () => api.deleteEntity(tenantId, project.key, entityId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['entities', tenantId, project.key] });
      void navigate({ to: `${base}/entities` });
    },
  });
  if (e.isPending) return <Loading />;
  if (e.isError) return <ErrorNotice error={e.error} />;
  const x = e.data;
  const type = types.data?.find((t) => t.key === x.type.key);
  const Icon = iconOf(x.type.icon);
  const subjectForms = forms.data?.filter((f) => f.subjectType?.key === x.type.key && f.currentVersion) ?? [];
  const selected = element ?? x.latest[0]?.element ?? null;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-zinc-500">
        <Link to={`${base}/entities`} className="hover:text-accent-700">
          Entities
        </Link>
        {x.ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 rtl:rotate-180" />
            <Link to={`${base}/entities/${a.id}`} className="hover:text-accent-700">
              {a.name}
            </Link>
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center text-white" style={{ background: x.type.color }}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">{x.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <Tag>{x.type.name}</Tag>
            <span className="font-mono text-xs">{x.code}</span>
            <span>· updated {relTime(x.updatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {subjectForms.map((f) => (
            <Link
              key={f.key}
              to={`${base}/forms/${f.key}/fill`}
              search={{ entity: x.id }}
              className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-600"
            >
              <ClipboardList className="size-4" /> {f.name}
            </Link>
          ))}
          {can('editor') && (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="danger" icon={Trash2} onClick={() => confirm(`Delete ${x.name}?`) && remove.mutate()} loading={remove.isPending}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      <ErrorNotice error={remove.error} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Details">
            <KeyValues
              items={[
                ['Code', <span className="font-mono">{x.code}</span>],
                ['In', x.parent ? <Link to={`${base}/entities/${x.parent.id}`} className="text-accent-700 hover:underline">{x.parent.name}</Link> : '—'],
                ...(type?.attributes ?? []).map((a): [string, React.ReactNode] => [a.label, fmtAttr(a, x.attributes[a.key])]),
              ]}
            />
          </Panel>
          <Panel flush title="Latest values">
            {x.latest.length ? (
              <>
                <table className="w-full text-sm">
                  <tbody>
                    {x.latest.map((l) => (
                      <tr
                        key={l.element}
                        onClick={() => setElement(l.element)}
                        className={cx('cursor-pointer border-b border-zinc-100', selected === l.element ? 'bg-accent-50' : 'hover:bg-zinc-50')}
                      >
                        <td className="px-5 py-2.5">{l.name}</td>
                        <td className="num px-5 py-2.5 text-end font-medium">
                          {typeof l.value === 'number' ? l.value.toLocaleString() : (l.value ?? '—')} {l.unit}
                        </td>
                        <td className="px-5 py-2.5 text-end text-xs text-zinc-500">{dateTime(l.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selected && <Series entityId={x.id} element={selected} name={x.latest.find((l) => l.element === selected)?.name ?? selected} />}
              </>
            ) : (
              <p className="px-5 py-6 text-sm text-zinc-500">No observations recorded yet.</p>
            )}
          </Panel>
          {(children.data?.total ?? 0) > 0 && (
            <Panel flush title={`Contains ${children.data!.total.toLocaleString()}`}>
              <ul className="divide-y divide-zinc-100">
                {children.data!.items.map((c) => (
                  <li key={c.id}>
                    <Link to={`${base}/entities/${c.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-zinc-50">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-zinc-500">{c.type.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className="space-y-6">
          {x.geometry && (
            <Panel flush title="Location">
              <div className="h-64">
                <MapView label={`Location of ${x.name}`} data={{ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: x.geometry, properties: { name: x.name, color: x.type.color } }] }} />
              </div>
            </Panel>
          )}
          <Panel title="History">
            <ol className="space-y-3">
              {x.history.map((h, i) => (
                <li key={i} className="border-s-2 border-zinc-200 ps-3 text-sm">
                  <div className="text-xs text-zinc-500">
                    {dateTime(h.at)} · {h.actor ?? h.source}
                  </div>
                  <div className="mt-0.5 text-zinc-700">
                    {'created' in h.changes ? 'Created' : Object.keys(h.changes).map((k) => k.replace(/_/g, ' ')).join(', ')}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
      {editing && types.data && <EntityDialog types={types.data} defaultType={x.type.key} entity={x} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Series({ entityId, element, name }: { entityId: string; element: string; name: string }) {
  const { tenantId, project } = useProject();
  const scheme = useScheme();
  const s = useQuery({ queryKey: ['series', tenantId, project.key, entityId, element], queryFn: () => api.series(tenantId, project.key, entityId, element) });
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: ink.tooltip, borderColor: ink.axis, borderRadius: 0, textStyle: { color: ink.text } },
      xAxis: { type: 'time', axisLabel: { color: ink.muted, hideOverlap: true }, axisLine: { lineStyle: { color: ink.axis } } },
      yAxis: { type: 'value', axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid } } },
      series: [{ name, type: 'line', showSymbol: (s.data?.length ?? 0) < 40, symbolSize: 8, lineStyle: { width: 2 }, color: brandColor(), data: (s.data ?? []).map((p) => [p.at, p.value]) }],
    };
  }, [s.data, scheme, name]);
  return (
    <div className="h-56 border-t border-zinc-200 px-2 pt-2">
      <Chart option={option} label={`${name} over time`} />
    </div>
  );
}

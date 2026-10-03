import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Empty, ErrorNotice, Field, Select } from '@grids/ui';
import { Map as MapIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { MapView } from '../../viz/MapView';
import { useProject } from './context';
import { fmtAttr, useTypes } from './EntitiesTab';

/** Everything with a location, coloured by type or by an indicator's latest value. */
export function MapTab() {
  const { tenantId, project, base } = useProject();
  const types = useTypes();
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const geoTypes = types.data?.filter((t) => t.geometry !== 'none') ?? [];
  const [type, setType] = useState<string>('');
  const [element, setElement] = useState<string>('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const geo = useQuery({
    queryKey: ['geo-tab', tenantId, project.key, type, element],
    queryFn: () => api.query(tenantId, project.key, { kind: 'geo', entityType: type || undefined, element: element || undefined }),
    enabled: geoTypes.length > 0,
  });
  if (types.data && !geoTypes.length)
    return (
      <div className="border border-zinc-200 bg-snow">
        <Empty icon={MapIcon} title="Nothing to map yet">
          Give an entity type a point or area geometry in Settings to see it here.
        </Empty>
      </div>
    );
  const selType = types.data?.find((t) => t.key === selected?.type);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Show">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Everything</option>
            {geoTypes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.plural}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Size and label by">
          <Select value={element} onChange={(e) => setElement(e.target.value)}>
            <option value="">Type colour</option>
            {elements.data?.map((el) => (
              <option key={el.key} value={el.key}>
                {el.name} (latest)
              </option>
            ))}
          </Select>
        </Field>
        <span className="pb-2 text-sm text-zinc-500">{geo.data?.features?.features?.length?.toLocaleString() ?? '–'} on the map</span>
      </div>
      <ErrorNotice error={geo.error} />
      <div className="relative h-[calc(100vh-300px)] min-h-[420px] border border-zinc-200 bg-snow">
        <MapView label="Project map" data={geo.data?.features} options={{ onSelect: setSelected, labelAttribute: 'name' }} />
        {selected && (
          <aside className="absolute end-3 top-3 z-10 w-72 border border-zinc-300 bg-snow p-4 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{String(selected.name)}</div>
                <div className="text-xs text-zinc-500">{selType?.name}</div>
              </div>
              <button type="button" aria-label="Close" className="text-zinc-500 hover:text-ink" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              {(selType?.attributes ?? [])
                .filter((a) => a.summary)
                .map((a) => (
                  <div key={a.key} className="flex justify-between gap-3">
                    <dt className="text-zinc-500">{a.label}</dt>
                    <dd className="text-end">{fmtAttr(a, selected[a.key])}</dd>
                  </div>
                ))}
              {element && selected.value !== null && selected.value !== undefined && (
                <div className="flex justify-between gap-3 border-t border-zinc-200 pt-1">
                  <dt className="text-zinc-500">{elements.data?.find((e) => e.key === element)?.name}</dt>
                  <dd className="num">{Number(selected.value).toLocaleString()}</dd>
                </div>
              )}
            </dl>
            <Link to={`${base}/entities/${String(selected.id)}`} className="mt-3 inline-block text-sm font-medium text-accent-700 hover:underline">
              Open details
            </Link>
          </aside>
        )}
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import {
  parseColumnValues,
  PERIOD_HOURS,
  type ColumnFilter,
  type ColumnFilterValue,
  type DashboardFilters,
  type DashboardParams,
} from '@grids/schema';
import { cx, Input, Select } from '@grids/ui';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const PERIOD_LABEL: Record<number, string> = {
  24: 'Last 24 hours',
  168: 'Last 7 days',
  720: 'Last 30 days',
  2160: 'Last 90 days',
  8760: 'Last 12 months',
};

/** What a viewer has picked for a column filter: their choice, else the filter's default. */
export function columnValue(f: ColumnFilter, params: DashboardParams): ColumnFilterValue | null {
  const picked = parseColumnValues(params.cf);
  return f.id in picked ? (picked[f.id] ?? null) : (f.default ?? null);
}

/** The params with one column filter set (null clears it, which differs from "never touched"). */
export function withColumnValue(
  params: DashboardParams,
  id: string,
  value: ColumnFilterValue | null,
): DashboardParams {
  return { ...params, cf: JSON.stringify({ ...parseColumnValues(params.cf), [id]: value }) };
}

/** The dashboard header's parameters (spec §9): area, period, and filters on dataset columns. */
export function DashboardFilterBar({
  filters,
  params,
  onChange,
  areas,
  areaLabel,
  loadOptions,
  optionsKey = ['filter-values'],
}: {
  filters: DashboardFilters;
  params: DashboardParams;
  onChange(p: DashboardParams): void;
  /** `type` is set when viewers can pick at several levels: the option then says which. */
  areas: { id: string; name: string; type?: { key: string; name: string } }[] | undefined;
  /** e.g. "All provinces" */
  areaLabel: string;
  /** The values a column filter offers (its column's distinct values). */
  loadOptions?: (filterId: string, cf?: string) => Promise<string[]>;
  optionsKey?: unknown[];
}) {
  const columns = filters.columns ?? [];
  if (!filters.areaType && !filters.period && !columns.length) return null;
  const several = new Set(areas?.map((a) => a.type?.key)).size > 1;
  const touched = columns.some((f) => columnValue(f, params) !== null);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dashboard filters">
      {filters.areaType && (
        <Select
          aria-label="Area"
          value={params.area ?? ''}
          onChange={(e) => onChange({ ...params, area: e.target.value || undefined })}
          className="w-48"
          disabled={!areas}
        >
          <option value="">{areaLabel}</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {several && a.type ? `${a.name} · ${a.type.name}` : a.name}
            </option>
          ))}
        </Select>
      )}
      {filters.period && (
        <Select
          aria-label="Period"
          value={params.hours ?? ''}
          onChange={(e) =>
            onChange({ ...params, hours: e.target.value ? Number(e.target.value) : undefined })
          }
          className="w-48"
        >
          <option value="">Default periods</option>
          {PERIOD_HOURS.map((h) => (
            <option key={h} value={h}>
              {PERIOD_LABEL[h]}
            </option>
          ))}
        </Select>
      )}
      {columns.map((f) => (
        <ColumnFilterControl
          key={f.id}
          filter={f}
          value={columnValue(f, params)}
          onChange={(v) => onChange(withColumnValue(params, f.id, v))}
          loadOptions={loadOptions}
          optionsKey={optionsKey}
          others={otherPicks(columns, f, params)}
        />
      ))}
      {touched && (
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-600 hover:text-ink"
          onClick={() =>
            onChange({
              ...params,
              cf: JSON.stringify(Object.fromEntries(columns.map((f) => [f.id, null]))),
            })
          }
        >
          <X className="size-3" /> Clear filters
        </button>
      )}
    </div>
  );
}

/** What is picked on the other filters of the same dataset, as the `cf` text: a filter's list narrows by these. */
function otherPicks(
  all: ColumnFilter[],
  f: ColumnFilter,
  params: DashboardParams,
): string | undefined {
  const picks: Record<string, ColumnFilterValue> = {};
  for (const o of all) {
    if (o.id === f.id || o.dataset !== f.dataset) continue;
    const v = columnValue(o, params);
    if (v !== null) picks[o.id] = v;
  }
  return Object.keys(picks).length ? JSON.stringify(picks) : undefined;
}

function ColumnFilterControl({
  filter: f,
  value,
  onChange,
  loadOptions,
  optionsKey,
  others,
}: {
  filter: ColumnFilter;
  value: ColumnFilterValue | null;
  onChange(v: ColumnFilterValue | null): void;
  loadOptions?: (id: string, cf?: string) => Promise<string[]>;
  optionsKey: unknown[];
  others?: string;
}) {
  const needsOptions = f.kind === 'select' || f.kind === 'multi';
  const options = useQuery({
    queryKey: [...optionsKey, f.id, others ?? ''],
    queryFn: () => loadOptions!(f.id, others),
    placeholderData: (prev) => prev,
    enabled: needsOptions && !!loadOptions,
    staleTime: 60_000,
  });
  if (f.kind === 'select')
    return (
      <Select
        aria-label={f.label}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-48"
        disabled={!options.data}
      >
        <option value="">{`All · ${f.label}`}</option>
        {options.data?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    );
  if (f.kind === 'multi') {
    const picked = Array.isArray(value) ? value : [];
    const toggle = (o: string) => {
      const next = picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o];
      onChange(next.length ? next : null);
    };
    return (
      <details className="relative">
        <summary
          className={cx(
            'flex h-9 w-48 cursor-pointer list-none items-center justify-between gap-2 border border-zinc-300 bg-snow px-3 text-sm transition-colors hover:border-zinc-500',
            picked.length > 0 && 'border-accent-600',
          )}
        >
          <span className="truncate">
            {picked.length
              ? `${f.label} · ${picked.length === 1 ? picked[0] : `${picked.length} selected`}`
              : `All · ${f.label}`}
          </span>
          <ChevronDown className="size-4 shrink-0 text-zinc-500" />
        </summary>
        <div className="absolute z-30 mt-1 max-h-64 w-64 overflow-auto border border-zinc-300 bg-snow p-1 shadow-raised">
          {!options.data && <p className="p-2 text-xs text-zinc-500">Loading…</p>}
          {options.data?.map((o) => (
            <label
              key={o}
              className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-zinc-100"
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand-600)]"
                checked={picked.includes(o)}
                onChange={() => toggle(o)}
              />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
      </details>
    );
  }
  if (f.kind === 'text')
    return (
      <TextFilter
        label={f.label}
        value={typeof value === 'string' ? value : ''}
        onChange={(v) => onChange(v || null)}
      />
    );
  if (f.kind === 'range') {
    const r =
      value &&
      !Array.isArray(value) &&
      typeof value === 'object' &&
      ('min' in value || 'max' in value)
        ? (value as { min?: number; max?: number })
        : {};
    const set = (p: { min?: number; max?: number }) => {
      const next = { ...r, ...p };
      onChange(next.min === undefined && next.max === undefined ? null : next);
    };
    const num = (s: string) =>
      s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s);
    return (
      <span className="flex items-center gap-1.5" role="group" aria-label={f.label}>
        <span className="text-xs text-zinc-500">{f.label}</span>
        <Input
          aria-label={`${f.label} from`}
          type="number"
          placeholder="Min"
          className="w-24"
          defaultValue={r.min ?? ''}
          key={`min-${r.min ?? ''}`}
          onBlur={(e) => set({ min: num(e.target.value) })}
        />
        <Input
          aria-label={`${f.label} to`}
          type="number"
          placeholder="Max"
          className="w-24"
          defaultValue={r.max ?? ''}
          key={`max-${r.max ?? ''}`}
          onBlur={(e) => set({ max: num(e.target.value) })}
        />
      </span>
    );
  }
  const d =
    value &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    ('from' in value || 'to' in value)
      ? (value as { from?: string; to?: string })
      : {};
  const setD = (p: { from?: string; to?: string }) => {
    const next = { ...d, ...p };
    onChange(
      !next.from && !next.to
        ? null
        : { ...(next.from && { from: next.from }), ...(next.to && { to: next.to }) },
    );
  };
  return (
    <span className="flex items-center gap-1.5" role="group" aria-label={f.label}>
      <span className="text-xs text-zinc-500">{f.label}</span>
      <Input
        aria-label={`${f.label} from`}
        type="date"
        className="w-40"
        value={d.from ?? ''}
        onChange={(e) => setD({ from: e.target.value || undefined })}
      />
      <Input
        aria-label={`${f.label} to`}
        type="date"
        className="w-40"
        value={d.to ?? ''}
        onChange={(e) => setD({ to: e.target.value || undefined })}
      />
    </span>
  );
}

/** A text filter that waits for a pause in typing before it applies. */
function TextFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <Input
      aria-label={label}
      placeholder={label}
      className="w-48"
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

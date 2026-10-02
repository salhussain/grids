import { PERIOD_HOURS, type DashboardFilters, type DashboardParams } from '@grids/schema';
import { Select } from '@grids/ui';

const PERIOD_LABEL: Record<number, string> = { 24: 'Last 24 hours', 168: 'Last 7 days', 720: 'Last 30 days', 2160: 'Last 90 days', 8760: 'Last 12 months' };

/** The dashboard header's parameters (spec §9): area and period. */
export function DashboardFilterBar({
  filters,
  params,
  onChange,
  areas,
  areaLabel,
}: {
  filters: DashboardFilters;
  params: DashboardParams;
  onChange(p: DashboardParams): void;
  areas: { id: string; name: string }[] | undefined;
  /** e.g. "All provinces" */
  areaLabel: string;
}) {
  if (!filters.areaType && !filters.period) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dashboard filters">
      {filters.areaType && (
        <Select aria-label="Area" value={params.area ?? ''} onChange={(e) => onChange({ ...params, area: e.target.value || undefined })} className="w-56" disabled={!areas}>
          <option value="">{areaLabel}</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      )}
      {filters.period && (
        <Select
          aria-label="Period"
          value={params.hours ?? ''}
          onChange={(e) => onChange({ ...params, hours: e.target.value ? Number(e.target.value) : undefined })}
          className="w-44"
        >
          <option value="">Default periods</option>
          {PERIOD_HOURS.map((h) => (
            <option key={h} value={h}>
              {PERIOD_LABEL[h]}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

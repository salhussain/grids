import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Input, Select } from '@grids/ui';
import { api } from '../api';
import type { AuditEntryDto } from '@grids/schema';
import { dateTime, relTime } from '@grids/ui';

/** Timeline of audit entries (system log excerpt). */
export function ActivityList({
  entries,
  showTenant,
}: {
  entries: AuditEntryDto[];
  showTenant?: boolean;
}) {
  if (!entries.length)
    return <p className="py-6 text-center text-sm text-zinc-500">No activity yet.</p>;
  return (
    <ol className="relative border-l border-zinc-300">
      {entries.map((a) => (
        <li key={a.id} className="relative pb-4 pl-5 last:pb-0">
          <span className="absolute top-1.5 -left-[4.5px] size-2 bg-accent-600" />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs font-medium text-ink">{a.action}</span>
            {showTenant && a.tenant && (
              <Link
                to="/tenants/$tenantId"
                params={{ tenantId: a.tenant.id }}
                className="text-xs text-accent-700 hover:underline"
              >
                {a.tenant.name}
              </Link>
            )}
          </div>
          <DetailsLine details={a.details} />
          <div className="mt-0.5 text-xs text-zinc-400" title={dateTime(a.at)}>
            {a.actorEmail ?? 'system'} · {relTime(a.at)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DetailsLine({ details }: { details: Record<string, unknown> }) {
  const parts = Object.entries(details).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  if (!parts.length) return null;
  return (
    <div className="mt-0.5 text-xs break-words text-zinc-600">
      {parts.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && <span className="text-zinc-300"> · </span>}
          <span className="text-zinc-400">{k}</span>{' '}
          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </div>
  );
}

/**
 * Organisation filter. Fetches one page of matches for the typed text instead of
 * loading every organisation.
 */
export function TenantPicker({
  value,
  onChange,
  label = 'Organisation',
  emptyLabel = 'All organisations',
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  emptyLabel?: string;
}) {
  const [q, setQ] = useState('');
  const tenants = useQuery({
    queryKey: ['tenant-picker', q],
    queryFn: () => api.tenants({ q, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const options = tenants.data?.items ?? [];
  return (
    <div className="flex">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find organisation"
        aria-label={`Find ${label.toLowerCase()}`}
        className="w-40 border-r-0"
      />
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-48"
      >
        <option value="">{emptyLabel}</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

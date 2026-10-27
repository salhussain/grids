import { Input, Select } from '@grids/ui';
import { CalendarClock } from 'lucide-react';

/** How long things are expected to take between updates. A month is 30 days and a year 365. */
export const DURATION_UNITS = [
  { id: 'minute', label: 'Minutes', minutes: 1 },
  { id: 'hour', label: 'Hours', minutes: 60 },
  { id: 'day', label: 'Days', minutes: 1440 },
  { id: 'week', label: 'Weeks', minutes: 10_080 },
  { id: 'month', label: 'Months', minutes: 43_200 },
  { id: 'year', label: 'Years', minutes: 525_600 },
] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number]['id'];
export interface Duration {
  value: string;
  unit: DurationUnit;
}

export const noDuration: Duration = { value: '', unit: 'day' };

/** The length in minutes, or null when empty or not a positive number. */
export function toMinutes(d: Duration): number | null {
  const n = Number(d.value);
  if (!d.value.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n * DURATION_UNITS.find((u) => u.id === d.unit)!.minutes));
}

/** Minutes shown in the largest unit that holds them whole (90 → 90 minutes, 2880 → 2 days). */
export function fromMinutes(minutes: number | null | undefined): Duration {
  if (!minutes) return noDuration;
  const unit = [...DURATION_UNITS].reverse().find((u) => minutes % u.minutes === 0) ?? DURATION_UNITS[0];
  return { value: String(minutes / unit.minutes), unit: unit.id };
}

export function formatMinutes(minutes: number | null | undefined): string {
  const d = fromMinutes(minutes);
  if (!d.value) return 'None';
  const label = DURATION_UNITS.find((u) => u.id === d.unit)!.label.toLowerCase();
  return `${d.value} ${d.value === '1' ? label.replace(/s$/, '') : label}`;
}

/** A number and its unit. Put it directly inside a Field, which hands it the id for the label. */
export function DurationInput({ value, onChange, id, ...aria }: { value: Duration; onChange(d: Duration): void; id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) {
  return (
    <div className="flex gap-2">
      <Input id={id} {...aria} icon={CalendarClock} type="number" min={0} step="any" className="min-w-0 flex-1" value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} />
      <Select aria-label="Unit" className="w-32 shrink-0" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as DurationUnit })}>
        {DURATION_UNITS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

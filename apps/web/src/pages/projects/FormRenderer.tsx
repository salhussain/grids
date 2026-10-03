import { formState } from '@grids/forms';
import type { FormDefinition, Question } from '@grids/schema';
import { Input, Textarea, cx } from '@grids/ui';
import { Info, LocateFixed } from 'lucide-react';
import { useId, useMemo } from 'react';

export type Answers = Record<string, unknown>;

/**
 * Renders a form definition with live relevance and calculations, using the same
 * @grids/forms runtime the server validates with.
 */
export function FormRenderer({
  definition,
  answers,
  onChange,
  errors = {},
}: {
  definition: FormDefinition;
  answers: Answers;
  onChange(next: Answers): void;
  errors?: Record<string, string>;
}) {
  const state = useMemo(() => formState(definition, answers), [definition, answers]);
  const set = (key: string, v: unknown) => onChange({ ...answers, [key]: v });
  return (
    <div className="space-y-6">
      {definition.sections
        .filter((s) => state.relevant.has(s.key))
        .map((s) => (
          <fieldset key={s.key} className="border border-zinc-200 bg-snow">
            {s.title && <legend className="sr-only">{s.title}</legend>}
            {s.title && <h3 className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold" aria-hidden>{s.title}</h3>}
            <div className="space-y-5 p-5">
              {s.questions
                .filter((q) => state.relevant.has(q.key))
                .map((q) => (
                  <QuestionInput key={q.key} q={q} value={state.values[q.key]} error={errors[q.key]} onChange={(v) => set(q.key, v)} />
                ))}
            </div>
          </fieldset>
        ))}
    </div>
  );
}

function QuestionInput({ q, value, error, onChange }: { q: Question; value: unknown; error?: string; onChange(v: unknown): void }) {
  const id = useId();
  if (q.type === 'note')
    return (
      <div className="flex gap-2.5 border-s-4 border-accent-600 bg-accent-50 px-4 py-3 text-sm text-accent-800">
        <Info className="mt-0.5 size-4 shrink-0" /> {q.label}
      </div>
    );
  const label = (
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
      {q.label}
      {q.required && <span className="text-accent-600"> *</span>}
    </label>
  );
  const described = q.hint || error ? `${id}-note` : undefined;
  const note = (
    <>
      {q.hint && !error && (
        <p id={`${id}-note`} className="mt-1.5 text-xs text-zinc-500">
          {q.hint}
        </p>
      )}
      {error && (
        <p id={`${id}-note`} className="mt-1.5 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </>
  );
  const invalid = !!error || undefined;
  let control: React.ReactNode;
  switch (q.type) {
    case 'calculate':
      return (
        <div className="flex items-baseline justify-between gap-3 border border-dashed border-zinc-300 px-3 py-2 text-sm">
          <span className="text-zinc-600">{q.label}</span>
          <span className="num font-medium">{value === null || value === undefined || value === '' ? '—' : String(value)}</span>
        </div>
      );
    case 'textarea':
      control = <Textarea id={id} aria-invalid={invalid} aria-describedby={described} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'integer':
    case 'decimal':
      control = (
        <Input
          id={id}
          type="number"
          inputMode={q.type === 'integer' ? 'numeric' : 'decimal'}
          step={q.type === 'integer' ? 1 : 'any'}
          min={q.min}
          max={q.max}
          aria-invalid={invalid}
          aria-describedby={described}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="sm:w-48"
        />
      );
      break;
    case 'boolean':
      control = (
        <div role="radiogroup" aria-labelledby={id} className="inline-flex border border-zinc-300">
          {[
            [true, 'Yes'],
            [false, 'No'],
          ].map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={value === v}
              onClick={() => onChange(value === v ? null : v)}
              className={cx('min-w-16 px-4 py-2 text-sm', value === v ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-50')}
            >
              {l as string}
            </button>
          ))}
        </div>
      );
      break;
    case 'select':
      control =
        (q.options?.length ?? 0) <= 5 ? (
          <div role="radiogroup" aria-labelledby={id} className="flex flex-col gap-2">
            {q.options?.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} className="size-4 accent-[var(--brand-600)]" />
                {o.label}
              </label>
            ))}
          </div>
        ) : (
          <select id={id} aria-invalid={invalid} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} className="h-9 w-full border border-zinc-300 bg-snow px-2.5 text-sm sm:w-80">
            <option value="">Choose…</option>
            {q.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      break;
    case 'multiselect': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
          {q.options?.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={list.includes(o.value)}
                onChange={() => onChange(list.includes(o.value) ? list.filter((x) => x !== o.value) : [...list, o.value])}
                className="size-4 accent-[var(--brand-600)]"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'date':
      control = <Input id={id} type="date" aria-invalid={invalid} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} className="sm:w-48" />;
      break;
    case 'datetime':
      control = (
        <Input
          id={id}
          type="datetime-local"
          aria-invalid={invalid}
          value={typeof value === 'string' ? value.slice(0, 16) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="sm:w-64"
        />
      );
      break;
    case 'geopoint': {
      const p = (value as { lat?: number; lon?: number } | null) ?? {};
      control = (
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Latitude" type="number" step="any" placeholder="Latitude" value={p.lat ?? ''} onChange={(e) => onChange({ ...p, lat: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-36" />
          <Input aria-label="Longitude" type="number" step="any" placeholder="Longitude" value={p.lon ?? ''} onChange={(e) => onChange({ ...p, lon: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-36" />
          <button
            type="button"
            onClick={() => navigator.geolocation?.getCurrentPosition((pos) => onChange({ lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6) }))}
            className="inline-flex h-9 items-center gap-1.5 border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-600"
          >
            <LocateFixed className="size-4" /> Use my location
          </button>
        </div>
      );
      break;
    }
    default:
      control = <Input id={id} aria-invalid={invalid} aria-describedby={described} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div>
      {label}
      {control}
      {note}
    </div>
  );
}

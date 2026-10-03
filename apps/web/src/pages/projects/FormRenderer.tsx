import { formState, validate } from '@grids/forms';
import type { FormDefinition, Question } from '@grids/schema';
import { Button, Input, Textarea, cx } from '@grids/ui';
import { ArrowLeft, ArrowRight, Check, CornerDownLeft, Info, LocateFixed, Send } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';

export type Answers = Record<string, unknown>;

const OPTION = 'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition';
const OPTION_ON = 'border-accent-500 bg-accent-50 text-ink ring-1 ring-accent-500';
const OPTION_OFF = 'border-zinc-200 bg-snow hover:border-zinc-400';

/**
 * Runs a form in its layout — one page, multi-step (a section per page, checked
 * before moving on) or one question at a time — with its submit controls.
 */
export function FormRunner({
  definition,
  answers,
  onChange,
  errors,
  onErrors,
  onSubmit,
  submitting,
  canSubmit = true,
  submitLabel = 'Submit',
  header,
  secondary,
}: {
  definition: FormDefinition;
  answers: Answers;
  onChange(next: Answers): void;
  errors: Record<string, string>;
  onErrors(next: Record<string, string>): void;
  onSubmit(): void;
  submitting?: boolean;
  canSubmit?: boolean;
  submitLabel?: string;
  /** Shown above the questions (e.g. choosing the subject). */
  header?: ReactNode;
  /** Extra actions beside the navigation (e.g. Clear). */
  secondary?: ReactNode;
}) {
  const state = useMemo(() => formState(definition, answers), [definition, answers]);
  const layout = definition.layout ?? 'single';
  const sections = definition.sections.filter((s) => state.relevant.has(s.key));
  const items = useMemo(
    () => definition.sections.filter((s) => state.relevant.has(s.key)).flatMap((s) => s.questions.filter((q) => q.type !== 'calculate' && state.relevant.has(q.key)).map((q) => ({ q, section: s.title }))),
    [definition, state],
  );
  const [at, setAt] = useState(0);
  const count = layout === 'steps' ? sections.length : layout === 'focus' ? items.length : 1;
  const page = Math.min(at, Math.max(0, count - 1));
  useEffect(() => setAt(0), [definition, layout]);

  const keysOnPage = (): string[] =>
    layout === 'steps' ? (sections[page]?.questions.map((q) => q.key) ?? []) : layout === 'focus' ? (items[page] ? [items[page].q.key] : []) : [];
  /** Validates just this page's questions; other pages' errors are left alone. */
  const checkPage = () => {
    const keys = new Set(keysOnPage());
    const r = validate(definition, answers);
    const mine = Object.fromEntries(Object.entries(r.errors).filter(([k]) => keys.has(k)));
    onErrors({ ...Object.fromEntries(Object.entries(errors).filter(([k]) => !keys.has(k))), ...mine });
    return Object.keys(mine).length === 0;
  };
  const last = page >= count - 1;
  const next = () => {
    if (!checkPage()) return;
    if (last) onSubmit();
    else setAt(page + 1);
  };
  const back = () => setAt(Math.max(0, page - 1));
  const set = (key: string, v: unknown) => onChange({ ...answers, [key]: v });
  const progress = count ? Math.round(((layout === 'single' ? 1 : page + (last ? 1 : 0)) / count) * 100) : 100;

  const nav = (
    <div className="flex items-center gap-2">
      {secondary}
      <span className="flex-1" />
      {layout !== 'single' && page > 0 && (
        <Button variant="secondary" icon={ArrowLeft} onClick={back}>
          Back
        </Button>
      )}
      {layout === 'single' || last ? (
        <Button icon={Send} onClick={layout === 'single' ? onSubmit : next} loading={submitting} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      ) : (
        <Button onClick={next}>
          Next <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );

  if (layout === 'focus') {
    const item = items[page];
    return (
      <div className="@container space-y-5">
        {header}
        <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-snow shadow-[var(--shadow-raised)]">
          <div className="h-1.5 bg-zinc-100">
            <div className="h-full rounded-r-full bg-accent-600 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div
            className="flex min-h-[340px] flex-col px-6 py-8 @xl:px-12 @xl:py-12"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
                e.preventDefault();
                next();
              }
            }}
          >
            <div className="mb-6 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
              <span className="num bg-accent-50 px-2 py-0.5 text-accent-700">
                {page + 1} / {count}
              </span>
              {item?.section && <span className="truncate">{item.section}</span>}
            </div>
            {item ? (
              <div key={item.q.key} className="animate-[fadeUp_.35s_ease-out] flex-1">
                <QuestionInput q={item.q} value={state.values[item.q.key]} error={errors[item.q.key]} onChange={(v) => set(item.q.key, v)} big />
              </div>
            ) : (
              <p className="flex-1 text-zinc-500">Nothing to answer.</p>
            )}
            <p className="mt-8 hidden items-center gap-1.5 text-xs text-zinc-400 @xl:flex">
              Press <kbd className="inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 font-sans">Enter <CornerDownLeft className="size-3" /></kbd> to continue
            </p>
          </div>
        </div>
        {nav}
      </div>
    );
  }

  if (layout === 'steps') {
    const s = sections[page];
    return (
      <div className="@container space-y-5">
        {header}
        <ol className="flex items-start gap-1 overflow-x-auto pb-1" aria-label="Steps">
          {sections.map((x, i) => {
            const done = i < page;
            const current = i === page;
            return (
              <li key={x.key} className="flex min-w-24 flex-1 flex-col gap-2">
                <div className={cx('h-1.5 transition-colors', done || current ? 'bg-accent-600' : 'bg-zinc-200')} />
                <button
                  type="button"
                  disabled={i > page}
                  onClick={() => setAt(i)}
                  aria-current={current ? 'step' : undefined}
                  className={cx('flex items-center gap-2 text-start text-xs', current ? 'font-semibold text-ink' : done ? 'text-zinc-700 hover:text-ink' : 'text-zinc-400')}
                >
                  <span
                    className={cx(
                      'flex size-5 shrink-0 items-center justify-center text-[10px]',
                      done ? 'bg-accent-600 text-on-accent' : current ? 'bg-ink text-canvas' : 'bg-zinc-200 text-zinc-600',
                    )}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="truncate">{x.title || `Step ${i + 1}`}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {s && (
          <fieldset key={s.key} className="animate-[fadeUp_.3s_ease-out] overflow-hidden rounded-2xl border border-zinc-200 bg-snow shadow-[var(--shadow-card,0_1px_2px_rgb(0_0_0/0.04))]">
            <legend className="sr-only">{s.title}</legend>
            <div className="border-b border-zinc-100 px-6 py-4">
              <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                Step {page + 1} of {count}
              </div>
              <h3 className="mt-0.5 text-lg font-semibold tracking-tight">{s.title || `Step ${page + 1}`}</h3>
            </div>
            <div className="space-y-6 p-6">
              {s.questions
                .filter((q) => state.relevant.has(q.key))
                .map((q) => (
                  <QuestionInput key={q.key} q={q} value={state.values[q.key]} error={errors[q.key]} onChange={(v) => set(q.key, v)} />
                ))}
            </div>
          </fieldset>
        )}
        {nav}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <FormRenderer definition={definition} answers={answers} onChange={onChange} errors={errors} />
      <div className="sticky bottom-0 -mx-4 border-t border-zinc-200 bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-4">{nav}</div>
    </div>
  );
}

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
    <div className="@container space-y-6">
      {definition.sections
        .filter((s) => state.relevant.has(s.key))
        .map((s) => (
          <fieldset key={s.key} className="overflow-hidden rounded-2xl border border-zinc-200 bg-snow shadow-[var(--shadow-card,0_1px_2px_rgb(0_0_0/0.04))]">
            {s.title && <legend className="sr-only">{s.title}</legend>}
            {s.title && (
              <h3 className="flex items-center gap-2.5 border-b border-zinc-100 px-6 py-3.5 text-[15px] font-semibold tracking-tight" aria-hidden>
                <span className="h-4 w-1 bg-accent-600" />
                {s.title}
              </h3>
            )}
            <div className="space-y-6 p-6">
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

function QuestionInput({ q, value, error, onChange, big }: { q: Question; value: unknown; error?: string; onChange(v: unknown): void; big?: boolean }) {
  const id = useId();
  if (q.type === 'note')
    return (
      <div className={cx('flex gap-2.5 rounded-xl bg-accent-50 px-4 py-3 text-accent-800 ring-1 ring-accent-100', big ? 'text-lg' : 'text-sm')}>
        <Info className="mt-0.5 size-4 shrink-0" /> {q.label}
      </div>
    );
  const label = (
    <label htmlFor={id} className={cx('block font-medium text-ink', big ? 'mb-4 text-2xl leading-snug tracking-tight' : 'mb-2 text-sm')}>
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
        <div className="flex items-baseline justify-between gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm">
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
        <div role="radiogroup" aria-labelledby={id} className="inline-flex gap-1 rounded-xl bg-zinc-100 p-1">
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
              className={cx('min-w-20 rounded-lg px-5 py-2 text-sm font-medium transition', value === v ? 'bg-snow text-ink shadow-sm ring-1 ring-zinc-200' : 'text-zinc-500 hover:text-ink')}
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
          <div role="radiogroup" aria-labelledby={id} className="grid gap-2 @lg:grid-cols-2">
            {q.options?.map((o) => (
              <label key={o.value} className={cx(OPTION, value === o.value ? OPTION_ON : OPTION_OFF)}>
                <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} className="size-4 accent-[var(--brand-600)]" />
                {o.label}
              </label>
            ))}
          </div>
        ) : (
          <select id={id} aria-invalid={invalid} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} className="h-10 w-full rounded-lg border border-zinc-300 bg-snow px-3 text-sm sm:w-80">
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
        <div role="group" aria-labelledby={id} className="grid gap-2 @lg:grid-cols-2">
          {q.options?.map((o) => (
            <label key={o.value} className={cx(OPTION, list.includes(o.value) ? OPTION_ON : OPTION_OFF)}>
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
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-600"
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

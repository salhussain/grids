import { defaultRow, formState, validate, type FormState } from '@grids/forms';
import { questionWidth, type FormDefinition, type Question, type QuestionWidth } from '@grids/schema';
import { Button, DatePicker, DateTimePicker, Input, Select, Textarea, cx } from '@grids/ui';
import { contrastOn } from '../../theme';
import { ArrowLeft, ArrowRight, Check, CornerDownLeft, Info, LocateFixed, Pencil, Plus, Send, Star, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { ICONS } from './context';
import { AttachmentLink, EntityInput, EntityName, FileInput, FormEnv, ImageInput, AttachmentImage, QrInput, SignatureInput, useFormEnv } from './FormInputs';

export type Answers = Record<string, unknown>;

const OPTION = 'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition';
const OPTION_ON = 'border-accent-500 bg-accent-50 text-ink ring-1 ring-accent-500';
const OPTION_OFF = 'border-zinc-200 bg-snow hover:border-zinc-400';

/**
 * Runs a form in its layout — one page, multi-step (a section per page, checked
 * before moving on) or one question at a time — with its submit controls.
 */
/** Gives the questions that reach into the project (places, pictures) every answer so far, calculations included. */
function WithAnswers({ definition, answers, children }: { definition: FormDefinition; answers: Answers; children: ReactNode }) {
  const env = useFormEnv();
  const values = useMemo(() => formState(definition, answers).values, [definition, answers]);
  return <FormEnv.Provider value={env ? { ...env, answers: values } : null}>{children}</FormEnv.Provider>;
}

export function FormRunner(props: Parameters<typeof RunnerBody>[0]) {
  const look = props.definition.look;
  const accent = look?.accent ?? null;
  return (
    <div
      className={cx(accent && 'brand-scope', look?.density === 'compact' && 'density-compact', look?.corners && look.corners !== 'square' && `corners-${look.corners}`)}
      style={accent ? ({ '--brand-600': accent, '--brand-contrast': contrastOn(accent) } as React.CSSProperties) : undefined}
    >
      <WithAnswers definition={props.definition} answers={props.answers}>
        <RunnerBody {...props} />
      </WithAnswers>
    </div>
  );
}

function RunnerBody({
  definition,
  answers,
  onChange,
  errors,
  onErrors,
  onSubmit,
  submitting,
  canSubmit = true,
  submitLabel,
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
  const t = useT();
  const flow = definition.flow ?? { progress: true, back: true, review: false };
  const [reviewing, setReviewing] = useState(false);
  const state = useMemo(() => formState(definition, answers), [definition, answers]);
  // One question at a time cannot show a repeating section's rows, so such forms step through their sections instead.
  const layout = definition.layout === 'focus' && definition.sections.some((x) => x.repeat) ? 'steps' : (definition.layout ?? 'single');
  const sections = definition.sections.filter((s) => state.shown.has(s.key));
  const items = useMemo(
    () => definition.sections.filter((s) => state.shown.has(s.key)).flatMap((s) => s.questions.filter((q) => q.type !== 'calculate' && state.shown.has(q.key)).map((q) => ({ q, section: s.title }))),
    [definition, state],
  );
  const [at, setAt] = useState(0);
  const count = layout === 'steps' ? sections.length : layout === 'focus' ? items.length : 1;
  const page = Math.min(at, Math.max(0, count - 1));
  useEffect(() => (setAt(0), setReviewing(false)), [definition, layout]);

  /** Whether an error key belongs to the page being shown (a repeating section's errors are `<section>.<row>.<question>`). */
  const onPage = (k: string): boolean => {
    if (layout === 'steps') {
      const sec = sections[page];
      return !!sec && (k === sec.key || k.startsWith(`${sec.key}.`) || sec.questions.some((q) => q.key === k));
    }
    return layout === 'focus' && items[page]?.q.key === k;
  };
  /** Validates just this page's questions; other pages' errors are left alone. */
  const checkPage = () => {
    const r = validate(definition, answers);
    const mine = Object.fromEntries(Object.entries(r.errors).filter(([k]) => onPage(k)));
    onErrors({ ...Object.fromEntries(Object.entries(errors).filter(([k]) => !onPage(k))), ...mine });
    return Object.keys(mine).length === 0;
  };
  const last = page >= count - 1;
  const next = () => {
    if (!checkPage()) return;
    if (!last) setAt(page + 1);
    else if (flow.review) setReviewing(true);
    else onSubmit();
  };
  /** One-page forms are checked as a whole before the review page. */
  const submitSingle = () => {
    if (!flow.review) return onSubmit();
    const r = validate(definition, answers);
    onErrors(r.errors);
    if (r.ok) setReviewing(true);
  };
  const back = () => setAt(Math.max(0, page - 1));
  const set = (key: string, v: unknown) => onChange({ ...answers, [key]: v });
  const progress = count ? Math.round(((layout === 'single' ? 1 : page + (last ? 1 : 0)) / count) * 100) : 100;

  const nav = (
    <div className="flex items-center gap-2">
      {secondary}
      <span className="flex-1" />
      {layout !== 'single' && flow.back && page > 0 && (
        <Button variant="secondary" icon={ArrowLeft} onClick={back}>
          {t('web.form.back')}
        </Button>
      )}
      {layout === 'single' || last ? (
        <Button
          icon={Send}
          onClick={layout === 'single' ? submitSingle : next}
          loading={submitting}
          disabled={!canSubmit}
        >
          {submitLabel ?? t('web.form.submit')}
        </Button>
      ) : (
        <Button onClick={next}>
          {t('web.form.next')} <ArrowRight className="size-4 rtl:rotate-180" />
        </Button>
      )}
    </div>
  );

  if (reviewing) {
    const shown = definition.sections.filter((s) => state.shown.has(s.key));
    return (
      <div className="@container space-y-5">
        {header}
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{t('web.form.review')}</h3>
          <p className="text-sm text-zinc-600">{t('web.form.reviewHint')}</p>
        </div>
        {shown.map((s, si) => (
          <section key={s.key} className="overflow-hidden rounded-2xl border border-zinc-200 bg-snow">
            <header className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3">
              <h4 className="flex-1 text-[15px] font-semibold">{s.title || t('web.form.step', { n: si + 1 })}</h4>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-sm text-accent-700 hover:underline"
                onClick={() => {
                  setReviewing(false);
                  if (layout === 'steps') setAt(si);
                }}
              >
                <Pencil className="size-3.5" /> {t('web.form.edit')}
              </button>
            </header>
            {(s.repeat ? (state.rows[s.key] ?? []) : [state]).map((scope, ri) => (
              <dl key={ri} className="divide-y divide-zinc-100 [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:border-zinc-200">
                {s.repeat && <div className="bg-zinc-50 px-5 py-1.5 text-xs font-semibold text-zinc-600">{`${s.repeat.itemLabel || 'Item'} ${ri + 1}`}</div>}
                {s.questions
                  .filter((q) => q.type !== 'note' && scope.shown.has(q.key))
                  .map((q) => (
                    <div key={q.key} className="grid gap-1 px-5 py-2.5 text-sm @lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @lg:gap-4">
                      <dt className="text-zinc-500">{q.label}</dt>
                      <dd className="font-medium break-words"><AnswerValue q={q} v={scope.values[q.key]} /></dd>
                    </div>
                  ))}
              </dl>
            ))}
          </section>
        ))}
        <div className="flex items-center gap-2">
          {secondary}
          <span className="flex-1" />
          <Button variant="secondary" icon={ArrowLeft} onClick={() => setReviewing(false)}>
            {t('web.form.back')}
          </Button>
          <Button icon={Send} onClick={onSubmit} loading={submitting} disabled={!canSubmit}>
            {submitLabel ?? t('web.form.submit')}
          </Button>
        </div>
      </div>
    );
  }

  if (layout === 'focus') {
    const item = items[page];
    return (
      <div className="@container space-y-5">
        {header}
        <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-snow shadow-[var(--shadow-raised)]">
          {flow.progress && (
            <div className="h-1.5 bg-zinc-100">
              <div className="h-full rounded-r-full bg-accent-600 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}
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
              <p className="flex-1 text-zinc-500">{t('web.form.nothing')}</p>
            )}
            <p className="mt-8 hidden items-center gap-1.5 text-xs text-zinc-400 @xl:flex">
              <kbd className="inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 font-sans">
                Enter <CornerDownLeft className="size-3" />
              </kbd>{' '}
              {t('web.form.toContinue')}
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
        <ol className={cx('flex items-start gap-1 overflow-x-auto pb-1', !flow.progress && 'hidden')} aria-label="Steps">
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
                  <span className="truncate">{x.title || t('web.form.step', { n: i + 1 })}</span>
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
                {t('web.form.stepOf', { n: page + 1, count })}
              </div>
              <h3 className="mt-0.5 text-lg font-semibold tracking-tight">
                {s.title || t('web.form.step', { n: page + 1 })}
              </h3>
            </div>
            <SectionBody section={s} state={state} answers={answers} errors={errors} onChange={set} />
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
    <WithAnswers definition={definition} answers={answers}>
    <div className="@container space-y-6">
      {definition.sections
        .filter((s) => state.shown.has(s.key))
        .map((s) => (
          <fieldset key={s.key} className="overflow-hidden rounded-2xl border border-zinc-200 bg-snow shadow-[var(--shadow-card,0_1px_2px_rgb(0_0_0/0.04))]">
            {s.title && <legend className="sr-only">{s.title}</legend>}
            {s.title && (
              <h3 className="bg-accent-600 px-6 py-3 text-[15px] font-semibold tracking-tight text-on-accent" aria-hidden>
                {s.title}
              </h3>
            )}
            <SectionBody section={s} state={state} answers={answers} errors={errors} onChange={set} />
          </fieldset>
        ))}
    </div>
    </WithAnswers>
  );
}

/** Container-query classes for a wide screen's 12-part grid, written out in full so Tailwind finds them. */
const WIDTH: Record<QuestionWidth, string> = {
  full: '@xl:col-span-12',
  '1/2': '@xl:col-span-6',
  '1/3': '@xl:col-span-4',
  '2/3': '@xl:col-span-8',
  '1/4': '@xl:col-span-3',
  '3/4': '@xl:col-span-9',
};

/** The questions of one scope (the section, or one row of it), in rows of the widths they ask for. A narrow screen shows one per row. */
function QuestionGrid({ section, scope, prefix, errors, onChange }: { section: FormDefinition['sections'][number]; scope: FormState | FormState['rows'][string][number]; prefix: string; errors: Record<string, string>; onChange(key: string, v: unknown): void }) {
  return (
    <div className="grid gap-6 @xl:grid-cols-12">
      {section.questions
        .filter((q) => scope.shown.has(q.key))
        .map((q) => (
          <div key={q.key} className={cx('min-w-0', WIDTH[questionWidth(q, section.columns)])}>
            <QuestionInput q={q} value={scope.values[q.key]} error={errors[prefix + q.key]} onChange={(v) => onChange(q.key, v)} />
          </div>
        ))}
    </div>
  );
}

/** A section's questions; a repeating section shows a card per row, with buttons to add and remove rows. */
function SectionBody({ section, state, answers, errors, onChange }: { section: FormDefinition['sections'][number]; state: FormState; answers: Answers; errors: Record<string, string>; onChange(key: string, v: unknown): void }) {
  const env = useFormEnv();
  const rep = section.repeat;
  const rows = (Array.isArray(answers[section.key]) ? (answers[section.key] as Answers[]) : []).filter((r) => typeof r === 'object' && r !== null);
  const min = rep?.min ?? 0;
  useEffect(() => {
    // A section that needs rows opens with that many.
    if (rep && rows.length < min) onChange(section.key, [...rows, ...Array.from({ length: min - rows.length }, () => defaultRow(section))]);
  });
  if (!rep)
    return (
      <div className="p-6">
        <QuestionGrid section={section} scope={state} prefix="" errors={errors} onChange={onChange} />
      </div>
    );
  const max = rep.max ?? 100;
  const name = rep.itemLabel || 'Item';
  const setRows = (next: Answers[]) => onChange(section.key, next);
  return (
    <div className="space-y-4 p-6">
      {rows.map((row, i) => {
        const scope = state.rows[section.key]?.[i];
        if (!scope) return null;
        return (
          <FormEnv.Provider key={i} value={env ? { ...env, answers: { ...env.answers, ...scope.values } } : null}>
            <div className="border border-zinc-200 bg-snow">
              <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-2">
                <span className="text-sm font-semibold">{`${name} ${i + 1}`}</span>
                <button type="button" aria-label={`Remove ${name.toLowerCase()} ${i + 1}`} title="Remove" disabled={rows.length <= min} className="p-1 text-zinc-500 hover:text-red-700 disabled:opacity-30" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="p-4">
                <QuestionGrid section={section} scope={scope} prefix={`${section.key}.${i}.`} errors={errors} onChange={(key, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)))} />
              </div>
            </div>
          </FormEnv.Provider>
        );
      })}
      {errors[section.key] && (
        <p className="text-xs text-red-700" role="alert">
          {errors[section.key]}
        </p>
      )}
      <Button variant="secondary" icon={Plus} disabled={rows.length >= max} onClick={() => setRows([...rows, defaultRow(section)])}>
        {rows.length ? `Add another ${name.toLowerCase()}` : `Add ${name.toLowerCase()}`}
      </Button>
    </div>
  );
}

function QuestionInput({ q, value, error, onChange, big }: { q: Question; value: unknown; error?: string; onChange(v: unknown): void; big?: boolean }) {
  const id = useId();
  const t = useT();
  if (q.type === 'note')
    return (
      <div className={cx('flex gap-2.5 rounded-xl bg-accent-50 px-4 py-3 text-accent-800 ring-1 ring-accent-100', big ? 'text-lg' : 'text-sm')}>
        {(() => {
          const I = (q.icon && ICONS[q.icon]) || Info;
          return <I className="mt-0.5 size-4 shrink-0" />;
        })()}{' '}
        {q.label}
      </div>
    );
  const Icon = q.icon ? ICONS[q.icon] : undefined;
  const label = (
    <label htmlFor={id} className={cx('block font-medium text-ink', big ? 'mb-4 text-2xl leading-snug tracking-tight' : 'mb-2 text-sm')}>
      {Icon && <Icon className={cx('me-2 inline text-accent-600', big ? 'size-6' : 'size-4')} aria-hidden />}
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
    case 'qr':
      control = <QrInput id={id} value={value} onChange={onChange} invalid={!!invalid} described={described} placeholder={q.placeholder} />;
      break;
    case 'image':
      control = <ImageInput q={q} value={value} onChange={onChange} invalid={!!invalid} />;
      break;
    case 'file':
      control = <FileInput q={q} value={value} onChange={onChange} invalid={!!invalid} />;
      break;
    case 'signature':
      control = <SignatureInput q={q} value={value} onChange={onChange} invalid={!!invalid} />;
      break;
    case 'time':
      control = <Input id={id} type="time" aria-invalid={invalid} aria-describedby={described} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} className="sm:w-40" />;
      break;
    case 'rating': {
      const max = q.max ?? 5;
      control = (
        <div role="radiogroup" aria-labelledby={id} className="flex gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of ${max}`} onClick={() => onChange(value === n ? null : n)} className={cx('p-1 transition', typeof value === 'number' && n <= value ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-400')}>
              <Star className={cx('size-7', typeof value === 'number' && n <= value && 'fill-current')} />
            </button>
          ))}
        </div>
      );
      break;
    }
    case 'entity':
      control = <EntityInput id={id} q={q} value={value} onChange={onChange} invalid={!!invalid} />;
      break;
    case 'textarea':
      control = <Textarea id={id} rows={q.rows} maxLength={q.maxLength} placeholder={q.placeholder} aria-invalid={invalid} aria-describedby={described} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'integer':
    case 'decimal':
      control = (
        <Input
          id={id}
          type="number"
          placeholder={q.placeholder}
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
            [true, t('web.form.yes')],
            [false, t('web.form.no')],
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
          <Select id={id} aria-invalid={invalid} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} className="sm:w-80">
            <option value="">{q.placeholder || t('web.form.choose')}</option>
            {q.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
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
      control = <DatePicker id={id} invalid={!!invalid} value={(value as string) ?? ''} onChange={(d) => onChange(d || null)} className="sm:w-56" />;
      break;
    case 'datetime':
      control = (
        <DateTimePicker
          id={id}
          invalid={!!invalid}
          value={typeof value === 'string' && value ? localDateTime(new Date(value)) : ''}
          onChange={(v) => onChange(v ? new Date(v).toISOString() : null)}
          className="sm:w-80"
        />
      );
      break;
    case 'geopoint': {
      const p = (value as { lat?: number; lon?: number } | null) ?? {};
      control = (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t('web.form.latitude')}
            type="number"
            step="any"
            placeholder={t('web.form.latitude')}
            value={p.lat ?? ''}
            onChange={(e) =>
              onChange({ ...p, lat: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            className="w-36"
          />
          <Input
            aria-label={t('web.form.longitude')}
            type="number"
            step="any"
            placeholder={t('web.form.longitude')}
            value={p.lon ?? ''}
            onChange={(e) =>
              onChange({ ...p, lon: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            className="w-36"
          />
          <button
            type="button"
            onClick={() => navigator.geolocation?.getCurrentPosition((pos) => onChange({ lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6) }))}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-600"
          >
            <LocateFixed className="size-4" /> {t('web.form.useMyLocation')}
          </button>
        </div>
      );
      break;
    }
    default:
      control = <Input id={id} maxLength={q.type === 'text' ? q.maxLength : undefined} readOnly={q.type === 'text' && !!q.generate} type={q.type === 'phone' ? 'tel' : q.type === 'email' ? 'email' : q.type === 'url' ? 'url' : undefined} inputMode={q.type === 'phone' ? 'tel' : q.type === 'email' ? 'email' : q.type === 'url' ? 'url' : undefined} placeholder={q.placeholder} aria-invalid={invalid} aria-describedby={described} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div>
      {label}
      {control}
      {note}
    </div>
  );
}

/** "YYYY-MM-DDTHH:MM" in the viewer's own time zone. */
const localDateTime = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function AnswerValue({ q, v }: { q: Question; v: unknown }) {
  const env = useFormEnv();
  if (env && Array.isArray(v) && (q.type === 'image' || q.type === 'file'))
    return (
      <span className="flex flex-wrap gap-2">
        {v.map((id) => (typeof id !== 'string' ? null : q.type === 'file' ? <AttachmentLink key={id} tenantId={env.tenantId} project={env.project} id={id} /> : <AttachmentImage key={id} tenantId={env.tenantId} project={env.project} id={id} className="h-24 w-32 border border-zinc-200" />))}
      </span>
    );
  if (env && typeof v === 'string' && q.type === 'file') return <AttachmentLink tenantId={env.tenantId} project={env.project} id={v} />;
  if (env && typeof v === 'string' && (q.type === 'image' || q.type === 'signature')) return <AttachmentImage tenantId={env.tenantId} project={env.project} id={v} className="h-24 w-32 border border-zinc-200" />;
  if (env && typeof v === 'string' && q.type === 'entity') return <EntityName tenantId={env.tenantId} project={env.project} id={v} />;
  return <>{answerText(q, v)}</>;
}

/** An answer as people read it. */
function answerText(q: Question, v: unknown): string {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  const label = (x: unknown) => q.options?.find((o) => o.value === x)?.label ?? String(x);
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (q.type === 'geopoint' && typeof v === 'object') {
    const p = v as { lat?: number; lon?: number };
    return p.lat !== undefined && p.lon !== undefined ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : '—';
  }
  return label(v);
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { lintDefinition } from '@grids/forms';
import { QUESTION_TYPES, type FormDefinition, type Question, type QuestionType } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, Loading, Select, SwitchField, Textarea, cx, useToast } from '@grids/ui';
import { AlertTriangle, ArrowDown, ArrowUp, Eye, Plus, Rocket, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useProject } from './context';
import { useTypes } from './EntitiesTab';
import { FormRenderer, type Answers } from './FormRenderer';

const TYPE_LABEL: Record<QuestionType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  integer: 'Whole number',
  decimal: 'Decimal number',
  select: 'Single choice',
  multiselect: 'Multiple choice',
  boolean: 'Yes / no',
  date: 'Date',
  datetime: 'Date and time',
  geopoint: 'Location',
  note: 'Note (no answer)',
  calculate: 'Calculation',
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 60) || 'question';

/** Drafts a form: sections and questions, expressions linted live, with a preview. */
export function FormBuilder() {
  const { tenantId, project, base } = useProject();
  const { formKey } = useParams({ strict: false }) as { formKey: string };
  const qc = useQueryClient();
  const toast = useToast();
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const types = useTypes();
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const form = forms.data?.find((f) => f.key === formKey);
  const [def, setDef] = useState<FormDefinition | null>(null);
  const [sel, setSel] = useState<{ s: number; q: number } | null>({ s: 0, q: 0 });
  const [preview, setPreview] = useState<Answers>({});
  useEffect(() => {
    if (form && !def) setDef(structuredClone(form.draft));
  }, [form, def]);

  const problems = useMemo(() => (def ? lintDefinition(def) : []), [def]);
  const dirty = !!form && !!def && JSON.stringify(def) !== JSON.stringify(form.draft);
  const save = useMutation({
    mutationFn: () => api.saveForm(tenantId, project.key, { key: form!.key, name: form!.name, description: form!.description, subjectType: form!.subjectType?.key ?? null, definition: def! }, form!.key),
    onSuccess: (data) => {
      qc.setQueryData(['forms', tenantId, project.key], data);
      toast('Draft saved');
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return api.publishForm(tenantId, project.key, form!.key);
    },
    onSuccess: (data) => {
      qc.setQueryData(['forms', tenantId, project.key], data);
      toast(`Published version ${data.find((f) => f.key === form!.key)?.currentVersion}`);
    },
  });

  if (forms.isPending || !def) return <Loading />;
  if (!form) return <ErrorNotice error={new Error('Form not found')} />;
  const subjectType = types.data?.find((t) => t.key === form.subjectType?.key);

  const setSection = (si: number, patch: Partial<FormDefinition['sections'][number]>) =>
    setDef({ ...def, sections: def.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const setQuestion = (si: number, qi: number, patch: Partial<Question>) =>
    setSection(si, { questions: def.sections[si]!.questions.map((q, i) => (i === qi ? ({ ...q, ...patch } as Question) : q)) });
  const addQuestion = (si: number) => {
    const qs = def.sections[si]!.questions;
    let key = 'question';
    for (let n = 2; def.sections.some((s) => s.questions.some((q) => q.key === key)); n++) key = `question_${n}`;
    setSection(si, { questions: [...qs, { key, type: 'text', label: 'New question' }] });
    setSel({ s: si, q: qs.length });
  };
  const moveQ = (si: number, qi: number, d: -1 | 1) => {
    const qs = [...def.sections[si]!.questions];
    const j = qi + d;
    if (j < 0 || j >= qs.length) return;
    [qs[qi], qs[j]] = [qs[j]!, qs[qi]!];
    setSection(si, { questions: qs });
    setSel({ s: si, q: j });
  };
  const q = sel ? def.sections[sel.s]?.questions[sel.q] : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`${base}/forms`} className="text-sm text-accent-700 hover:underline">
            ← Forms
          </Link>
          <h2 className="mt-1 text-xl font-semibold">{form.name}</h2>
          <p className="text-xs text-zinc-500">
            {form.currentVersion ? `Published v${form.currentVersion}` : 'Never published'}
            {form.subjectType && ` · about a ${form.subjectType.name.toLowerCase()}`}
            {dirty && ' · unsaved changes'}
          </p>
        </div>
        <Button variant="secondary" icon={Save} onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Save draft
        </Button>
        <Button icon={Rocket} onClick={() => publish.mutate()} loading={publish.isPending} disabled={problems.length > 0}>
          Publish
        </Button>
      </div>
      <ErrorNotice error={save.error ?? publish.error} />
      {problems.length > 0 && (
        <div className="border-s-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" /> Fix before publishing
          </div>
          <ul className="list-disc ps-6">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Outline */}
        <div className="space-y-3">
          <Field label="Title">
            <Input value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} />
          </Field>
          <Field label="Reporting period" hint="Indicator values are recorded for the start of this period">
            <Select value={def.period} onChange={(e) => setDef({ ...def, period: e.target.value as FormDefinition['period'] })}>
              <option value="none">Exact collection time</option>
              <option value="day">Day</option>
              <option value="week">Week (Monday)</option>
              <option value="month">Month</option>
            </Select>
          </Field>
          {def.sections.map((s, si) => (
            <div key={si} className="border border-zinc-200 bg-snow">
              <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
                <Input aria-label="Section title" value={s.title} placeholder="Section title" onChange={(e) => setSection(si, { title: e.target.value })} />
                {def.sections.length > 1 && (
                  <button type="button" aria-label="Remove section" className="p-1 text-zinc-500 hover:text-red-700" onClick={() => setDef({ ...def, sections: def.sections.filter((_, i) => i !== si) })}>
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <ol>
                {s.questions.map((qq, qi) => (
                  <li key={qi}>
                    <button
                      type="button"
                      onClick={() => setSel({ s: si, q: qi })}
                      className={cx('flex w-full items-center gap-2 border-s-[3px] px-3 py-2 text-start text-sm', sel?.s === si && sel.q === qi ? 'border-accent-600 bg-accent-50' : 'border-transparent hover:bg-zinc-50')}
                    >
                      <span className="min-w-0 flex-1 truncate">{qq.label || <em className="text-zinc-400">untitled</em>}</span>
                      <span className="shrink-0 text-[11px] text-zinc-500">{TYPE_LABEL[qq.type]}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" onClick={() => addQuestion(si)} className="flex w-full items-center gap-1.5 border-t border-zinc-100 px-3 py-2 text-sm text-accent-700 hover:bg-zinc-50">
                <Plus className="size-4" /> Add question
              </button>
            </div>
          ))}
          <Button
            variant="secondary"
            icon={Plus}
            onClick={() => setDef({ ...def, sections: [...def.sections, { key: `section_${def.sections.length + 1}`, title: 'New section', questions: [] }] })}
          >
            Add section
          </Button>
        </div>

        {/* Question editor */}
        <div className="border border-zinc-200 bg-snow p-4">
          {q && sel ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Question</h3>
                <span className="flex gap-0.5">
                  <button type="button" aria-label="Move up" className="p-1 text-zinc-500 hover:text-ink" onClick={() => moveQ(sel.s, sel.q, -1)}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label="Move down" className="p-1 text-zinc-500 hover:text-ink" onClick={() => moveQ(sel.s, sel.q, 1)}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete question"
                    className="p-1 text-zinc-500 hover:text-red-700"
                    onClick={() => {
                      setSection(sel.s, { questions: def.sections[sel.s]!.questions.filter((_, i) => i !== sel.q) });
                      setSel(null);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </div>
              <Field label="Label">
                <Textarea
                  value={q.label}
                  onChange={(e) => setQuestion(sel.s, sel.q, { label: e.target.value, ...(q.key.startsWith('question') ? { key: slug(e.target.value) } : {}) })}
                  className="min-h-16"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <Select value={q.type} onChange={(e) => setQuestion(sel.s, sel.q, { type: e.target.value as QuestionType })}>
                    {QUESTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Key" hint="Used in expressions as ${key}">
                  <Input value={q.key} onChange={(e) => setQuestion(sel.s, sel.q, { key: e.target.value })} className="font-mono" />
                </Field>
              </div>
              {q.type !== 'note' && q.type !== 'calculate' && <SwitchField label="Required" checked={!!q.required} onChange={(v) => setQuestion(sel.s, sel.q, { required: v })} />}
              <Field label="Hint">
                <Input value={q.hint ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { hint: e.target.value || undefined })} />
              </Field>
              {(q.type === 'select' || q.type === 'multiselect') && (
                <Field label="Options" hint="One per line, optionally value|label">
                  <Textarea
                    value={(q.options ?? []).map((o) => (o.value === o.label ? o.value : `${o.value}|${o.label}`)).join('\n')}
                    onChange={(e) =>
                      setQuestion(sel.s, sel.q, {
                        options: e.target.value
                          .split('\n')
                          .map((l) => l.trim())
                          .filter(Boolean)
                          .map((l) => {
                            const [v, ...rest] = l.split('|');
                            return { value: v!.trim(), label: (rest.join('|') || v!).trim() };
                          }),
                      })
                    }
                  />
                </Field>
              )}
              {(q.type === 'integer' || q.type === 'decimal') && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Minimum">
                    <Input type="number" value={q.min ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </Field>
                  <Field label="Maximum">
                    <Input type="number" value={q.max ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </Field>
                </div>
              )}
              <details className="border-t border-zinc-200 pt-3" open={!!(q.relevant || q.constraint || q.calculation || q.type === 'calculate')}>
                <summary className="cursor-pointer text-sm font-medium">Logic</summary>
                <div className="mt-3 space-y-3">
                  <Field label="Show only when" hint="e.g. ${age} >= 18 and selected(${symptoms}, 'fever')">
                    <Input value={q.relevant ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { relevant: e.target.value || undefined })} className="font-mono text-xs" />
                  </Field>
                  {q.type !== 'note' && q.type !== 'calculate' && (
                    <>
                      <Field label="Valid when" hint=". is this answer, e.g. . <= ${cases}">
                        <Input value={q.constraint ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { constraint: e.target.value || undefined })} className="font-mono text-xs" />
                      </Field>
                      {q.constraint && (
                        <Field label="Message when invalid">
                          <Input value={q.constraintMessage ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { constraintMessage: e.target.value || undefined })} />
                        </Field>
                      )}
                    </>
                  )}
                  {q.type === 'calculate' && (
                    <Field label="Calculation" hint="e.g. round(${weight} div (${height} * ${height}), 1)">
                      <Input value={q.calculation ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { calculation: e.target.value || undefined })} className="font-mono text-xs" />
                    </Field>
                  )}
                </div>
              </details>
              {subjectType && q.type !== 'note' && (
                <details className="border-t border-zinc-200 pt-3" open={!!q.bind}>
                  <summary className="cursor-pointer text-sm font-medium">Save answer to</summary>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label={`${subjectType.name} attribute`}>
                      <Select value={q.bind?.attribute ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { bind: e.target.value || q.bind?.element ? { ...q.bind, attribute: e.target.value || undefined } : undefined })}>
                        <option value="">—</option>
                        {subjectType.attributes.map((a) => (
                          <option key={a.key} value={a.key}>
                            {a.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Indicator">
                      <Select value={q.bind?.element ?? ''} onChange={(e) => setQuestion(sel.s, sel.q, { bind: e.target.value || q.bind?.attribute ? { ...q.bind, element: e.target.value || undefined } : undefined })}>
                        <option value="">—</option>
                        {elements.data?.map((el) => (
                          <option key={el.key} value={el.key}>
                            {el.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-zinc-500">Select a question to edit it.</p>
          )}
        </div>

        {/* Live preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <Eye className="size-4" /> Preview
            </span>
            <button type="button" className="text-xs text-accent-700 hover:underline" onClick={() => setPreview({})}>
              Reset answers
            </button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto bg-canvas">
            {problems.length ? <p className="p-4 text-sm text-zinc-500">The preview updates once the problems above are fixed.</p> : <FormRenderer definition={def} answers={preview} onChange={setPreview} />}
          </div>
        </div>
      </div>
    </div>
  );
}

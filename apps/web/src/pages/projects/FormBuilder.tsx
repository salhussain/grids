import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { lintDefinition } from '@grids/forms';
import { QUESTION_TYPES, type FormDefinition, type FormSettings, type Question, type QuestionType, type Section } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, Loading, Select, SwitchField, Textarea, cx, useToast } from '@grids/ui';
import {
  AlertTriangle,
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calculator,
  Calendar,
  CalendarClock,
  CircleDot,
  Copy,
  Eye,
  GitBranch,
  Hash,
  Info,
  Link2,
  ListChecks,
  MapPin,
  Palette,
  Percent,
  Plus,
  Rocket,
  Save,
  Shapes,
  ToggleLeft,
  Trash2,
  Type,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useProject } from './context';
import { useTypes } from './EntitiesTab';
import { AccessPanel, DesignPanel, PreviewDialog } from './FormBuilderPanels';

export const TYPE_INFO: Record<QuestionType, { label: string; icon: LucideIcon }> = {
  text: { label: 'Short text', icon: Type },
  textarea: { label: 'Long text', icon: AlignLeft },
  integer: { label: 'Whole number', icon: Hash },
  decimal: { label: 'Decimal', icon: Percent },
  select: { label: 'Single choice', icon: CircleDot },
  multiselect: { label: 'Multiple choice', icon: ListChecks },
  boolean: { label: 'Yes / no', icon: ToggleLeft },
  date: { label: 'Date', icon: Calendar },
  datetime: { label: 'Date & time', icon: CalendarClock },
  geopoint: { label: 'Location', icon: MapPin },
  note: { label: 'Note', icon: Info },
  calculate: { label: 'Calculation', icon: Calculator },
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 60) || 'question';

type Sel = { kind: 'q'; s: number; q: number } | { kind: 's'; s: number } | null;
type Tab = 'build' | 'design' | 'access';
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'build', label: 'Questions', icon: Shapes },
  { id: 'design', label: 'Layout & design', icon: Palette },
  { id: 'access', label: 'Access & workflow', icon: Workflow },
];

export interface Draft {
  def: FormDefinition;
  settings: FormSettings;
  groupId: string | null;
  name: string;
  description: string;
}

/** Builds a form: questions on a canvas with an inspector, its layout, and who fills and approves it. */
export function FormBuilder() {
  const { tenantId, project, base } = useProject();
  const { formKey } = useParams({ strict: false }) as { formKey: string };
  const qc = useQueryClient();
  const toast = useToast();
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const form = forms.data?.find((f) => f.key === formKey);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sel, setSel] = useState<Sel>({ kind: 'q', s: 0, q: 0 });
  const [tab, setTab] = useState<Tab>('build');
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (form && !draft)
      setDraft({ def: structuredClone(form.draft), settings: structuredClone(form.settings), groupId: form.groupId, name: form.name, description: form.description });
  }, [form, draft]);

  const problems = useMemo(() => (draft ? lintDefinition(draft.def) : []), [draft]);
  const saved = form ? JSON.stringify({ def: form.draft, settings: form.settings, groupId: form.groupId, name: form.name, description: form.description }) : '';
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const defChanged = !!form && !!draft && JSON.stringify(draft.def) !== JSON.stringify(form.published);
  const save = useMutation({
    mutationFn: () =>
      api.saveForm(
        tenantId,
        project.key,
        { key: form!.key, name: draft!.name, description: draft!.description, subjectType: form!.subjectType?.key ?? null, groupId: draft!.groupId, settings: draft!.settings, definition: draft!.def },
        form!.key,
      ),
    onSuccess: (data) => {
      qc.setQueryData(['forms', tenantId, project.key], data);
      void qc.invalidateQueries({ queryKey: ['forms-menu', tenantId] });
      toast('Saved');
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return api.publishForm(tenantId, project.key, form!.key);
    },
    onSuccess: (data) => {
      qc.setQueryData(['forms', tenantId, project.key], data);
      void qc.invalidateQueries({ queryKey: ['forms-menu', tenantId] });
      toast(`Published version ${data.find((f) => f.key === form!.key)?.currentVersion}`);
    },
  });

  if (forms.isPending || (form && !draft)) return <Loading />;
  if (!form || !draft) return <ErrorNotice error={new Error('Form not found')} />;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setDef = (def: FormDefinition) => set({ def });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`${base}/forms`} aria-label="Back to forms" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <input
            aria-label="Form name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            className="w-full truncate rounded-md bg-transparent px-1 text-xl font-semibold tracking-tight outline-none hover:bg-zinc-100 focus:bg-snow focus:ring-2 focus:ring-accent-600/20"
          />
          <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-zinc-500">
            {form.currentVersion ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Live · v{form.currentVersion}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-zinc-400" /> Draft
              </span>
            )}
            {form.subjectType && <span>· about a {form.subjectType.name.toLowerCase()}</span>}
            {draft.settings.workflow.enabled && (
              <span className="inline-flex items-center gap-1 text-sky-700">
                · <GitBranch className="size-3" /> {draft.settings.workflow.stages.length}-stage approval
              </span>
            )}
            {dirty && <span className="text-amber-700">· unsaved changes</span>}
            {!dirty && form.currentVersion && defChanged && <span className="text-amber-700">· questions changed since v{form.currentVersion}</span>}
          </p>
        </div>
        <Button variant="secondary" icon={Eye} onClick={() => setPreview(true)} disabled={problems.length > 0}>
          Preview
        </Button>
        <Button variant="secondary" icon={Save} onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Save
        </Button>
        <Button icon={Rocket} onClick={() => publish.mutate()} loading={publish.isPending} disabled={problems.length > 0 || (!dirty && !defChanged)}>
          Publish
        </Button>
      </div>
      <div role="tablist" className="inline-flex gap-1 rounded-xl bg-zinc-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx('inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition', tab === t.id ? 'bg-snow font-medium text-ink shadow-sm ring-1 ring-zinc-200' : 'text-zinc-600 hover:text-ink')}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>
      <ErrorNotice error={save.error ?? publish.error} />
      {problems.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
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
      {tab === 'build' && <BuildTab def={draft.def} setDef={setDef} sel={sel} setSel={setSel} subjectTypeKey={form.subjectType?.key ?? null} />}
      {tab === 'design' && <DesignPanel draft={draft} set={set} />}
      {tab === 'access' && <AccessPanel draft={draft} set={set} />}
      {preview && <PreviewDialog def={draft.def} onClose={() => setPreview(false)} />}
    </div>
  );
}

function BuildTab({ def, setDef, sel, setSel, subjectTypeKey }: { def: FormDefinition; setDef(d: FormDefinition): void; sel: Sel; setSel(s: Sel): void; subjectTypeKey: string | null }) {
  const paged = def.layout === 'steps';
  const setSection = (si: number, patch: Partial<Section>) => setDef({ ...def, sections: def.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const setQuestion = (si: number, qi: number, patch: Partial<Question>) =>
    setSection(si, { questions: def.sections[si]!.questions.map((q, i) => (i === qi ? ({ ...q, ...patch } as Question) : q)) });
  const freeKey = (stem: string) => {
    let key = stem;
    for (let n = 2; def.sections.some((s) => s.questions.some((q) => q.key === key)); n++) key = `${stem}_${n}`;
    return key;
  };
  const add = (type: QuestionType) => {
    const si = sel ? sel.s : def.sections.length - 1;
    const qs = [...def.sections[si]!.questions];
    const at = sel?.kind === 'q' ? sel.q + 1 : qs.length;
    const q: Question = {
      key: freeKey(type === 'note' ? 'note' : type === 'calculate' ? 'calc' : 'question'),
      type,
      label: type === 'note' ? 'Read this first' : `New ${TYPE_INFO[type].label.toLowerCase()} question`,
      ...(type === 'select' || type === 'multiselect'
        ? {
            options: [
              { value: 'a', label: 'Option A' },
              { value: 'b', label: 'Option B' },
            ],
          }
        : {}),
      ...(type === 'calculate' ? { calculation: '1 + 1' } : {}),
    };
    qs.splice(at, 0, q);
    setSection(si, { questions: qs });
    setSel({ kind: 'q', s: si, q: at });
  };
  const moveQ = (si: number, qi: number, d: -1 | 1) => {
    const qs = [...def.sections[si]!.questions];
    const j = qi + d;
    if (j < 0) {
      if (si === 0) return;
      // Move into the end of the previous section.
      const [q] = qs.splice(qi, 1);
      const prev = [...def.sections[si - 1]!.questions, q!];
      setDef({ ...def, sections: def.sections.map((s, i) => (i === si ? { ...s, questions: qs } : i === si - 1 ? { ...s, questions: prev } : s)) });
      setSel({ kind: 'q', s: si - 1, q: prev.length - 1 });
      return;
    }
    if (j >= qs.length) {
      if (si === def.sections.length - 1) return;
      const [q] = qs.splice(qi, 1);
      const next = [q!, ...def.sections[si + 1]!.questions];
      setDef({ ...def, sections: def.sections.map((s, i) => (i === si ? { ...s, questions: qs } : i === si + 1 ? { ...s, questions: next } : s)) });
      setSel({ kind: 'q', s: si + 1, q: 0 });
      return;
    }
    [qs[qi], qs[j]] = [qs[j]!, qs[qi]!];
    setSection(si, { questions: qs });
    setSel({ kind: 'q', s: si, q: j });
  };
  const moveS = (si: number, d: -1 | 1) => {
    const ss = [...def.sections];
    const j = si + d;
    if (j < 0 || j >= ss.length) return;
    [ss[si], ss[j]] = [ss[j]!, ss[si]!];
    setDef({ ...def, sections: ss });
    setSel({ kind: 's', s: j });
  };
  const addSection = () => {
    let key = `section_${def.sections.length + 1}`;
    for (let n = 2; def.sections.some((s) => s.key === key); n++) key = `section_${def.sections.length + n}`;
    setDef({ ...def, sections: [...def.sections, { key, title: paged ? `Page ${def.sections.length + 1}` : 'New section', questions: [] }] });
    setSel({ kind: 's', s: def.sections.length });
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_360px]">
      {/* Palette + outline */}
      <aside className="space-y-5 lg:sticky lg:top-4">
        <div>
          <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Add a question</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {QUESTION_TYPES.map((t) => {
              const I = TYPE_INFO[t].icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => add(t)}
                  className="flex flex-col items-start gap-1.5 rounded-xl border border-zinc-200 bg-snow px-2.5 py-2 text-start text-xs text-zinc-700 transition hover:-translate-y-px hover:border-accent-300 hover:text-ink hover:shadow-sm"
                >
                  <I className="size-4 text-accent-600" />
                  {TYPE_INFO[t].label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{paged ? 'Pages' : 'Sections'}</h3>
          <ol className="space-y-0.5">
            {def.sections.map((s, si) => (
              <li key={si}>
                <button
                  type="button"
                  onClick={() => {
                    setSel({ kind: 's', s: si });
                    document.getElementById(`section-${si}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm', sel?.s === si ? 'bg-accent-50 text-accent-800' : 'hover:bg-zinc-100')}
                >
                  <span className="num flex size-5 shrink-0 items-center justify-center rounded-md bg-zinc-200/70 text-[10px] text-zinc-600">{si + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title || <em className="text-zinc-400">Untitled</em>}</span>
                  <span className="num text-[11px] text-zinc-400">{s.questions.length}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={addSection} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-accent-700 hover:bg-accent-50">
            <Plus className="size-4" /> {paged ? 'Add page' : 'Add section'}
          </button>
        </div>
      </aside>

      {/* Canvas */}
      <div className="min-w-0 space-y-3 rounded-3xl bg-zinc-100/70 p-3 ring-1 ring-zinc-200/70 sm:p-5">
        <div className="rounded-2xl bg-snow px-5 py-4 ring-1 ring-zinc-200">
          <input aria-label="Form title" value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} className="w-full bg-transparent text-lg font-semibold tracking-tight outline-none" />
          <input
            aria-label="Form description"
            value={def.description}
            onChange={(e) => setDef({ ...def, description: e.target.value })}
            placeholder="Add a short description for the people filling this in"
            className="mt-0.5 w-full bg-transparent text-sm text-zinc-600 outline-none placeholder:text-zinc-400"
          />
        </div>
        {def.sections.map((s, si) => (
          <div key={si} id={`section-${si}`} className="scroll-mt-4">
            {si > 0 && paged && (
              <div className="my-4 flex items-center gap-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase" aria-hidden>
                <span className="h-px flex-1 border-t border-dashed border-zinc-300" /> Page break <span className="h-px flex-1 border-t border-dashed border-zinc-300" />
              </div>
            )}
            <section className={cx('overflow-hidden rounded-2xl bg-snow ring-1 transition', sel?.kind === 's' && sel.s === si ? 'ring-2 ring-accent-500' : 'ring-zinc-200')}>
              <header className="group flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
                <span className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent-700 uppercase">
                  {paged ? `Page ${si + 1}` : `Section ${si + 1}`}
                </span>
                <input
                  aria-label="Section title"
                  value={s.title}
                  placeholder="Untitled"
                  onFocus={() => setSel({ kind: 's', s: si })}
                  onChange={(e) => setSection(si, { title: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-zinc-400"
                />
                {s.relevant && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700" title={`Shown when ${s.relevant}`}>
                    <GitBranch className="size-3" /> Conditional
                  </span>
                )}
                <span className="flex opacity-60 transition group-hover:opacity-100">
                  <IconBtn label="Move up" icon={ArrowUp} onClick={() => moveS(si, -1)} />
                  <IconBtn label="Move down" icon={ArrowDown} onClick={() => moveS(si, 1)} />
                  <IconBtn label="Section logic" icon={GitBranch} onClick={() => setSel({ kind: 's', s: si })} />
                  {def.sections.length > 1 && (
                    <IconBtn
                      label="Delete section"
                      icon={Trash2}
                      danger
                      onClick={() => {
                        setDef({ ...def, sections: def.sections.filter((_, i) => i !== si) });
                        setSel(null);
                      }}
                    />
                  )}
                </span>
              </header>
              <ol className="divide-y divide-zinc-100">
                {s.questions.map((q, qi) => {
                  const I = TYPE_INFO[q.type].icon;
                  const on = sel?.kind === 'q' && sel.s === si && sel.q === qi;
                  return (
                    <li key={qi} className={cx('group relative flex items-center gap-3 px-4 py-3 transition', on ? 'bg-accent-50/60' : 'hover:bg-zinc-50')}>
                      {on && <span className="absolute inset-y-2 start-0 w-1 rounded-e-full bg-accent-600" />}
                      <button type="button" onClick={() => setSel({ kind: 'q', s: si, q: qi })} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-accent-600 text-on-accent' : 'bg-zinc-100 text-zinc-600')}>
                          <I className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {q.label || <em className="font-normal text-zinc-400">Untitled</em>}
                            {q.required && <span className="text-accent-600"> *</span>}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                            <span className="font-mono">{q.key}</span>
                            <span>· {TYPE_INFO[q.type].label}</span>
                            {(q.relevant || q.constraint || q.calculation) && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 text-violet-700">
                                <GitBranch className="size-2.5" /> logic
                              </span>
                            )}
                            {q.bind && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-emerald-700">
                                <Link2 className="size-2.5" /> saves data
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                      <span className="flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <IconBtn label="Move up" icon={ArrowUp} onClick={() => moveQ(si, qi, -1)} />
                        <IconBtn label="Move down" icon={ArrowDown} onClick={() => moveQ(si, qi, 1)} />
                        <IconBtn
                          label="Duplicate"
                          icon={Copy}
                          onClick={() => {
                            const qs = [...s.questions];
                            qs.splice(qi + 1, 0, { ...structuredClone(q), key: freeKey(q.key) });
                            setSection(si, { questions: qs });
                            setSel({ kind: 'q', s: si, q: qi + 1 });
                          }}
                        />
                        <IconBtn
                          label="Delete question"
                          icon={Trash2}
                          danger
                          onClick={() => {
                            setSection(si, { questions: s.questions.filter((_, i) => i !== qi) });
                            setSel(null);
                          }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ol>
              {!s.questions.length && <p className="px-4 py-6 text-center text-sm text-zinc-400">Empty — pick a question type on the left to add one here.</p>}
            </section>
          </div>
        ))}
        <button
          type="button"
          onClick={addSection}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 py-3 text-sm text-zinc-500 transition hover:border-accent-400 hover:text-accent-700"
        >
          <Plus className="size-4" /> {paged ? 'Add a page' : 'Add a section'}
        </button>
      </div>

      {/* Inspector */}
      <aside className="rounded-2xl border border-zinc-200 bg-snow p-5 lg:col-span-2 xl:sticky xl:top-4 xl:col-span-1 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
        {sel?.kind === 'q' && def.sections[sel.s]?.questions[sel.q] ? (
          <QuestionInspector
            def={def}
            q={def.sections[sel.s]!.questions[sel.q]!}
            set={(patch) => setQuestion(sel.s, sel.q, patch)}
            subjectTypeKey={subjectTypeKey}
          />
        ) : sel?.kind === 's' && def.sections[sel.s] ? (
          <SectionInspector def={def} s={def.sections[sel.s]!} index={sel.s} paged={paged} set={(patch) => setSection(sel.s, patch)} />
        ) : (
          <div className="py-12 text-center text-sm text-zinc-500">
            <Shapes className="mx-auto mb-3 size-6 text-zinc-300" />
            Select a question or {paged ? 'page' : 'section'} to edit it.
          </div>
        )}
      </aside>
    </div>
  );
}

function IconBtn({ label, icon: I, onClick, danger }: { label: string; icon: LucideIcon; onClick(): void; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cx('rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100', danger ? 'hover:text-red-700' : 'hover:text-ink')}>
      <I className="size-3.5" />
    </button>
  );
}

/** Lists question keys usable in expressions, inserting `${key}` on click. */
function KeyChips({ def, onPick, exclude }: { def: FormDefinition; onPick(k: string): void; exclude?: string }) {
  const keys = def.sections.flatMap((s) => s.questions).filter((q) => q.key !== exclude && q.type !== 'note');
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {keys.slice(0, 24).map((q) => (
        <button key={q.key} type="button" onClick={() => onPick(q.key)} className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 hover:bg-accent-50 hover:text-accent-700" title={q.label}>
          {q.key}
        </button>
      ))}
    </div>
  );
}

function ExprField({ label, hint, value, onChange, def, exclude }: { label: string; hint: string; value: string | undefined; onChange(v: string | undefined): void; def: FormDefinition; exclude?: string }) {
  return (
    <div className="space-y-1.5">
      <Field label={label} hint={hint}>
        <Input value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="font-mono text-xs" />
      </Field>
      <KeyChips def={def} exclude={exclude} onPick={(k) => onChange(`${value ? `${value} ` : ''}\${${k}}`)} />
    </div>
  );
}

function Group({ title, icon: I, children, open = true }: { title: string; icon: LucideIcon; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-t border-zinc-100 pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <I className="size-4 text-zinc-400" /> {title}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

function SectionInspector({ def, s, index, paged, set }: { def: FormDefinition; s: Section; index: number; paged: boolean; set(patch: Partial<Section>): void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{paged ? `Page ${index + 1}` : `Section ${index + 1}`}</h3>
      <Field label="Title">
        <Input value={s.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Group title="Logic" icon={GitBranch}>
        <ExprField label={`Show this ${paged ? 'page' : 'section'} only when`} hint="Skipped entirely otherwise, e.g. ${outbreak} = true" value={s.relevant} onChange={(v) => set({ relevant: v })} def={def} />
      </Group>
    </div>
  );
}

function QuestionInspector({ def, q, set, subjectTypeKey }: { def: FormDefinition; q: Question; set(patch: Partial<Question>): void; subjectTypeKey: string | null }) {
  const { tenantId, project } = useProject();
  const types = useTypes();
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const subjectType = types.data?.find((t) => t.key === subjectTypeKey);
  const I = TYPE_INFO[q.type].icon;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-600 text-on-accent">
          <I className="size-4" />
        </span>
        <h3 className="text-sm font-semibold">Question</h3>
      </div>
      <Field label="Question">
        <Textarea value={q.label} onChange={(e) => set({ label: e.target.value, ...(q.key.startsWith('question') ? { key: slug(e.target.value) } : {}) })} className="min-h-16" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={q.type} onChange={(e) => set({ type: e.target.value as QuestionType })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_INFO[t].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Key" hint="${key} in logic">
          <Input value={q.key} onChange={(e) => set({ key: e.target.value })} className="font-mono" />
        </Field>
      </div>
      {q.type !== 'note' && q.type !== 'calculate' && <SwitchField label="Required" checked={!!q.required} onChange={(v) => set({ required: v })} />}
      <Field label="Help text">
        <Input value={q.hint ?? ''} onChange={(e) => set({ hint: e.target.value || undefined })} />
      </Field>
      {(q.type === 'select' || q.type === 'multiselect') && <OptionsEditor q={q} set={set} />}
      {(q.type === 'integer' || q.type === 'decimal') && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum">
            <Input type="number" value={q.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </Field>
          <Field label="Maximum">
            <Input type="number" value={q.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </Field>
        </div>
      )}
      <Group title="Logic" icon={GitBranch} open={!!(q.relevant || q.constraint || q.calculation || q.type === 'calculate')}>
        <ExprField label="Show only when" hint="e.g. ${age} >= 18 and selected(${symptoms}, 'fever')" value={q.relevant} onChange={(v) => set({ relevant: v })} def={def} exclude={q.key} />
        {q.type !== 'note' && q.type !== 'calculate' && (
          <>
            <ExprField label="Valid when" hint=". is this answer, e.g. . <= ${cases}" value={q.constraint} onChange={(v) => set({ constraint: v })} def={def} exclude={q.key} />
            {q.constraint && (
              <Field label="Message when invalid">
                <Input value={q.constraintMessage ?? ''} onChange={(e) => set({ constraintMessage: e.target.value || undefined })} />
              </Field>
            )}
          </>
        )}
        {q.type === 'calculate' && (
          <ExprField label="Calculation" hint="e.g. round(${weight} div (${height} * ${height}), 1)" value={q.calculation} onChange={(v) => set({ calculation: v })} def={def} exclude={q.key} />
        )}
      </Group>
      {subjectType && q.type !== 'note' && (
        <Group title="Save answer to" icon={Link2} open={!!q.bind}>
          <Field label={`${subjectType.name} attribute`}>
            <Select value={q.bind?.attribute ?? ''} onChange={(e) => set({ bind: e.target.value || q.bind?.element ? { ...q.bind, attribute: e.target.value || undefined } : undefined })}>
              <option value="">—</option>
              {subjectType.attributes.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Indicator">
            <Select value={q.bind?.element ?? ''} onChange={(e) => set({ bind: e.target.value || q.bind?.attribute ? { ...q.bind, element: e.target.value || undefined } : undefined })}>
              <option value="">—</option>
              {elements.data?.map((el) => (
                <option key={el.key} value={el.key}>
                  {el.name}
                </option>
              ))}
            </Select>
          </Field>
        </Group>
      )}
    </div>
  );
}

function OptionsEditor({ q, set }: { q: Question; set(patch: Partial<Question>): void }) {
  const options = q.options ?? [];
  const update = (next: typeof options) => set({ options: next });
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">Options</div>
      <ol className="space-y-1.5">
        {options.map((o, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className={cx('size-3.5 shrink-0 border border-zinc-400', q.type === 'select' ? 'rounded-full' : 'rounded')} />
            <Input
              aria-label={`Option ${i + 1} label`}
              value={o.label}
              onChange={(e) => {
                const label = e.target.value;
                const autoValue = o.value === slug(o.label) || o.value.length === 1;
                update(options.map((x, j) => (j === i ? { label, value: autoValue ? slug(label) || x.value : x.value } : x)));
              }}
              className="h-8"
            />
            <Input aria-label={`Option ${i + 1} value`} value={o.value} onChange={(e) => update(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="h-8 w-24 font-mono text-xs" />
            <IconBtn label="Remove option" icon={Trash2} danger onClick={() => update(options.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          let n = options.length + 1;
          while (options.some((o) => o.value === `option_${n}`)) n++;
          update([...options, { value: `option_${n}`, label: `Option ${n}` }]);
        }}
        className="mt-2 inline-flex items-center gap-1.5 text-sm text-accent-700 hover:underline"
      >
        <Plus className="size-3.5" /> Add option
      </button>
    </div>
  );
}

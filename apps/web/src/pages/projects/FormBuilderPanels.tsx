import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { references, validate } from '@grids/forms';
import { FORM_LAYOUTS, FORM_LAYOUT_INFO, PROJECT_ROLE_INFO, type FormDefinition, type FormLayout, type ProjectRole, type WorkflowStage } from '@grids/schema';
import { Button, Dialog, Field, Input, Select, SwitchField, Textarea, cx, useToast } from '@grids/ui';
import { ArrowDown, ArrowUp, CheckCircle2, ClipboardList, GitBranch, Monitor, Plus, Send, ShieldCheck, Smartphone, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useProject } from './context';
import type { Draft } from './FormBuilder';
import { FormRunner, type Answers } from './FormRenderer';
import { usePermissionGroups } from './permissions';

function Card({ title, description, icon: I, children, action }: { title: string; description?: string; icon: typeof Users; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-snow">
      <header className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700 ring-1 ring-accent-100">
          <I className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
        </div>
        {action}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- layout & design

/** A tiny drawing of each layout. */
function LayoutArt({ layout }: { layout: FormLayout }) {
  const bar = 'bg-zinc-300';
  if (layout === 'single')
    return (
      <div className="flex h-full flex-col gap-1.5 p-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1 rounded-md bg-snow p-1.5 ring-1 ring-zinc-200">
            <div className={cx(bar, 'h-1 w-2/3')} />
            <div className="h-1.5 rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    );
  if (layout === 'steps')
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cx('h-1 flex-1', i === 0 ? 'bg-accent-500' : 'bg-zinc-300')} />
          ))}
        </div>
        <div className="flex-1 space-y-1.5 rounded-md bg-snow p-2 ring-1 ring-zinc-200">
          <div className={cx(bar, 'h-1.5 w-1/2 bg-zinc-400')} />
          <div className="h-1.5 rounded bg-zinc-100" />
          <div className="h-1.5 rounded bg-zinc-100" />
        </div>
        <div className="ms-auto h-2.5 w-8 rounded bg-accent-500" />
      </div>
    );
  return (
    <div className="flex h-full flex-col p-3">
      <div className="h-1 bg-zinc-200">
        <div className="h-1 w-2/5 bg-accent-500" />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 px-2">
        <div className={cx(bar, 'h-2 w-4/5 bg-zinc-400')} />
        <div className="h-3 rounded bg-snow ring-1 ring-zinc-200" />
      </div>
    </div>
  );
}

export function DesignPanel({ draft, set }: { draft: Draft; set(p: Partial<Draft>): void }) {
  const { tenantId } = useProject();
  const groups = useQuery({ queryKey: ['form-groups', tenantId], queryFn: () => api.formGroups(tenantId) });
  const def = draft.def;
  const setDef = (patch: Partial<FormDefinition>) => set({ def: { ...def, ...patch } });
  const tree = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const g of (groups.data ?? []).filter((x) => x.parentId === parent)) {
        out.push({ id: g.id, name: g.name, depth });
        walk(g.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [groups.data]);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-5">
        <Card title="Layout" description="How people move through the form. Sections become pages in multi-step forms." icon={ClipboardList}>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Layout">
            {FORM_LAYOUTS.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={def.layout === l}
                onClick={() => setDef({ layout: l })}
                className={cx(
                  'flex flex-col overflow-hidden rounded-xl border text-start transition',
                  def.layout === l ? 'border-accent-500 ring-2 ring-accent-500/30' : 'border-zinc-200 hover:border-zinc-400',
                )}
              >
                <div className="h-28 bg-zinc-100">
                  <LayoutArt layout={l} />
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {def.layout === l && <CheckCircle2 className="size-4 text-accent-600" />}
                    {FORM_LAYOUT_INFO[l].label}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{FORM_LAYOUT_INFO[l].description}</p>
                </div>
              </button>
            ))}
          </div>
        </Card>
        <Card title="Words" icon={Send}>
          <Field label="Name in menus and lists">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Summary" hint="Shown on the form’s card in the Forms menu">
            <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Heading on the form">
            <Input value={def.title} onChange={(e) => setDef({ title: e.target.value })} />
          </Field>
          <Field label="Introduction">
            <Textarea value={def.description} onChange={(e) => setDef({ description: e.target.value })} className="min-h-16" />
          </Field>
          <Field label="Thank-you message" hint="Shown after submitting">
            <Textarea value={def.thankYou} onChange={(e) => setDef({ thankYou: e.target.value })} className="min-h-16" placeholder="Thanks — your report has been recorded." />
          </Field>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Forms menu" description="Where people find it in the sidebar" icon={GitBranch}>
            <Field label="Group">
              <Select value={draft.groupId ?? ''} onChange={(e) => set({ groupId: e.target.value || null })}>
                <option value="">Not in a group</option>
                {tree.map((g) => (
                  <option key={g.id} value={g.id}>
                    {'  '.repeat(g.depth * 2)}
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Link to={`/o/${tenantId}/forms`} className="text-xs text-accent-700 hover:underline">
              Manage groups →
            </Link>
          </Card>
          <Card title="Data" icon={ClipboardList}>
            <Field label="Reporting period" hint="Indicator values are recorded for the start of this period">
              <Select value={def.period} onChange={(e) => setDef({ period: e.target.value as FormDefinition['period'] })}>
                <option value="none">Exact collection time</option>
                <option value="day">Day</option>
                <option value="week">Week (Monday)</option>
                <option value="month">Month</option>
              </Select>
            </Field>
          </Card>
        </div>
      </div>
      <div className="xl:sticky xl:top-4">
        <div className="mb-2 flex items-center justify-between px-1 text-xs text-zinc-500">
          <span>Live preview</span>
          <span>{FORM_LAYOUT_INFO[def.layout].label}</span>
        </div>
        <PreviewFrame def={def} device="phone" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- preview

function PreviewFrame({ def, device }: { def: FormDefinition; device: 'phone' | 'desktop' }) {
  const toast = useToast();
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const body = (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{def.title}</h2>
        {def.description && <p className="text-sm text-zinc-600">{def.description}</p>}
      </div>
      <FormRunner
        definition={def}
        answers={answers}
        onChange={setAnswers}
        errors={errors}
        onErrors={setErrors}
        onSubmit={() => {
          const r = validate(def, answers);
          setErrors(r.errors);
          toast(r.ok ? 'Preview: every answer is valid — nothing was saved' : 'Preview: some answers need attention');
        }}
        secondary={
          <Button variant="ghost" size="sm" onClick={() => (setAnswers({}), setErrors({}))}>
            Reset
          </Button>
        }
      />
    </div>
  );
  if (device === 'desktop') return <div className="max-h-[70vh] overflow-y-auto rounded-2xl bg-canvas ring-1 ring-zinc-200">{body}</div>;
  return (
    <div className="mx-auto w-full max-w-[390px] rounded-[2.5rem] bg-zinc-900 p-2.5 shadow-2xl">
      <div className="relative overflow-hidden rounded-[2rem] bg-canvas">
        <div className="absolute inset-x-0 top-0 z-10 flex h-7 justify-center">
          <div className="mt-2 h-4 w-24 bg-zinc-900" />
        </div>
        <div className="h-[640px] overflow-y-auto pt-7">{body}</div>
      </div>
    </div>
  );
}

export function PreviewDialog({ def, onClose }: { def: FormDefinition; onClose(): void }) {
  const [device, setDevice] = useState<'phone' | 'desktop'>('desktop');
  return (
    <Dialog open wide onClose={onClose} title="Preview" description="Try the form with live logic; nothing is saved.">
      <div className="mb-4 inline-flex gap-1 rounded-xl bg-zinc-100 p-1">
        {(
          [
            ['desktop', Monitor, 'Desktop'],
            ['phone', Smartphone, 'Phone'],
          ] as const
        ).map(([d, I, l]) => (
          <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} className={cx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm', device === d ? 'bg-snow shadow-sm ring-1 ring-zinc-200' : 'text-zinc-600')}>
            <I className="size-4" /> {l}
          </button>
        ))}
      </div>
      <PreviewFrame key={device} def={def} device={device} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- access & workflow

const FILL_ROLES: { role: ProjectRole; label: string }[] = [
  { role: 'viewer', label: 'Everyone in the project' },
  { role: 'editor', label: 'Editors and managers' },
  { role: 'manager', label: 'Managers only' },
];

function GroupPicker({ value, onChange, label, none }: { value: string | null; onChange(v: string | null): void; label: string; none: string }) {
  const groups = usePermissionGroups();
  return (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{none}</option>
        {groups.data?.map((g) => (
          <option key={g.key} value={g.key}>
            {'  '.repeat(g.depth * 2)}
            {g.name} (and above)
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function AccessPanel({ draft, set }: { draft: Draft; set(p: Partial<Draft>): void }) {
  const s = draft.settings;
  const wf = s.workflow;
  const setSettings = (patch: Partial<typeof s>) => set({ settings: { ...s, ...patch } });
  const setWf = (patch: Partial<typeof wf>) => setSettings({ workflow: { ...wf, ...patch } });
  const setStage = (i: number, patch: Partial<WorkflowStage>) => setWf({ stages: wf.stages.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= wf.stages.length) return;
    const st = [...wf.stages];
    [st[i], st[j]] = [st[j]!, st[i]!];
    setWf({ stages: st });
  };
  const addStage = () => {
    let n = wf.stages.length + 1;
    while (wf.stages.some((x) => x.key === `stage_${n}`)) n++;
    setWf({
      enabled: true,
      stages: [
        ...wf.stages,
        { key: `stage_${n}`, name: wf.stages.length ? `Stage ${n}` : 'Supervisor review', description: '', approvers: { role: 'manager', group: null, users: [] }, condition: '', allowReturn: true },
      ],
    });
  };
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card title="Who can fill it in" description="People who don’t qualify won’t see the form in their menu." icon={Users}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project role">
              <Select value={s.fillRole} onChange={(e) => setSettings({ fillRole: e.target.value as ProjectRole })}>
                {FILL_ROLES.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <GroupPicker label="…who are in" none="Any permission group" value={s.fillGroup} onChange={(v) => setSettings({ fillGroup: v })} />
          </div>
        </Card>
        <Card
          title="Approval workflow"
          description="Submissions wait for each stage to approve before their data takes effect."
          icon={GitBranch}
          action={<SwitchField label="On" checked={wf.enabled} onChange={(v) => (v && !wf.stages.length ? addStage() : setWf({ enabled: v }))} />}
        >
          {!wf.enabled ? (
            <p className="text-sm text-zinc-500">Off — submissions are accepted immediately. Turn it on to add review stages, approvers and conditions.</p>
          ) : (
            <div>
              <FlowNode tone="start" label="Submitted" />
              {wf.stages.map((st, i) => (
                <div key={i}>
                  <Connector condition={st.condition} />
                  <StageCard def={draft.def} stage={st} index={i} count={wf.stages.length} set={(p) => setStage(i, p)} move={(d) => move(i, d)} remove={() => setWf({ stages: wf.stages.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <Connector />
              <button type="button" onClick={addStage} disabled={wf.stages.length >= 10} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 py-2.5 text-sm text-zinc-500 hover:border-accent-400 hover:text-accent-700 disabled:opacity-50">
                <Plus className="size-4" /> Add a stage
              </button>
              <Connector />
              <FlowNode tone="end" label="Approved — data takes effect" />
              <div className="mt-5 border-t border-zinc-100 pt-4">
                <SwitchField label="Authors may approve their own submissions" checked={wf.allowSelfApproval} onChange={(v) => setWf({ allowSelfApproval: v })} />
              </div>
            </div>
          )}
        </Card>
      </div>
      <aside className="space-y-3 rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-600 ring-1 ring-zinc-200 xl:sticky xl:top-4">
        <h3 className="flex items-center gap-2 font-semibold text-ink">
          <ShieldCheck className="size-4 text-accent-600" /> How approvals work
        </h3>
        <p>Each stage is decided by anyone who matches its approvers: a role, a permission group, or named people. Project managers can always act.</p>
        <p>
          A stage with a <span className="font-medium text-violet-700">condition</span> only applies when it’s true for the answers — e.g. send to national sign-off only when <code className="rounded bg-zinc-200/70 px-1 font-mono text-xs">{'${deaths} > 0'}</code>.
        </p>
        <p>Reviewers can approve, reject, or send it back with a comment; the author fixes and resubmits, and review starts again.</p>
        <p className="text-xs text-zinc-500">Access and workflow apply as soon as you save — no need to publish a new version.</p>
      </aside>
    </div>
  );
}

function FlowNode({ tone, label }: { tone: 'start' | 'end'; label: string }) {
  return (
    <div className="flex justify-center">
      <span className={cx('inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium', tone === 'start' ? 'bg-zinc-900 text-white' : 'bg-emerald-600 text-white')}>
        {tone === 'start' ? <Send className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} {label}
      </span>
    </div>
  );
}

function Connector({ condition }: { condition?: string }) {
  return (
    <div className="flex flex-col items-center py-1">
      <span className="h-3 w-px bg-zinc-300" />
      {condition && (
        <span className="max-w-full truncate bg-violet-50 px-2 py-0.5 font-mono text-[10px] text-violet-700 ring-1 ring-violet-200" title={condition}>
          if {condition}
        </span>
      )}
      <span className="h-3 w-px bg-zinc-300" />
    </div>
  );
}

function StageCard({
  def,
  stage,
  index,
  count,
  set,
  move,
  remove,
}: {
  def: FormDefinition;
  stage: WorkflowStage;
  index: number;
  count: number;
  set(p: Partial<WorkflowStage>): void;
  move(d: -1 | 1): void;
  remove(): void;
}) {
  const { tenantId, project } = useProject();
  const members = useQuery({ queryKey: ['members', tenantId, project.key], queryFn: () => api.projectMembers(tenantId, project.key) });
  const a = stage.approvers;
  const setA = (patch: Partial<typeof a>) => set({ approvers: { ...a, ...patch } });
  const keys = useMemo(() => new Set(def.sections.flatMap((s) => s.questions.map((q) => q.key))), [def]);
  let conditionProblem: string | null = null;
  if (stage.condition)
    try {
      const bad = references(stage.condition).filter((r) => !keys.has(r));
      if (bad.length) conditionProblem = `Unknown question \${${bad[0]}}`;
    } catch (e) {
      conditionProblem = (e as Error).message;
    }
  const nobody = !a.role && !a.group && !a.users.length;
  const name = (id: string) => members.data?.find((m) => m.userId === id)?.name ?? members.data?.find((m) => m.userId === id)?.email ?? 'Unknown';
  return (
    <div className="rounded-2xl border border-zinc-200 bg-snow shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <span className="num flex size-6 items-center justify-center bg-accent-600 text-xs font-semibold text-on-accent">{index + 1}</span>
        <input aria-label="Stage name" value={stage.name} onChange={(e) => set({ name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
        <button type="button" aria-label="Move stage up" disabled={index === 0} onClick={() => move(-1)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30">
          <ArrowUp className="size-3.5" />
        </button>
        <button type="button" aria-label="Move stage down" disabled={index === count - 1} onClick={() => move(1)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30">
          <ArrowDown className="size-3.5" />
        </button>
        <button type="button" aria-label="Delete stage" onClick={remove} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="space-y-4 p-4">
        <Field label="Instructions for reviewers">
          <Input value={stage.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Check the case counts against the register" />
        </Field>
        <div>
          <div className="mb-2 text-sm font-medium">Who approves</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role">
              <Select value={a.role ?? ''} onChange={(e) => setA({ role: (e.target.value || null) as ProjectRole | null })}>
                <option value="">Any role</option>
                {(['viewer', 'editor', 'manager'] as const).map((r) => (
                  <option key={r} value={r}>
                    {PROJECT_ROLE_INFO[r].label}
                    {r !== 'manager' ? ' or above' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <GroupPicker label="In permission group" none="Any group" value={a.group} onChange={(v) => setA({ group: v })} />
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-xs text-zinc-500">…or these people</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {a.users.map((u) => (
                <span key={u} className="inline-flex items-center gap-1 bg-accent-50 py-0.5 ps-2.5 pe-1 text-xs text-accent-800 ring-1 ring-accent-100">
                  {name(u)}
                  <button type="button" aria-label={`Remove ${name(u)}`} onClick={() => setA({ users: a.users.filter((x) => x !== u) })} className="p-0.5 hover:bg-accent-100">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <label className="relative inline-flex items-center">
                <UserPlus className="pointer-events-none absolute start-2 size-3.5 text-zinc-400" />
                <select
                  aria-label="Add a person"
                  value=""
                  onChange={(e) => e.target.value && setA({ users: [...a.users, e.target.value] })}
                  className="h-7 border border-dashed border-zinc-300 bg-snow ps-7 pe-3 text-xs text-zinc-600 hover:border-zinc-500"
                >
                  <option value="">Add person…</option>
                  {members.data
                    ?.filter((m) => !a.users.includes(m.userId))
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name ?? m.email}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </div>
          {nobody && <p className="mt-2 text-xs text-red-700">Choose at least one way to pick approvers.</p>}
        </div>
        <div>
          <Field label="Only when" hint="Leave empty to always apply this stage, e.g. ${cases} > 10">
            <Input value={stage.condition} onChange={(e) => set({ condition: e.target.value })} className="font-mono text-xs" aria-invalid={!!conditionProblem || undefined} />
          </Field>
          {conditionProblem && <p className="mt-1 text-xs text-red-700">{conditionProblem}</p>}
        </div>
        <SwitchField label="Reviewers can send it back for changes" checked={stage.allowReturn} onChange={(v) => set({ allowReturn: v })} />
      </div>
    </div>
  );
}

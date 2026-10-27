import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { approvalsOf, lintDefinition } from '@grids/forms';
import {
  FormSettings as FormSettingsSchema,
  PROJECT_SUBJECT,
  type FormDefinition,
  type FormSettings,
} from '@grids/schema';
import { confirmDialog, Button, ErrorNotice, Loading, cx, useToast } from '@grids/ui';
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  FileText,
  Table2,
  History,
  Languages,
  Palette,
  Rocket,
  Save,
  Shapes,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contrastOn } from '../../theme';
import { api } from '../../api';
import { useProject } from './context';
import { DocumentsPanel } from './DocumentsPanel';
import { AccessPanel, DesignPanel, PreviewDialog, TranslationsPanel } from './FormBuilderPanels';
import { ChangesDialog, diffSettings } from './FormChanges';
import { SubmissionsPanel } from './FormSubmissionsPanel';
import { HistoryDialog } from './FormHistory';
import { BuildTab, type Sel } from './FormQuestions';
import { WorkflowPanel } from './WorkflowEditor';

export { TYPE_INFO } from './FormQuestions';

type Tab = 'build' | 'design' | 'translate' | 'access' | 'workflow' | 'documents' | 'submissions';
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'build', label: 'Questions', icon: Shapes },
  { id: 'design', label: 'Layout & design', icon: Palette },
  { id: 'translate', label: 'Translations', icon: Languages },
  { id: 'access', label: 'Access', icon: Users },
  { id: 'workflow', label: 'Workflow', icon: Workflow },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'submissions', label: 'Submissions', icon: Table2 },
];

export interface Draft {
  def: FormDefinition;
  settings: FormSettings;
  groupId: string | null;
  name: string;
  description: string;
}

/**
 * Builds a form in a full-screen pop-up over the project: questions on a canvas
 * with an inspector, its layout, translations, and who fills and approves it.
 */
export function FormBuilder() {
  const { tenantId, project, base } = useProject();
  const navigate = useNavigate();
  const { formKey } = useParams({ strict: false }) as { formKey: string };
  const qc = useQueryClient();
  const toast = useToast();
  const forms = useQuery({
    queryKey: ['forms', tenantId, project.key],
    queryFn: () => api.forms(tenantId, project.key),
  });
  const form = forms.data?.find((f) => f.key === formKey);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sel, setSel] = useState<Sel>({ kind: 'q', s: 0, q: 0 });
  const [tab, setTab] = useState<Tab>('build');
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (form && !draft) {
      const def = structuredClone(form.draft);
      // Every form about an entity opens with the question that says which one. Older forms get it added here.
      const subject = form.subjectType;
      if (
        subject &&
        subject.key !== PROJECT_SUBJECT &&
        !def.sections.some((s) => s.questions.some((q) => q.primary))
      ) {
        const taken = new Set(def.sections.flatMap((s) => s.questions.map((q) => q.key)));
        let key = 'main_entity';
        for (let n = 2; taken.has(key); n++) key = `main_entity_${n}`;
        def.sections[0]!.questions.unshift({
          key,
          type: 'entity',
          label: `Which ${subject.name.toLowerCase()}?`,
          entityType: subject.key,
          primary: true,
          required: true,
        });
      }
      setDraft({
        def,
        // Run through the schema, so settings saved before a setting existed get its starting value.
        settings: FormSettingsSchema.parse(structuredClone(form.settings)),
        groupId: form.groupId,
        name: form.name,
        description: form.description,
      });
    }
  }, [form, draft]);

  const problems = useMemo(() => (draft ? lintDefinition(draft.def) : []), [draft]);
  const saved = form
    ? JSON.stringify({
        def: form.draft,
        // Read through the schema like the draft is, so a setting the saved copy lacks is not a change.
        settings: FormSettingsSchema.parse(structuredClone(form.settings)),
        groupId: form.groupId,
        name: form.name,
        description: form.description,
      })
    : '';
  const [changes, setChanges] = useState(false);
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const defChanged =
    !!form && !!draft && JSON.stringify(draft.def) !== JSON.stringify(form.published);
  const save = useMutation({
    mutationFn: (_auto?: boolean) =>
      api.saveForm(
        tenantId,
        project.key,
        {
          key: form!.key,
          name: draft!.name,
          description: draft!.description,
          subjectType: form!.subjectType!.key,
          groupId: draft!.groupId,
          settings: draft!.settings,
          definition: draft!.def,
        },
        form!.key,
      ),
    onSuccess: (data, auto) => {
      qc.setQueryData(['forms', tenantId, project.key], data);
      void qc.invalidateQueries({ queryKey: ['forms-menu', tenantId] });
      setSavedAt(new Date());
      if (!auto) toast('Saved');
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync(true);
      return api.publishForm(tenantId, project.key, form!.key);
    },
    onSuccess: (data) => {
      qc.setQueryData(['forms', tenantId, project.key], data);
      void qc.invalidateQueries({ queryKey: ['forms-menu', tenantId] });
      toast(`Published version ${data.find((f) => f.key === form!.key)?.currentVersion}`);
    },
  });

  // Changes are kept as a draft a moment after the last edit; publishing is still a deliberate step.
  useEffect(() => {
    if (!dirty || save.isPending || publish.isPending || save.isError) return;
    const t = setTimeout(() => save.mutate(true), 2500);
    return () => clearTimeout(t);
  }, [draft, dirty, save.isPending, publish.isPending, save.isError]);

  const close = async () => {
    if (
      dirty &&
      !(await confirmDialog('Close without saving your changes?', {
        confirmLabel: 'Close without saving',
        danger: true,
      }))
    )
      return;
    void navigate({ to: `${base}/forms` });
  };
  // A pop-up: Escape closes it (unless a dialog inside is open), and the page behind doesn't scroll.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && !document.querySelector('dialog[open]') && closeRef.current();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  const shell = (children: React.ReactNode) =>
    createPortal(
      // Rendered on <body>, so it carries the project's colour itself instead of inheriting it.
      <div
        className="brand-scope fixed inset-0 z-[45] bg-black/55 p-2 sm:p-4 lg:p-6"
        style={
          {
            '--brand-600': project.color,
            '--brand-contrast': contrastOn(project.color),
          } as React.CSSProperties
        }
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={form ? `Edit ${form.name}` : 'Edit form'}
          className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden border border-zinc-300 bg-canvas text-ink shadow-raised"
        >
          {children}
        </div>
      </div>,
      document.body,
    );
  if (forms.isPending || (form && !draft)) return shell(<Loading />);
  if (!form || !draft)
    return shell(
      <div className="p-6">
        <ErrorNotice error={new Error('Form not found')} />
      </div>,
    );
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setDef = (def: FormDefinition) => set({ def });
  const stages = approvalsOf(draft.settings).length;
  const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return shell(
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-200 bg-snow px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={close}
          aria-label="Back to forms"
          title="Back to forms (Esc)"
          className="p-2 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1
          className="min-w-0 max-w-md truncate px-1 text-lg font-semibold tracking-tight"
          title={draft.name}
        >
          {draft.name}
        </h1>
        {!form.currentVersion ? (
          <span className="inline-flex h-[22px] items-center bg-zinc-100 px-2 text-xs font-medium text-zinc-700">
            Draft
          </span>
        ) : defChanged || dirty ? (
          <button
            type="button"
            onClick={() => setChanges(true)}
            title="See what changed since it was published"
            className="inline-flex h-[22px] items-center bg-amber-100 px-2 text-xs font-medium text-amber-900 underline decoration-dotted underline-offset-2 hover:bg-amber-200"
          >
            Unpublished changes
          </button>
        ) : (
          <span className="inline-flex h-[22px] items-center bg-emerald-100 px-2 text-xs font-medium text-emerald-900">
            Published · v{form.currentVersion}
          </span>
        )}
        <span className="hidden text-xs text-zinc-500 md:inline">
          {form.subjectType && (
            <>
              {form.subjectType.key === PROJECT_SUBJECT
                ? 'About the project'
                : `About a ${form.subjectType.name.toLowerCase()}`}{' '}
              ·{' '}
            </>
          )}
          {save.isPending
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes'
              : savedAt
                ? `Saved ${hhmm(savedAt)}`
                : 'Up to date'}
        </span>
        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="secondary"
            icon={Eye}
            onClick={() => setPreview(true)}
            disabled={problems.length > 0}
          >
            Preview
          </Button>
          {form.currentVersion && (
            <Button variant="secondary" icon={History} onClick={() => setHistory(true)}>
              History
            </Button>
          )}
          <Button
            variant="secondary"
            icon={Save}
            onClick={() => save.mutate(false)}
            loading={save.isPending}
            disabled={!dirty}
          >
            Save
          </Button>
          <Button
            icon={Rocket}
            onClick={() => publish.mutate()}
            loading={publish.isPending}
            disabled={problems.length > 0 || (!dirty && !defChanged)}
          >
            Publish changes
          </Button>
        </div>
      </header>
      <div
        role="tablist"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 bg-snow px-4 sm:px-5"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              '-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm',
              tab === t.id
                ? 'border-accent-600 font-semibold text-accent-800'
                : 'border-transparent text-zinc-600 hover:text-ink',
            )}
          >
            <t.icon className="size-4" /> {t.label}
            {t.id === 'workflow' && draft.settings.workflow.enabled && (
              <span className="bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-900">
                {stages ? `${stages} stage${stages === 1 ? '' : 's'}` : 'On'}
              </span>
            )}
          </button>
        ))}
      </div>
      {(save.error || publish.error || problems.length > 0) && (
        <div className="shrink-0 space-y-2 border-b border-zinc-200 bg-snow px-4 py-3 sm:px-5">
          <ErrorNotice error={save.error ?? publish.error} />
          {problems.length > 0 && (
            <div
              className="bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200"
              role="status"
            >
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
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {tab === 'build' ? (
          <BuildTab
            formKey={form.key}
            def={draft.def}
            setDef={setDef}
            sel={sel}
            setSel={setSel}
            subjectTypeKey={form.subjectType?.key ?? null}
            stages={
              draft.settings.workflow.enabled
                ? approvalsOf(draft.settings).map((n) => ({ id: n.id, name: n.name || n.id }))
                : []
            }
          />
        ) : tab === 'workflow' ? (
          // Filled by position rather than a percentage height, which this layout does not resolve.
          <div className="absolute inset-0">
            <WorkflowPanel draft={draft} set={set} formKey={form.key} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <div
              className={cx('mx-auto max-w-[1440px] p-4 sm:p-6', tab === 'translate' && 'h-full')}
            >
              {tab === 'design' && <DesignPanel draft={draft} set={set} formKey={form.key} />}
              {tab === 'translate' && <TranslationsPanel draft={draft} set={set} />}
              {tab === 'documents' && <DocumentsPanel draft={draft} set={set} formKey={form.key} />}
              {tab === 'submissions' && <SubmissionsPanel draft={draft} set={set} />}
              {tab === 'access' && (
                <AccessPanel
                  draft={draft}
                  set={set}
                  onTab={setTab}
                  formKey={form.key}
                  subjectType={form.subjectType}
                />
              )}
            </div>
          </div>
        )}
      </div>
      {preview && <PreviewDialog def={draft.def} onClose={() => setPreview(false)} />}
      {changes && (
        <ChangesDialog
          now={draft.def}
          published={form.published}
          version={form.currentVersion}
          settings={[
            ...diffSettings(
              draft.settings,
              FormSettingsSchema.parse(structuredClone(form.settings)),
            ),
            ...(draft.name !== form.name
              ? [
                  {
                    kind: 'changed' as const,
                    where: 'Details',
                    what: `Name: “${form.name}” → “${draft.name}”`,
                  },
                ]
              : []),
            ...(draft.description !== form.description
              ? [{ kind: 'changed' as const, where: 'Details', what: 'Description changed' }]
              : []),
          ]}
          onDiscard={() => {
            if (!form.published) return;
            setDraft({ ...draft, def: structuredClone(form.published) });
            setSel({ kind: 'q', s: 0, q: 0 });
            toast(`Draft is back to version ${form.currentVersion}`);
          }}
          onClose={() => setChanges(false)}
        />
      )}
      {history && (
        <HistoryDialog
          formKey={form.key}
          current={form.currentVersion}
          onClose={() => setHistory(false)}
          onRestore={(def, v) => {
            setDraft({ ...draft, def: structuredClone(def) });
            setSel({ kind: 'q', s: 0, q: 0 });
            toast(`Draft is now version ${v}. Publish to make it live`);
          }}
        />
      )}
    </>,
  );
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { validate } from '@grids/forms';
import { uuidv7, type FormDto } from '@grids/schema';
import { ApiError, Button, Dialog, Empty, ErrorNotice, Field, Input, Loading, Pagination, Panel, Select, Table, Tag, Td, dateTime, relTime, usePagination, useToast } from '@grids/ui';
import { ClipboardList, CloudOff, Pencil, Plus, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useProject } from './context';
import { FormRenderer, type Answers } from './FormRenderer';
import { useTypes } from './EntitiesTab';

// ---------------------------------------------------------------- offline outbox

interface Pending {
  tenantId: string;
  project: string;
  form: string;
  formName: string;
  input: Parameters<typeof api.submit>[3];
}
const OUTBOX = 'grids.outbox';
const readOutbox = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as Pending[];
  } catch {
    return [];
  }
};
const writeOutbox = (items: Pending[]) => {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(items));
  } catch {
    /* storage full or unavailable */
  }
};

/**
 * Submissions that couldn't reach the server (offline) wait here and are sent when
 * the connection returns. Ids are client-generated, so a retry never duplicates.
 */
export function useOutbox() {
  const [items, setItems] = useState<Pending[]>(readOutbox);
  const flush = useCallback(async () => {
    const remaining: Pending[] = [];
    for (const p of readOutbox()) {
      try {
        await api.submit(p.tenantId, p.project, p.form, p.input);
      } catch (e) {
        // Keep it only if it is still a connectivity problem; server rejections are dropped.
        if (!(e instanceof ApiError)) remaining.push(p);
      }
    }
    writeOutbox(remaining);
    setItems(remaining);
  }, []);
  useEffect(() => {
    if (navigator.onLine) void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);
  const add = (p: Pending) => {
    const next = [...readOutbox(), p];
    writeOutbox(next);
    setItems(next);
  };
  return { items, add, flush };
}

// ---------------------------------------------------------------- list

export function FormsTab() {
  const { tenantId, project, base, can } = useProject();
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const outbox = useOutbox();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<FormDto | null>(null);
  const mine = outbox.items.filter((p) => p.tenantId === tenantId && p.project === project.key);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">Forms collect data in the field. Published versions are immutable; answers can update entities and indicators.</p>
        {can('manager') && (
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New form
          </Button>
        )}
      </div>
      {mine.length > 0 && (
        <div className="flex items-center gap-3 border-s-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm">
          <CloudOff className="size-4 text-amber-700" />
          <span className="flex-1">{mine.length} submission(s) saved on this device, waiting for a connection.</span>
          <Button size="sm" variant="secondary" onClick={() => void outbox.flush()}>
            Send now
          </Button>
        </div>
      )}
      <ErrorNotice error={forms.error} />
      {forms.isPending ? (
        <Loading />
      ) : !forms.data?.length ? (
        <div className="border border-zinc-200 bg-snow">
          <Empty icon={ClipboardList} title="No forms yet" />
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {forms.data.map((f) => (
            <li key={f.key} className="flex flex-col border border-zinc-200 bg-snow p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{f.name}</h3>
                  <p className="mt-0.5 text-sm text-zinc-500">{f.description || (f.subjectType ? `About a ${f.subjectType.name.toLowerCase()}` : 'Standalone form')}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {f.currentVersion ? <Tag>v{f.currentVersion}</Tag> : <Tag>Draft</Tag>}
                  {f.currentVersion && f.hasUnpublishedChanges && <span className="text-xs text-amber-700">Unpublished changes</span>}
                </div>
              </div>
              <dl className="mt-4 flex gap-6 text-sm">
                <div>
                  <dt className="text-xs text-zinc-500">Submissions</dt>
                  <dd className="num font-medium">{f.submissionCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Last</dt>
                  <dd>{f.lastSubmissionAt ? relTime(f.lastSubmissionAt) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Questions</dt>
                  <dd className="num">{f.draft.sections.reduce((n, s) => n + s.questions.length, 0)}</dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
                {can('editor') && f.currentVersion && (
                  <Link to={`${base}/forms/${f.key}/fill`} className="inline-flex h-7 items-center gap-1.5 bg-accent-600 px-2.5 text-xs font-medium text-white hover:bg-accent-700">
                    <Send className="size-3.5" /> Fill in
                  </Link>
                )}
                <Button size="sm" variant="secondary" onClick={() => setViewing(f)}>
                  Submissions
                </Button>
                {can('manager') && (
                  <Link to={`${base}/forms/${f.key}/edit`} className="inline-flex h-7 items-center gap-1.5 border border-zinc-300 bg-snow px-2.5 text-xs font-medium hover:border-zinc-900">
                    <Pencil className="size-3.5" /> Build
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewForm onClose={() => setCreating(false)} />}
      {viewing && <Submissions form={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function NewForm({ onClose }: { onClose(): void }) {
  const { tenantId, project, base } = useProject();
  const types = useTypes();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1') || 'form';
  const create = useMutation({
    mutationFn: () =>
      api.saveForm(tenantId, project.key, {
        key,
        name,
        subjectType: subject || null,
        definition: { title: name, sections: [{ key: 'main', title: '', questions: [{ key: 'first_question', type: 'text', label: 'First question' }] }] },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['forms', tenantId, project.key], data);
      void navigate({ to: `${base}/forms/${key}/edit` });
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New form"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!name}>
            Create and build
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={create.error} />
        <Field label="Name" hint={`Key: ${key}`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="About" hint="Submissions about an entity can update its attributes and indicators">
          <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Nothing in particular</option>
            {types.data?.map((t) => (
              <option key={t.key} value={t.key}>
                A {t.name.toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function Submissions({ form, onClose }: { form: FormDto; onClose(): void }) {
  const { tenantId, project } = useProject();
  const [pg, setPg] = usePagination([], 25);
  const subs = useQuery({
    queryKey: ['submissions', tenantId, project.key, form.key, pg],
    queryFn: () => api.submissions(tenantId, project.key, form.key, pg),
    placeholderData: keepPreviousData,
  });
  const def = form.published ?? form.draft;
  const cols = def.sections.flatMap((s) => s.questions).filter((q) => q.type !== 'note').slice(0, 6);
  return (
    <Dialog open wide onClose={onClose} title={`${form.name}: submissions`}>
      <ErrorNotice error={subs.error} />
      <div className="max-h-[60vh] overflow-auto">
        <Table head={['Submitted', ...(form.subjectType ? [form.subjectType.name] : []), 'By', ...cols.map((q) => q.label)]} empty={<Empty icon={ClipboardList} title="No submissions yet" />}>
          {subs.data?.items.map((s) => (
            <tr key={s.id} className="border-t border-zinc-100">
              <Td className="text-xs whitespace-nowrap">{dateTime(s.submittedAt)}</Td>
              {form.subjectType && <Td>{s.entity?.name ?? '—'}</Td>}
              <Td className="text-xs">{s.submittedBy ?? '—'}</Td>
              {cols.map((q) => (
                <Td key={q.key} className="max-w-48 truncate">
                  {fmtAnswer(s.answers[q.key])}
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      </div>
      {subs.data && <Pagination {...pg} total={subs.data.total} onChange={setPg} />}
    </Dialog>
  );
}

const fmtAnswer = (v: unknown) =>
  v === undefined || v === null ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);

// ---------------------------------------------------------------- fill in

export function FormFillPage() {
  const { tenantId, project, base } = useProject();
  const { formKey } = useParams({ strict: false }) as { formKey: string };
  const search = useSearch({ strict: false }) as { entity?: string };
  const navigate = useNavigate();
  const toast = useToast();
  const outbox = useOutbox();
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const form = forms.data?.find((f) => f.key === formKey);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [entity, setEntity] = useState<string>(search.entity ?? '');
  const subjects = useQuery({
    queryKey: ['entities', tenantId, project.key, 'subjects', form?.subjectType?.key],
    queryFn: () => api.entities(tenantId, project.key, { type: form!.subjectType!.key, pageSize: 200 }),
    enabled: !!form?.subjectType,
  });
  const submit = useMutation({
    mutationFn: async () => {
      const def = form!.published!;
      const local = validate(def, answers);
      if (!local.ok) {
        setErrors(local.errors);
        throw new Error('Some answers need attention');
      }
      const input = { id: uuidv7(), version: form!.currentVersion!, entityId: entity || null, answers, collectedAt: new Date().toISOString() };
      try {
        return { saved: await api.submit(tenantId, project.key, form!.key, input), offline: false };
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.problem.errors) setErrors(Object.fromEntries(e.problem.errors.map((x) => [x.path, x.message])));
          throw e;
        }
        outbox.add({ tenantId, project: project.key, form: form!.key, formName: form!.name, input });
        return { saved: null, offline: true };
      }
    },
    onSuccess: ({ offline }) => {
      toast(offline ? 'Saved on this device; it will be sent when you are back online' : 'Submitted');
      setAnswers({});
      setErrors({});
      void navigate({ to: `${base}/forms` });
    },
  });
  if (forms.isPending) return <Loading />;
  if (!form?.published) return <ErrorNotice error={new Error('This form is not published yet.')} />;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to={`${base}/forms`} className="text-sm text-accent-700 hover:underline">
          ← Forms
        </Link>
        <h2 className="mt-2 text-xl font-semibold">{form.published.title}</h2>
        {form.published.description && <p className="mt-1 text-sm text-zinc-600">{form.published.description}</p>}
        <p className="mt-1 text-xs text-zinc-500">Version {form.currentVersion}</p>
      </div>
      {form.subjectType && (
        <Panel title={`Which ${form.subjectType.name.toLowerCase()}?`}>
          <Select aria-label={form.subjectType.name} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Choose…</option>
            {subjects.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.parent ? ` (${e.parent.name})` : ''}
              </option>
            ))}
          </Select>
        </Panel>
      )}
      <FormRenderer definition={form.published} answers={answers} onChange={setAnswers} errors={errors} />
      <ErrorNotice error={submit.error} />
      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-zinc-200 bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0">
        <Button variant="secondary" onClick={() => setAnswers({})}>
          Clear
        </Button>
        <Button icon={Send} onClick={() => submit.mutate()} loading={submit.isPending} disabled={!!form.subjectType && !entity}>
          Submit
        </Button>
      </div>
    </div>
  );
}

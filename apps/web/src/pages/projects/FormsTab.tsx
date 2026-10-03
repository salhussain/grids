import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { FORM_LAYOUT_INFO, SUBMISSION_STATUSES, type FormDto, type SubmissionStatus } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Loading, Pagination, Select, Table, Tag, Td, dateTime, relTime, usePagination } from '@grids/ui';
import { ClipboardList, CloudOff, GitBranch, Lock, Pencil, Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { FillForm } from '../forms/FillForm';
import { useOutbox } from '../forms/outbox';
import { SubmissionSheet } from '../forms/SubmissionSheet';
import { STATUS_INFO, SubmissionStatusPill, fmtAnswer } from '../forms/status';
import { useProject } from './context';
import { useTypes } from './EntitiesTab';

export { useOutbox };

// ---------------------------------------------------------------- list

export function FormsTab() {
  const { tenantId, project, base, can } = useProject();
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const outbox = useOutbox();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<FormDto | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
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
                  <span className="flex gap-1">
                    {f.settings.workflow.enabled && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800 ring-1 ring-sky-200" title={f.settings.workflow.stages.map((x) => x.name).join(' → ')}>
                        <GitBranch className="size-3" /> {f.settings.workflow.stages.length}-stage approval
                      </span>
                    )}
                    {f.currentVersion ? <Tag>v{f.currentVersion}</Tag> : <Tag>Draft</Tag>}
                  </span>
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
                <div>
                  <dt className="text-xs text-zinc-500">Layout</dt>
                  <dd>{FORM_LAYOUT_INFO[f.draft.layout].label}</dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
                {f.canFill && f.currentVersion ? (
                  <Link to={`${base}/forms/${f.key}/fill`} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-600 px-2.5 text-xs font-medium text-white hover:bg-accent-700">
                    <Send className="size-3.5" /> Fill in
                  </Link>
                ) : (
                  !f.canFill && (
                    <span className="inline-flex h-7 items-center gap-1.5 px-1 text-xs text-zinc-500">
                      <Lock className="size-3.5" /> Not for your role
                    </span>
                  )
                )}
                <Button size="sm" variant="secondary" onClick={() => setViewing(f)}>
                  Submissions
                </Button>
                {can('manager') && (
                  <Link to={`${base}/forms/${f.key}/edit`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-300 bg-snow px-2.5 text-xs font-medium hover:border-zinc-900">
                    <Pencil className="size-3.5" /> Build
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewForm onClose={() => setCreating(false)} />}
      {viewing && !sheet && <Submissions form={viewing} onClose={() => setViewing(null)} onOpen={setSheet} />}
      {sheet && <SubmissionSheet tenantId={tenantId} project={project.key} id={sheet} onClose={() => setSheet(null)} />}
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

function Submissions({ form, onClose, onOpen }: { form: FormDto; onClose(): void; onOpen(id: string): void }) {
  const { tenantId, project } = useProject();
  const [status, setStatus] = useState<SubmissionStatus | ''>('');
  const [pg, setPg] = usePagination([status], 25);
  const subs = useQuery({
    queryKey: ['submissions', tenantId, project.key, form.key, pg, status],
    queryFn: () => api.submissions(tenantId, project.key, form.key, { ...pg, status: status || undefined }),
    placeholderData: keepPreviousData,
  });
  const def = form.published ?? form.draft;
  const cols = def.sections.flatMap((s) => s.questions).filter((q) => q.type !== 'note').slice(0, 5);
  const wf = form.settings.workflow.enabled;
  return (
    <Dialog open wide onClose={onClose} title={`${form.name}: submissions`}>
      <ErrorNotice error={subs.error} />
      {wf && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {(['', ...SUBMISSION_STATUSES.filter((x) => x !== 'complete')] as const).map((x) => (
            <button
              key={x || 'all'}
              type="button"
              aria-pressed={status === x}
              onClick={() => setStatus(x)}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 ${status === x ? 'bg-ink text-canvas ring-ink' : 'bg-snow text-zinc-600 ring-zinc-200 hover:ring-zinc-400'}`}
            >
              {x ? STATUS_INFO[x].label : 'All'}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[60vh] overflow-auto">
        <Table
          head={['Submitted', ...(wf ? ['Status'] : []), ...(form.subjectType ? [form.subjectType.name] : []), 'By', ...cols.map((q) => q.label)]}
          empty={<Empty icon={ClipboardList} title="No submissions yet" />}
        >
          {subs.data?.items.map((s) => (
            <tr key={s.id} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50" onClick={() => onOpen(s.id)}>
              <Td className="text-xs whitespace-nowrap">{dateTime(s.submittedAt)}</Td>
              {wf && (
                <Td>
                  <SubmissionStatusPill s={s} />
                  {s.stageName && s.status === 'in_review' && <div className="mt-0.5 text-[11px] text-zinc-500">{s.stageName}</div>}
                </Td>
              )}
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

// ---------------------------------------------------------------- fill in

export function FormFillPage() {
  const { tenantId, project, base } = useProject();
  const { formKey } = useParams({ strict: false }) as { formKey: string };
  const search = useSearch({ strict: false }) as { entity?: string };
  return (
    <FillForm
      tenantId={tenantId}
      project={project.key}
      projectName={project.name}
      formKey={formKey}
      entityId={search.entity}
      back={{ to: `${base}/forms`, label: 'Forms' }}
      inboxHref={`/o/${tenantId}/inbox`}
    />
  );
}

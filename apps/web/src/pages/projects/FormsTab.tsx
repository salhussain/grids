import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { approvalsOf } from '@grids/forms';
import { PROJECT_SUBJECT, SUBMISSION_STATUSES, type FormDto, type SubmissionStatus } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Listbox, Loading, Pagination, SectionHead, Table, Td, dateTime, relTime, usePagination, EmptyState, cx } from '@grids/ui';
import { CircleDot, ClipboardList, CloudOff, FolderKanban, GitBranch, Globe, Languages, Layers, Lock, MapPin, Pencil, Plus, Search, Send } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { FillForm } from '../forms/FillForm';
import { useOutbox } from '../forms/outbox';
import { SubmissionSheet } from '../forms/SubmissionSheet';
import { STATUS_INFO, SubmissionStatusPill } from '../forms/status';
import { FilterMenu, type FilterCategory, type FilterValue } from '../support/FilterMenu';
import { iconOf, useProject } from './context';
import { GroupTree } from './GroupTree';
import { useTypes } from './EntitiesTab';

export { useOutbox };

// ---------------------------------------------------------------- list

export function FormsTab() {
  const { tenantId, project, base, can } = useProject();
  const forms = useQuery({
    queryKey: ['forms', tenantId, project.key],
    queryFn: () => api.forms(tenantId, project.key),
  });
  const groups = useQuery({
    queryKey: ['form-groups', tenantId, project.key],
    queryFn: () => api.projectFormGroups(tenantId, project.key),
  });
  const outbox = useOutbox();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<FormDto | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const [sort, setSort] = useState<'edited' | 'name' | 'submissions'>('edited');
  const mine = outbox.items.filter((p) => p.tenantId === tenantId && p.project === project.key);
  const all = forms.data ?? [];
  const groupList = groups.data ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((f) => {
      const pick = (id: string) => filters[id] ?? [];
      const any = (id: string, value: string) => !pick(id).length || pick(id).includes(value);
      return (
        any('status', f.currentVersion ? 'published' : 'draft') &&
        any('group', f.groupId ?? 'none') &&
        any('about', f.subjectType?.key ?? 'none') &&
        any('approval', f.settings.workflow.enabled && approvalsOf(f.settings).length ? 'yes' : 'no')
      );
    })
    .filter((f) => !needle || `${f.name} ${f.description}`.toLowerCase().includes(needle))
    .sort((x, y) => (sort === 'name' ? x.name.localeCompare(y.name) : sort === 'submissions' ? y.submissionCount - x.submissionCount : y.updatedAt.localeCompare(x.updatedAt)));
  const submissions = all.reduce((n, f) => n + f.submissionCount, 0);
  const subjects = [...new Map(all.filter((f) => f.subjectType).map((f) => [f.subjectType!.key, f.subjectType!.name])).entries()];
  const categories: FilterCategory[] = [
    { id: 'status', label: 'Status', icon: CircleDot, options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }] },
    ...(groupList.length ? [{ id: 'group', label: 'Group', icon: Layers, options: [...groupList.map((g) => ({ value: g.id, label: g.name })), { value: 'none', label: 'No group' }] }] : []),
    ...(subjects.length ? [{ id: 'about', label: 'About', icon: MapPin, options: subjects.map(([value, label]) => ({ value, label })) }] : []),
    { id: 'approval', label: 'Approval', icon: GitBranch, options: [{ value: 'yes', label: 'Has approval' }, { value: 'no', label: 'No approval' }] },
  ];
  return (
    <div className="space-y-5">
      <SectionHead
        title="Forms"
        description="Forms collect data in the field. Published versions are fixed, and answers can update places and indicators."
        actions={
          can('manager') ? (
            <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
              New form
            </Button>
          ) : undefined
        }
      />
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
      ) : !all.length ? (
        <EmptyState icon={ClipboardList} title="No forms yet">
          Forms collect data in the field. Build one with questions and logic, publish it, and the answers can update places and indicators.
        </EmptyState>
      ) : (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-72 max-w-full">
                <Input icon={Search} aria-label="Search forms" placeholder="Search forms" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <FilterMenu categories={categories} value={filters} onChange={setFilters} />
              <Listbox
                compact
                label="Sort"
                className="w-52"
                value={sort}
                options={[
                  { value: 'edited', label: 'Recently edited' },
                  { value: 'name', label: 'Name' },
                  { value: 'submissions', label: 'Most submissions' },
                ]}
                onChange={(v) => setSort(v as typeof sort)}
              />
              <span className="ms-auto text-[13px] text-zinc-500">
                {all.length} form{all.length === 1 ? '' : 's'} · {submissions.toLocaleString()} submissions
              </span>
            </div>
            {!shown.length ? (
              <div className="border border-zinc-200 bg-snow">
                <Empty icon={ClipboardList} title="No matching forms">
                  Try different filters or search.
                </Empty>
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((f) => (
                  <FormCard key={f.key} f={f} base={base} canEdit={can('manager')} groupName={groupList.find((g) => g.id === f.groupId)?.name} onSubmissions={() => setViewing(f)} />
                ))}
              </ul>
            )}
        </div>
      )}
      {creating && <NewForm onClose={() => setCreating(false)} />}
      {viewing && !sheet && <Submissions form={viewing} onClose={() => setViewing(null)} onOpen={setSheet} />}
      {sheet && <SubmissionSheet tenantId={tenantId} project={project.key} id={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

function FormCard({ f, base, canEdit, groupName, onSubmissions }: { f: FormDto; base: string; canEdit: boolean; groupName?: string; onSubmissions(): void }) {
  const questions = f.draft.sections.reduce((n, s) => n + s.questions.length, 0);
  const stages = f.settings.workflow.enabled ? approvalsOf(f.settings).length : 0;
  const langs = Object.keys(f.draft.translations).filter((k) => Object.keys(f.draft.translations[k] ?? {}).length);
  const layout = f.draft.layout === 'steps' ? `${f.draft.sections.length} pages` : f.draft.layout === 'focus' ? 'one at a time' : 'one page';
  const Icon = iconOf(f.draft.icon ?? 'clipboard');
  const chip = 'inline-flex h-[22px] items-center bg-zinc-100 px-2 text-xs text-zinc-600';
  // The colour dot and the small line under the name say where the form stands.
  const closed = { not_yet: 'not open yet', closed: 'closed', full: 'full' }[f.availability.state as 'not_yet' | 'closed' | 'full'];
  const status = !f.currentVersion
    ? { label: 'Draft', dot: 'bg-amber-500', text: 'text-amber-700' }
    : closed
      ? { label: `Published · ${closed}`, dot: f.availability.state === 'not_yet' ? 'bg-zinc-400' : 'bg-red-500', text: f.availability.state === 'not_yet' ? 'text-zinc-600' : 'text-red-700' }
      : f.hasUnpublishedChanges
        ? { label: 'Published · unpublished changes', dot: 'bg-orange-500', text: 'text-orange-700' }
        : { label: 'Published', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  return (
    <li className="flex h-full flex-col gap-3 border border-zinc-200 bg-snow p-4.5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold" title={f.name}>{f.name}</div>
          <div className={cx('truncate text-xs font-medium', status.text)}>{status.label}</div>
        </div>
        <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', status.dot)} title={status.label} role="img" aria-label={status.label} />
      </div>
      <div className="flex h-[22px] items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <span className={chip}>{questions} questions</span>
        <span className={chip}>{layout}</span>
        {f.settings.publicAccess.enabled && <span className={cx(chip, 'gap-1 bg-sky-50 text-sky-800')}><Globe className="size-3" /> Public link</span>}
        {groupName && <span className={cx(chip, 'min-w-0 truncate')}>{groupName}</span>}
      </div>
      <p className={`line-clamp-2 min-h-10 text-[13px] ${f.description ? 'text-zinc-600' : 'text-zinc-400'}`}>{f.description || 'No description available yet.'}</p>
      <dl className="space-y-1.5 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        <div className="flex items-center gap-2" title="The entity each submission is about">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">
            {f.subjectType ? (f.subjectType.key === PROJECT_SUBJECT ? 'About the project' : `About a ${f.subjectType.name.toLowerCase()}`) : 'Not about an entity'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Send className="size-3.5 shrink-0" />
          <button type="button" onClick={onSubmissions} className="font-medium text-accent-700 hover:underline" title="View submissions">
            {f.submissionCount.toLocaleString()} submissions
          </button>
          {f.lastSubmissionAt && <span>· last {relTime(f.lastSubmissionAt)}</span>}
        </div>
        <div className="flex items-center gap-2" title={stages > 0 ? approvalsOf(f.settings).map((x) => x.name || x.id).join(' → ') : undefined}>
          <GitBranch className="size-3.5 shrink-0" /> {stages > 0 ? `${stages}-stage approval` : 'No approval'}
        </div>
        <div className="flex items-center gap-2">
          <Languages className="size-3.5 shrink-0" /> {['EN', ...langs.map((l) => l.toUpperCase())].join(' · ')}
        </div>
        <div className="flex items-center gap-2">
          <Pencil className="size-3.5 shrink-0" /> edited {relTime(f.updatedAt)}
        </div>
      </dl>
      <div className="mt-auto grid grid-flow-col auto-cols-fr gap-2">
        {f.canFill && f.currentVersion ? (
          <Link to={`${base}/forms/${f.key}/fill`} className="inline-flex h-8 items-center justify-center gap-1.5 bg-accent-600 px-3 text-[13px] font-medium text-on-accent hover:bg-accent-700">
            <Send className="size-3.5" /> Fill in
          </Link>
        ) : (
          !f.canFill && (
            <span className="inline-flex h-8 items-center justify-center gap-1.5 px-1 text-xs text-zinc-500" title="Not for your role">
              <Lock className="size-3.5" /> Not for you
            </span>
          )
        )}
        {canEdit && (
          <Link to={`${base}/forms/${f.key}/edit`} className="inline-flex h-8 items-center justify-center gap-1.5 border border-zinc-300 bg-snow px-3 text-[13px] font-medium hover:border-zinc-900">
            <Pencil className="size-3.5" /> {f.currentVersion ? 'Edit' : 'Continue editing'}
          </Link>
        )}
      </div>
    </li>
  );
}

/** How the project's forms are grouped in the side menu: project › group › form. */
export function FormGroupsTab() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const groups = useQuery({
    queryKey: ['form-groups', tenantId, project.key],
    queryFn: () => api.projectFormGroups(tenantId, project.key),
  });
  const setGroups = (d: unknown) => {
    qc.setQueryData(['form-groups', tenantId, project.key], d);
    void qc.invalidateQueries({ queryKey: ['forms-menu', tenantId] });
  };
  return (
    <GroupTree
      title="Form groups"
      description="Levels in the side menu’s forms list, e.g. Surveillance › Weekly reports."
      emptyText="Groups organise this project’s forms into levels in the side menu, and a group can sit inside another group. Add one, then choose it for a form when you edit the form."
      noun="form"
      canEdit={can('manager')}
      error={groups.error}
      groups={(groups.data ?? []).map((g) => ({
        id: g.id,
        parentId: g.parentId,
        name: g.name,
        count: g.formCount,
      }))}
      onSave={async (input, id) =>
        setGroups(
          await api.saveProjectFormGroup(
            tenantId,
            project.key,
            { ...input, icon: 'folder', sort: 0 },
            id,
          ),
        )
      }
      onDelete={async (id) =>
        setGroups(await api.deleteProjectFormGroup(tenantId, project.key, id))
      }
    />
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
        subjectType: subject,
        definition: {
          title: name,
          sections: [
            {
              key: 'main',
              title: '',
              questions: [
                // A form about an entity opens with the question that says which one.
                ...(subject !== PROJECT_SUBJECT ? [{ key: 'main_entity', type: 'entity' as const, label: `Which ${(types.data?.find((t) => t.key === subject)?.name ?? 'entity').toLowerCase()}?`, entityType: subject, primary: true, required: true }] : []),
                { key: 'first_question', type: 'text', label: 'First question' },
              ],
            },
          ],
        },
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
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!name || !subject}>
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
        <Field label="Captured against" hint="Every submission is about the project itself or one entity of a type, and can update its attributes and indicators">
          <Listbox
            searchable={(types.data?.length ?? 0) > 5}
            label="Captured against"
            placeholder="Choose what it is about…"
            value={subject || null}
            onChange={setSubject}
            options={[
              { value: PROJECT_SUBJECT, label: 'The project itself', description: 'One submission is about the project as a whole', icon: FolderKanban, text: 'project' },
              ...(types.data ?? []).map((t) => ({ value: t.key, label: `A ${t.name.toLowerCase()}`, description: `Each submission is about one ${t.name.toLowerCase()}`, icon: iconOf(t.icon), text: t.name })),
            ]}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function Submissions({ form, onClose, onOpen }: { form: FormDto; onClose(): void; onOpen(id: string): void }) {
  return (
    <Dialog open wide onClose={onClose} title={`${form.name}: submissions`}>
      <SubmissionsTable form={form} onOpen={onOpen} />
    </Dialog>
  );
}

/** A form's submissions with a status filter (when it has an approval workflow). */
export function SubmissionsTable({ form, onOpen }: { form: FormDto; onOpen(id: string): void }) {
  const { tenantId, project } = useProject();
  const [status, setStatus] = useState<SubmissionStatus | ''>('');
  const [pg, setPg] = usePagination([status], 25);
  const subs = useQuery({
    queryKey: ['submissions', tenantId, project.key, form.key, pg, status],
    queryFn: () => api.submissions(tenantId, project.key, form.key, { ...pg, status: status || undefined }),
    placeholderData: keepPreviousData,
  });
  const wf = form.settings.workflow.enabled;
  const about = form.subjectType?.key === PROJECT_SUBJECT ? 'project' : (form.subjectType?.name ?? 'Entity');
  if (subs.data && !subs.data.total && !status)
    return (
      <EmptyState icon={ClipboardList} title="No submissions yet">
        {form.currentVersion
          ? `Answers to ${form.name} are listed here as people submit them, with who sent each one and which ${about.toLowerCase()} it is about.`
          : `Publish ${form.name} to start collecting answers. They will be listed here, one row per ${about.toLowerCase()} reported on.`}
      </EmptyState>
    );
  return (
    <>
      <ErrorNotice error={subs.error} />
      {wf && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {(['', ...SUBMISSION_STATUSES.filter((x) => x !== 'complete')] as const).map((x) => (
            <button
              key={x || 'all'}
              type="button"
              aria-pressed={status === x}
              onClick={() => setStatus(x)}
              className={`px-2.5 py-1 text-xs ring-1 ${status === x ? 'bg-accent-600 text-on-accent ring-accent-600' : 'bg-snow text-zinc-600 ring-zinc-200 hover:ring-zinc-400'}`}
            >
              {x ? STATUS_INFO[x].label : 'All'}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden border border-zinc-200 bg-snow">
      <div className="max-h-[60vh] overflow-auto">
        <Table
          head={[
            `${about} code`,
            `${about} name`,
            'Submitted by',
            'Submitted at',
            ...(wf ? ['Status'] : []),
          ]}
          tintEmpty
          empty={subs.data ? <Empty icon={ClipboardList} title="No matching submissions">Try a different status.</Empty> : undefined}
        >
          {subs.data?.items.map((s) => (
            <tr
              key={s.id}
              className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
              onClick={() => onOpen(s.id)}
            >
              <Td className="font-mono text-xs">{s.entity?.code ?? '—'}</Td>
              <Td>{s.entity?.name ?? <span className="text-zinc-400">—</span>}</Td>
              <Td className="text-sm">{s.submittedBy ?? '—'}</Td>
              <Td className="text-xs whitespace-nowrap">{dateTime(s.submittedAt)}</Td>
              {wf && (
                <Td>
                  <SubmissionStatusPill s={s} />
                  {s.stageName && s.status === 'in_review' && <div className="mt-0.5 text-[11px] text-zinc-500">{s.stageName}</div>}
                </Td>
              )}
            </tr>
          ))}
        </Table>
      </div>
      {subs.data && <Pagination {...pg} total={subs.data.total} onChange={setPg} />}
      </div>
    </>
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
      inboxHref={`/o/${tenantId}/forms/${project.key}/${formKey}`}
    />
  );
}

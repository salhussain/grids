import { SUBMISSION_ACTIONS, type SubmissionAction, type SubmissionsPage } from '@grids/schema';
import { Checkbox, Listbox, Select, Switch, cx } from '@grids/ui';
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  Download,
  Eye,
  History,
  Link2,
  ListFilter,
  MousePointerClick,
  Pencil,
  Plus,
  Table2,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Draft } from './FormBuilder';
import { TYPE_INFO } from './FormQuestions';
import { Card } from './PanelCard';
import { usePermissionGroups } from './permissions';

const BUILT_IN: Record<string, string> = {
  entity: 'Submission',
  status: 'Status',
  submittedBy: 'Submitted by',
  submitted: 'Submitted',
};
const BUILT_IN_NOTE: Record<string, string> = { entity: 'the place or the form’s title' };

const ACTIONS: Record<
  SubmissionAction,
  { label: string; note: string; who: string; icon: LucideIcon }
> = {
  view: { label: 'View', note: 'Eye icon', who: 'Anyone who can see the submission', icon: Eye },
  edit: {
    label: 'Edit',
    note: 'Pencil icon. Draft or Returned submissions only',
    who: 'The sender, and managers',
    icon: Pencil,
  },
  history: {
    label: 'History',
    note: 'Where it is and what happened. In the three-dot menu',
    who: 'Anyone who can view',
    icon: History,
  },
  download: {
    label: 'Download PDF',
    note: 'The submission record as a PDF. In the three-dot menu',
    who: 'Anyone allowed to download',
    icon: Download,
  },
  duplicate: {
    label: 'Duplicate',
    note: 'In the three-dot menu',
    who: 'People who can fill the form',
    icon: Copy,
  },
  link: {
    label: 'Copy link',
    note: 'In the three-dot menu',
    who: 'Anyone who can view',
    icon: Link2,
  },
  remove: { label: 'Delete', note: 'Asks for confirmation', who: 'Managers', icon: Trash2 },
};

/** A tab that can be switched on: a small picture of it, its name, and what it shows. */
function TabTile({
  on,
  onChange,
  label,
  note,
  which,
  rows,
}: {
  on: boolean;
  onChange(v: boolean): void;
  label: string;
  note: string;
  which: number;
  rows: number;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx(
        'relative flex flex-col border p-2 text-start transition-colors',
        on ? 'border-accent-600 bg-accent-50' : 'border-zinc-200 hover:border-zinc-400',
      )}
    >
      <span
        className={cx(
          'absolute end-2 top-2 flex size-4 items-center justify-center border text-[10px] leading-none',
          on
            ? 'border-accent-600 bg-accent-600 text-on-accent'
            : 'border-zinc-300 bg-snow text-transparent',
        )}
        aria-hidden
      >
        ✓
      </span>
      <span className={cx('block border border-zinc-200 bg-snow', !on && 'opacity-60')} aria-hidden>
        <span className="flex gap-2 border-b border-zinc-200 px-2 pt-1.5 text-[9px] text-zinc-400">
          {['All', 'Pending', 'Mine'].map((t, i) => (
            <span
              key={t}
              className={cx(
                'pb-1',
                i === which && 'border-b-2 border-accent-600 font-semibold text-ink',
              )}
            >
              {t}
            </span>
          ))}
        </span>
        <span className="block space-y-1.5 p-2">
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="flex items-center gap-2">
              <i className="h-1.5 flex-1 bg-zinc-200" />
              <i className={cx('h-1.5 w-6', which === 1 ? 'bg-accent-600' : 'bg-zinc-300')} />
            </span>
          ))}
        </span>
      </span>
      <span className="mt-2 block text-sm font-medium">{label}</span>
      <span className="block text-xs text-zinc-500">{note}</span>
    </button>
  );
}

/** A setting: its name and a line about it on the left, the control on the right. */
function Row({
  label,
  intro,
  children,
}: {
  label: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-start gap-x-8 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div>
        <div className="text-[13px] font-medium text-zinc-700">{label}</div>
        <p className="mt-0.5 text-xs text-zinc-500">{intro}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** What the form's submissions page shows, which filters and tabs it has, and which actions each row offers. */
export function SubmissionsPanel({ draft, set }: { draft: Draft; set(p: Partial<Draft>): void }) {
  const groups = usePermissionGroups();
  const sp = draft.settings.submissionsPage;
  const patch = (p: Partial<SubmissionsPage>) =>
    set({ settings: { ...draft.settings, submissionsPage: { ...sp, ...p } } });
  const questions = draft.def.sections.flatMap((s) =>
    s.questions.filter(
      (q) => !['note', 'calculate', 'image', 'file', 'signature'].includes(q.type),
    ),
  );
  const labelOf = (key: string) =>
    BUILT_IN[key] ?? questions.find((q) => q.key === key)?.label ?? key;
  const setCol = (i: number, p: Partial<SubmissionsPage['columns'][number]>) =>
    patch({ columns: sp.columns.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...sp.columns];
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c!);
    patch({ columns: next });
  };
  const shownCols = sp.columns.filter((c) => c.show);
  const searchCols = sp.columns.filter((c) => c.search);
  const free = questions.filter((q) => !sp.columns.some((c) => c.key === q.key));
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        <Card
          title="Columns"
          description="Built-in columns plus any answer on the form. Each person can still reorder their own."
          icon={Columns3}
        >
          <div className="-mx-5 -mt-5 -mb-5">
            <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_5rem] gap-3 bg-zinc-50 px-5 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              <span>Column</span>
              <span>Show</span>
              <span>Search</span>
              <span className="text-end">Order</span>
            </div>
            <ul className="divide-y divide-zinc-100">
              {sp.columns.map((c, i) => (
                <li
                  key={c.key}
                  className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_5rem] items-center gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">
                    {labelOf(c.key)}
                    <span className="ms-1.5 text-xs font-normal text-zinc-500">
                      {BUILT_IN[c.key]
                        ? BUILT_IN_NOTE[c.key]
                          ? `(${BUILT_IN_NOTE[c.key]})`
                          : ''
                        : '(an answer)'}
                    </span>
                  </span>
                  <Checkbox
                    label={<span className="sr-only">Show {labelOf(c.key)}</span>}
                    checked={c.show}
                    onChange={(e) => setCol(i, { show: e.target.checked })}
                  />
                  <Checkbox
                    label={<span className="sr-only">Search in {labelOf(c.key)}</span>}
                    checked={c.search}
                    onChange={(e) => setCol(i, { search: e.target.checked })}
                  />
                  <span className="flex items-center justify-end gap-0.5 text-zinc-500">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="p-1 hover:text-ink disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={i === sp.columns.length - 1}
                      onClick={() => move(i, 1)}
                      className="p-1 hover:text-ink disabled:opacity-30"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    {!BUILT_IN[c.key] && (
                      <button
                        type="button"
                        aria-label={`Remove ${labelOf(c.key)}`}
                        onClick={() => patch({ columns: sp.columns.filter((_, j) => j !== i) })}
                        className="p-1 hover:text-red-700"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-zinc-100 px-5 py-3">
              <Listbox
                searchable
                label="Add a column from an answer"
                placeholder="Add a column from an answer"
                value={null}
                align="start"
                disabled={!free.length}
                trigger={{
                  className:
                    'inline-flex h-8 items-center gap-1.5 px-2 text-sm font-medium text-accent-700 hover:bg-accent-50 disabled:text-zinc-400 disabled:hover:bg-transparent',
                  children: (
                    <>
                      <Plus className="size-4" />{' '}
                      {free.length
                        ? 'Add a column from an answer'
                        : 'Every answer is already a column'}
                    </>
                  ),
                }}
                options={free.map((q) => ({
                  value: q.key,
                  label: q.label || q.key,
                  description: q.key,
                  icon: Plus,
                }))}
                onChange={(k) =>
                  patch({
                    columns: [...sp.columns, { key: k as string, show: true, search: false }],
                  })
                }
              />
            </div>
          </div>
        </Card>

        <Card
          title="Filters, tabs and order"
          description="What people can narrow the list by, and how it opens."
          icon={ListFilter}
        >
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-zinc-700">
              Filters people can use
            </div>
            <ul className="divide-y divide-zinc-100 border border-zinc-200">
              {(
                [
                  ['status', 'Status', 'Default'],
                  ['date', 'Date range', 'Default'],
                  ['submittedBy', 'Submitted by', 'Default'],
                  ['place', 'Place', 'Only for forms about a place'],
                ] as const
              ).map(([key, label, note]) => (
                <li key={key} className="px-4 py-2.5">
                  <Checkbox
                    label={label}
                    description={note}
                    checked={sp.filters[key]}
                    onChange={(e) => patch({ filters: { ...sp.filters, [key]: e.target.checked } })}
                  />
                </li>
              ))}
              {questions.map((q) => {
                const on = sp.filters.answers.includes(q.key);
                return (
                  <li key={q.key} className="px-4 py-2.5">
                    <Checkbox
                      label={q.label || q.key}
                      description={`${TYPE_INFO[q.type]?.label ?? q.type} question · ${q.key}`}
                      checked={on}
                      disabled={!on && sp.filters.answers.length >= 5}
                      onChange={(e) =>
                        patch({
                          filters: {
                            ...sp.filters,
                            answers: e.target.checked
                              ? [...sp.filters.answers, q.key]
                              : sp.filters.answers.filter((k) => k !== q.key),
                          },
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
            {questions.length > 0 && (
              <p className="mt-1.5 text-xs text-zinc-500">Up to 5 answers can be filters.</p>
            )}
          </div>
          <div>
            <div className="text-[13px] font-medium text-zinc-700">Tabs</div>
            <p className="mb-1.5 mt-0.5 text-xs text-zinc-500">
              The views along the top of the page.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <TabTile
                on={sp.tabs.all}
                onChange={(v) => patch({ tabs: { ...sp.tabs, all: v } })}
                label="All submissions"
                note="Everything the person is allowed to see"
                which={0}
                rows={4}
              />
              <TabTile
                on={sp.tabs.pending}
                onChange={(v) => patch({ tabs: { ...sp.tabs, pending: v } })}
                label="Pending actions"
                note="Waiting on the person, so only people who can act see it"
                which={1}
                rows={2}
              />
              <TabTile
                on={sp.tabs.mine}
                onChange={(v) => patch({ tabs: { ...sp.tabs, mine: v } })}
                label="My submissions"
                note="Only what the person sent themselves"
                which={2}
                rows={2}
              />
            </div>
          </div>
          <div className="space-y-5 border-t border-zinc-100 pt-5">
            <Row label="Default order" intro="Which submissions come first when the page opens">
              <Select
                aria-label="Default order"
                value={sp.order}
                onChange={(e) => patch({ order: e.target.value as SubmissionsPage['order'] })}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </Select>
            </Row>
            <Row label="Rows per page" intro="How many submissions show before the next page">
              <Select
                aria-label="Rows per page"
                value={String(sp.pageSize)}
                onChange={(e) =>
                  patch({ pageSize: Number(e.target.value) as SubmissionsPage['pageSize'] })
                }
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Row>
          </div>
        </Card>

        <Card
          title="Actions on each row"
          description="Turn an action on, then choose who gets it. Managers always can. Review follows the workflow, so it is not set here."
          icon={MousePointerClick}
        >
          <div className="-mx-5 -mt-5 -mb-5">
            <div className="grid grid-cols-[minmax(0,1.3fr)_4rem_minmax(0,1.2fr)] gap-3 bg-zinc-50 px-5 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              <span>Action</span>
              <span>On</span>
              <span>Who can use it</span>
            </div>
            <ul className="divide-y divide-zinc-100">
              {SUBMISSION_ACTIONS.map((id) => {
                const a = sp.actions[id];
                const info = ACTIONS[id];
                const setA = (p: Partial<typeof a>) =>
                  patch({ actions: { ...sp.actions, [id]: { ...a, ...p } } });
                return (
                  <li
                    key={id}
                    className="grid grid-cols-[minmax(0,1.3fr)_4rem_minmax(0,1.2fr)] items-center gap-3 px-5 py-3 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <info.icon className="size-4 shrink-0 text-zinc-500" aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-medium">{info.label}</span>
                        <span className="block truncate text-xs text-zinc-500">{info.note}</span>
                      </span>
                    </span>
                    <Switch
                      label={`${info.label} on`}
                      checked={a.on}
                      onChange={(on) => setA({ on })}
                    />
                    {a.on ? (
                      <Listbox
                        compact
                        searchable
                        label={`Who can ${info.label.toLowerCase()}`}
                        placeholder={info.who}
                        value={null}
                        values={a.groups}
                        disabled={!groups.data?.length}
                        options={(groups.data ?? []).map((g) => ({
                          value: g.id,
                          label: `${'  '.repeat(g.depth)}${g.name}`,
                          text: g.name,
                          description: 'and above',
                        }))}
                        onChangeMany={(ids) => setA({ groups: ids })}
                      />
                    ) : (
                      <span className="text-xs text-zinc-400">Off for this form</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      </div>
      <aside className="space-y-5 xl:sticky xl:top-0">
        <Card
          title="What people see"
          description="The submissions page, as set here."
          icon={Table2}
        >
          <dl className="-mx-5 -mt-5 -mb-5 divide-y divide-zinc-100 text-[13px]">
            {(
              [
                [
                  'Columns',
                  shownCols.length ? shownCols.map((c) => labelOf(c.key)).join(', ') : 'None',
                ],
                [
                  'Searches in',
                  searchCols.length ? searchCols.map((c) => labelOf(c.key)).join(', ') : 'Nothing',
                ],
                [
                  'Filters',
                  [
                    sp.filters.status && 'Status',
                    sp.filters.date && 'Date range',
                    sp.filters.submittedBy && 'Submitted by',
                    sp.filters.place && 'Place',
                    ...sp.filters.answers.map(labelOf),
                  ]
                    .filter(Boolean)
                    .join(', ') || 'None',
                ],
                [
                  'Tabs',
                  [
                    sp.tabs.all && 'All submissions',
                    sp.tabs.pending && 'Pending actions',
                    sp.tabs.mine && 'My submissions',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'None',
                ],
                [
                  'Order',
                  `${sp.order === 'newest' ? 'Newest' : 'Oldest'} first, ${sp.pageSize} per page`,
                ],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-5 py-2">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="min-w-0 break-words font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Row actions" description="Who gets each action." icon={MousePointerClick}>
          <ul className="-mx-5 -mt-5 -mb-5 divide-y divide-zinc-100 text-[13px]">
            {SUBMISSION_ACTIONS.map((id) => {
              const a = sp.actions[id];
              const info = ACTIONS[id];
              const names = a.groups
                .map((g) => groups.data?.find((x) => x.id === g)?.name)
                .filter(Boolean);
              return (
                <li key={id} className="flex items-start gap-3 px-5 py-2">
                  <info.icon
                    className={cx(
                      'mt-0.5 size-4 shrink-0',
                      a.on ? 'text-accent-700' : 'text-zinc-300',
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className={cx('font-medium', !a.on && 'text-zinc-400')}>{info.label}</div>
                    <div className="text-xs text-zinc-500">
                      {a.on
                        ? names.length
                          ? `${names.join(', ')} and above, and managers`
                          : info.who
                        : 'Off for this form'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <p className="text-xs text-zinc-500">
          Choosing permissions adds those people to the usual rule shown in grey; leave it empty to
          keep the usual rule.
        </p>
      </aside>
    </div>
  );
}

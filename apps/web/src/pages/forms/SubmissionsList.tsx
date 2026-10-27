import type { FormDefinition, Question, SubmissionDto, SubmissionsPage } from '@grids/schema';
import { SUBMISSION_RECORD_ID } from '@grids/schema';
import { Dialog, Input, cx, dateTime, relTime, useToast } from '@grids/ui';
import { Link } from '@tanstack/react-router';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock,
  Download,
  Eye,
  Hash,
  Inbox,
  Link2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Search,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { saveBlob } from '../projects/DocumentsPanel';
import { EntityName } from '../projects/FormInputs';
import { FilterMenu, type FilterCategory, type FilterValue } from '../support/FilterMenu';
import { SubmissionActivity } from './SubmissionSheet';
import { STATUS_INFO, SubmissionStatusPill, fmtAnswer } from './status';

const BUILT_IN: Record<string, string> = {
  entity: 'Submission',
  status: 'Status',
  submittedBy: 'Submitted by',
  submitted: 'Submitted',
};
const RANGES = [
  { value: 'any', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

/** The text an answer shows as in a column or a search (choices by their labels). */
const textOf = (q: Question | undefined, v: unknown) => {
  if (v === undefined || v === null || v === '') return '';
  const label = (x: unknown) => q?.options?.find((o) => o.value === x)?.label ?? x;
  return fmtAnswer(Array.isArray(v) ? v.map(label) : label(v));
};

/** A small menu for the less used row actions; drawn over the page so a table never clips it. */
function RowMenu({ items }: { items: { label: string; icon: typeof Eye; onClick(): void }[] }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) =>
      !(e.target instanceof Node && box.current?.contains(e.target)) && setAt(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [at]);
  if (!items.length) return null;
  return (
    <>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: r.right, y: r.bottom });
        }}
        className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {at && (
        <div
          ref={box}
          role="menu"
          style={{ position: 'fixed', top: at.y + 4, left: Math.max(8, at.x - 192) }}
          className="z-50 w-48 border border-zinc-300 bg-snow py-1 shadow-lg"
        >
          {items.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setAt(null);
                i.onClick();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm hover:bg-zinc-50"
            >
              <i.icon className="size-4 text-zinc-500" /> {i.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** The submissions of a form, laid out as its settings ask: columns, filters, order, paging and row actions. */
export function SubmissionsList({
  items,
  cfg,
  def,
  tenantId,
  project,
  formKey,
  onOpen,
}: {
  items: SubmissionDto[];
  cfg: SubmissionsPage;
  def: FormDefinition | null;
  tenantId: string;
  project: string;
  formKey: string;
  onOpen(id: string): void;
}) {
  const toast = useToast();
  const questions = useMemo(
    () => new Map((def?.sections ?? []).flatMap((s) => s.questions).map((q) => [q.key, q])),
    [def],
  );
  const [q, setQ] = useState('');
  const [fv, setFv] = useState<FilterValue>({});
  const [history, setHistory] = useState<SubmissionDto | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, fv, items]);

  const cols = cfg.columns.filter((c) => c.show && (BUILT_IN[c.key] || questions.has(c.key)));
  const shown = cols.length ? cols : [{ key: 'entity', show: true, search: true }];
  const act = cfg.actions;
  const canOpen = act.view.on;
  const answerOf = (s: SubmissionDto, key: string) => textOf(questions.get(key), s.answers[key]);
  const searchText = (s: SubmissionDto) =>
    cfg.columns
      .filter((c) => c.search)
      .map((c) =>
        c.key === 'entity'
          ? (s.entity?.name ?? s.formName)
          : c.key === 'submittedBy'
            ? (s.submittedBy ?? '')
            : BUILT_IN[c.key]
              ? ''
              : answerOf(s, c.key),
      )
      .join(' ')
      .toLowerCase();

  const range = fv.date?.[0] ?? 'any';
  const since = (() => {
    const now = new Date();
    if (range === '7' || range === '30')
      return new Date(now.getTime() - Number(range) * 86_400_000);
    if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
    if (range === 'year') return new Date(now.getFullYear(), 0, 1);
    return null;
  })();
  const needle = q.trim().toLowerCase();
  const filtered = items.filter((s) => {
    if (needle && !searchText(s).includes(needle)) return false;
    if (fv.status?.length && !fv.status.includes(s.status)) return false;
    if (since && new Date(s.submittedAt) < since) return false;
    if (fv.by?.length && !fv.by.includes(s.submittedBy ?? 'Unknown')) return false;
    if (fv.place?.length && !fv.place.includes(s.entity?.name ?? '')) return false;
    for (const [k, picked] of Object.entries(fv)) {
      if (!k.startsWith('ans:') || !picked.length) continue;
      const have = answerOf(s, k.slice(4)).split(', ');
      if (!picked.some((x) => have.includes(x))) return false;
    }
    return true;
  });
  const sorted = [...filtered].sort((a, b) =>
    cfg.order === 'newest'
      ? b.submittedAt.localeCompare(a.submittedAt)
      : a.submittedAt.localeCompare(b.submittedAt),
  );
  const pages = Math.max(1, Math.ceil(sorted.length / cfg.pageSize));
  const rows = sorted.slice((page - 1) * cfg.pageSize, page * cfg.pageSize);

  const people = [...new Set(items.map((s) => s.submittedBy ?? 'Unknown'))].sort();
  const places = [...new Set(items.flatMap((s) => (s.entity ? [s.entity.name] : [])))].sort();
  const link = (id: string) =>
    `${window.location.origin}/o/${tenantId}/forms/${project}/${formKey}?submission=${id}`;
  const menuFor = (s: SubmissionDto) => [
    ...(act.history.on ? [{ label: 'History', icon: Clock, onClick: () => setHistory(s) }] : []),
    ...(act.download.on
      ? [
          {
            label: 'Download PDF',
            icon: Download,
            onClick: () =>
              void api
                .submissionDocument(tenantId, project, formKey, s.id, SUBMISSION_RECORD_ID, 'pdf')
                .then((blob) => saveBlob(blob, `${s.entity?.name ?? s.formName}.pdf`))
                .catch((e: unknown) =>
                  toast(e instanceof Error ? e.message : 'The PDF could not be made'),
                ),
          },
        ]
      : []),
    ...(act.link.on
      ? [
          {
            label: 'Copy link',
            icon: Link2,
            onClick: () =>
              void navigator.clipboard.writeText(link(s.id)).then(
                () => toast('Link copied'),
                () => toast('The browser would not copy it'),
              ),
          },
        ]
      : []),
  ];
  const anyRowActions =
    act.view.on || act.edit.on || act.history.on || act.download.on || act.link.on;
  const cell = (key: string, s: SubmissionDto) => {
    if (key === 'entity')
      return (
        <span className="font-medium">
          {s.entity?.name ?? s.formName}
          {s.status === 'returned' && (
            <span className="ms-2 text-xs font-medium text-amber-800">Changes requested</span>
          )}
        </span>
      );
    if (key === 'status') return <SubmissionStatusPill s={s} />;
    if (key === 'submittedBy')
      return <span className="text-zinc-600">{s.submittedBy ?? 'Unknown'}</span>;
    if (key === 'submitted')
      return (
        <span className="text-zinc-500" title={dateTime(s.submittedAt)}>
          {relTime(s.submittedAt)}
        </span>
      );
    const qn = questions.get(key);
    const v = s.answers[key];
    if (qn?.type === 'entity' && typeof v === 'string')
      return <EntityName tenantId={tenantId} project={project} id={v} />;
    return <span className="text-zinc-700">{textOf(qn, v) || '—'}</span>;
  };

  const f = cfg.filters;
  const answerFilters = f.answers.filter((k) => questions.has(k));
  const categories: FilterCategory[] = [
    ...(f.status
      ? [
          {
            id: 'status',
            label: 'Status',
            icon: CircleDot,
            options: Object.entries(STATUS_INFO).map(([value, i]) => ({ value, label: i.label })),
          },
        ]
      : []),
    ...(f.date
      ? [
          {
            id: 'date',
            label: 'Date range',
            icon: CalendarRange,
            options: RANGES.filter((r) => r.value !== 'any'),
          },
        ]
      : []),
    ...(f.submittedBy
      ? [
          {
            id: 'by',
            label: 'Submitted by',
            icon: UserRound,
            options: people.map((p) => ({ value: p, label: p })),
          },
        ]
      : []),
    ...(f.place && places.length
      ? [
          {
            id: 'place',
            label: 'Place',
            icon: MapPin,
            options: places.map((p) => ({ value: p, label: p })),
          },
        ]
      : []),
    ...answerFilters.map((k) => {
      const qn = questions.get(k)!;
      const values = qn.options?.length
        ? qn.options.map((o) => o.label)
        : [...new Set(items.map((s) => answerOf(s, k)).filter(Boolean))].sort().slice(0, 200);
      return {
        id: `ans:${k}`,
        label: qn.label || k,
        icon: Hash,
        options: values.map((v) => ({ value: v, label: v })),
      };
    }),
  ];
  // A date range is one choice: picking another replaces it.
  const setFilters = (next: FilterValue) => {
    const d = next.date ?? [];
    setFv(
      d.length > 1
        ? { ...next, date: [d.find((x) => !(fv.date ?? []).includes(x)) ?? d[0]!] }
        : next,
    );
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-full max-w-xs">
          <Input
            icon={Search}
            aria-label="Search submissions"
            placeholder="Search a place or person"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {categories.length > 0 && (
          <FilterMenu categories={categories} value={fv} onChange={setFilters} />
        )}
      </div>
      <div className="overflow-x-auto border border-zinc-200 bg-snow">
        <table className="w-full min-w-[40rem] text-start text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              {shown.map((c, i) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cx('py-2 text-start font-medium', i === 0 && 'ps-4')}
                >
                  {BUILT_IN[c.key] ?? questions.get(c.key)?.label ?? c.key}
                </th>
              ))}
              {anyRowActions && (
                <th scope="col" className="py-2 pe-4 text-end font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                tabIndex={canOpen ? 0 : undefined}
                onClick={canOpen ? () => onOpen(s.id) : undefined}
                onKeyDown={canOpen ? (e) => e.key === 'Enter' && onOpen(s.id) : undefined}
                className={cx(
                  'border-t border-zinc-100',
                  canOpen &&
                    'cursor-pointer hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none',
                )}
              >
                {shown.map((c, i) => (
                  <td key={c.key} className={cx('py-2.5', i === 0 && 'ps-4')}>
                    {cell(c.key, s)}
                  </td>
                ))}
                {anyRowActions && (
                  <td
                    className="py-1.5 pe-3 text-end whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {act.view.on && (
                      <button
                        type="button"
                        aria-label="View"
                        title="View"
                        onClick={() => onOpen(s.id)}
                        className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
                      >
                        <Eye className="size-4" />
                      </button>
                    )}
                    {act.edit.on && s.canResubmit && (
                      <Link
                        to={`/o/${tenantId}/fill/${project}/${formKey}`}
                        search={{ resubmit: s.id }}
                        aria-label="Edit"
                        title="Edit"
                        className="inline-flex p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
                      >
                        <Pencil className="size-4" />
                      </Link>
                    )}
                    <RowMenu items={menuFor(s)} />
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={shown.length + 1} className="px-4 py-12 text-center">
                  {items.length ? (
                    <p className="text-sm text-zinc-500">Nothing matches.</p>
                  ) : (
                    <div className="mx-auto flex max-w-md flex-col items-center">
                      <Inbox className="mb-3 size-7 text-accent-600" aria-hidden />
                      <p className="text-sm font-semibold text-ink">No submissions yet</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        Click “New submission” to add one, or wait for people to fill in the form.
                      </p>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
        <span>
          {sorted.length} {sorted.length === 1 ? 'submission' : 'submissions'}
          {sorted.length !== items.length && ` of ${items.length}`}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="p-1 hover:text-ink disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            Page {page} of {pages}
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
              className="p-1 hover:text-ink disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </span>
        )}
      </div>
      {history && (
        <Dialog
          open
          wide
          onClose={() => setHistory(null)}
          title={history.entity?.name ?? history.formName}
          description="History of this submission"
        >
          <SubmissionActivity tenantId={tenantId} project={project} id={history.id} />
        </Dialog>
      )}
    </div>
  );
}

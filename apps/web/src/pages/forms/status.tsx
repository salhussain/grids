import {
  questionWidth,
  type DocumentFormat,
  type DocumentTemplate,
  type FormDefinition,
  type Question,
  type QuestionWidth,
  type ReviewDto,
  type SubmissionDto,
  type SubmissionStatus,
  type SubmissionViewDto,
} from '@grids/schema';
import { Button, Listbox, Status, cx, relTime, useToast } from '@grids/ui';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { saveBlob } from '../projects/DocumentsPanel';
import { AttachmentImage, AttachmentLink, EntityName } from '../projects/FormInputs';
import {
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  CornerUpLeft,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  Send,
  X,
  type LucideIcon,
} from 'lucide-react';

/** The exact time, for hovering over "2 days ago": day, month, year and the time with am or pm. */
export const exactTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

/** "2 days ago", with the exact time shown at once on hover or tap (a plain tooltip waits a second or two). */
export function TimeAgo({ at }: { at: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="underline decoration-zinc-300 decoration-dotted underline-offset-2 hover:text-ink"
      >
        {relTime(at)}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute start-0 top-full z-30 mt-1 border border-zinc-300 bg-snow px-2 py-1 text-xs whitespace-nowrap text-ink shadow-lg"
        >
          {exactTime(at)}
        </span>
      )}
    </span>
  );
}

export const STATUS_INFO: Record<
  SubmissionStatus,
  { label: string; tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent' }
> = {
  complete: { label: 'Submitted', tone: 'neutral' },
  in_review: { label: 'In review', tone: 'info' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  returned: { label: 'Changes requested', tone: 'warn' },
};

/** The status, under the name the form’s author gave the outcome it reached (when it has one). */
export const statusLabel = (
  s: Pick<SubmissionDto, 'status' | 'outcome'> & { stageName?: string | null },
) =>
  ((s.status === 'approved' || s.status === 'rejected') && s.outcome) ||
  // While it is being reviewed, the stage it is waiting at (as named in the workflow).
  (s.status === 'in_review' && s.stageName) ||
  STATUS_INFO[s.status].label;

/** Submitted is grey, approved is the theme colour, rejected is maroon like the delete button; a stage under review has the colour its workflow gives it. */
const OUTCOME_COLOR: Partial<Record<SubmissionStatus, string>> = {
  approved: 'var(--brand-600)',
  rejected: '#7a1f24',
};

export function SubmissionStatusPill({
  s,
}: {
  s: Pick<SubmissionDto, 'status' | 'outcome'> & {
    stageName?: string | null;
    stageColor?: string | null;
  };
}) {
  const i = STATUS_INFO[s.status];
  return (
    <Status
      value={s.status}
      tone={i.tone}
      label={statusLabel(s)}
      color={s.status === 'in_review' ? s.stageColor : (OUTCOME_COLOR[s.status] ?? null)}
    />
  );
}

/** The approval path: stages done, current, and to come. */
export function StageTrack({
  stages,
  current,
  status,
  outcome,
  className,
}: {
  stages: string[];
  current: number | null;
  status: SubmissionStatus;
  /** The name of the outcome it ended at, shown as the last step. */ outcome?: string | null;
  className?: string;
}) {
  if (!stages.length) return null;
  const finished = status === 'approved';
  return (
    <ol
      className={cx('flex flex-wrap items-center gap-1.5 text-xs', className)}
      aria-label="Approval stages"
    >
      <li className="inline-flex items-center gap-1.5 bg-zinc-100 px-2.5 py-1 text-zinc-600">
        <Send className="size-3" /> Submitted
      </li>
      {stages.map((name, i) => {
        const done = finished || (current !== null && i < current);
        const here = !finished && current === i;
        const bad = here && status === 'rejected';
        const back = here && status === 'returned';
        return (
          <li key={`${i}-${name}`} className="inline-flex items-center gap-1.5">
            <span className="h-px w-3 bg-zinc-300" />
            <span
              className={cx(
                'inline-flex items-center gap-1.5 px-2.5 py-1',
                bad
                  ? 'bg-red-50 text-red-800 ring-1 ring-red-200'
                  : back
                    ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
                    : done
                      ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                      : here
                        ? 'bg-accent-50 font-medium text-accent-800 ring-1 ring-accent-300'
                        : 'bg-snow text-zinc-500 ring-1 ring-zinc-200',
              )}
              aria-current={here ? 'step' : undefined}
            >
              {bad ? (
                <X className="size-3" />
              ) : back ? (
                <CornerUpLeft className="size-3" />
              ) : done ? (
                <Check className="size-3" />
              ) : here ? (
                <CircleDot className="size-3 animate-pulse" />
              ) : (
                <span className="num">{i + 1}</span>
              )}
              {name}
            </span>
          </li>
        );
      })}
      {outcome && (status === 'approved' || status === 'rejected') && (
        <li className="inline-flex items-center gap-1.5">
          <span className="h-px w-3 bg-zinc-300" />
          <span
            className={cx(
              'inline-flex items-center gap-1.5 px-2.5 py-1 font-medium ring-1',
              status === 'approved'
                ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                : 'bg-red-50 text-red-800 ring-red-200',
            )}
          >
            {status === 'approved' ? <Check className="size-3" /> : <X className="size-3" />}
            {outcome}
          </span>
        </li>
      )}
    </ol>
  );
}

const DECISION: Record<ReviewDto['decision'], { label: string; icon: typeof Check; tone: string }> =
  {
    submitted: { label: 'submitted', icon: Send, tone: 'bg-accent-50 text-accent-700' },
    resubmitted: { label: 'resubmitted', icon: RotateCcw, tone: 'bg-accent-50 text-accent-700' },
    approved: { label: 'approved', icon: Check, tone: 'bg-accent-600 text-on-accent' },
    rejected: { label: 'rejected', icon: X, tone: 'bg-red-50 text-red-700' },
    returned: {
      label: 'sent back for changes',
      icon: CornerUpLeft,
      tone: 'bg-amber-50 text-amber-700',
    },
    timed_out: { label: 'not decided in time', icon: Clock, tone: 'bg-amber-50 text-amber-700' },
  };

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
};

/** Everything that happened to a submission, oldest first, under the day it happened; repeated openings by one person fold into a line. */
export function ActivityLog({
  reviews,
  views,
}: {
  reviews: ReviewDto[];
  views: SubmissionViewDto[];
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  type Item =
    | { kind: 'review'; at: string; r: ReviewDto }
    | { kind: 'download'; at: string; v: SubmissionViewDto }
    | { kind: 'opens'; at: string; who: string; times: string[] };
  const days = new Map<string, Item[]>();
  const push = (i: Item) => days.set(dayLabel(i.at), [...(days.get(dayLabel(i.at)) ?? []), i]);
  for (const r of reviews) push({ kind: 'review', at: r.at, r });
  const opens = new Map<string, { who: string; times: string[] }>();
  for (const v of views) {
    if (v.kind === 'downloaded') push({ kind: 'download', at: v.at, v });
    else {
      const key = `${dayLabel(v.at)}|${v.actor ?? 'Someone'}`;
      const cur = opens.get(key) ?? { who: v.actor ?? 'Someone', times: [] };
      cur.times.push(v.at);
      opens.set(key, cur);
    }
  }
  for (const [, o] of opens) {
    const times = [...o.times].sort().reverse();
    push({ kind: 'opens', at: times[0]!, who: o.who, times });
  }
  const groups = [...days.entries()]
    .map(([day, items]) => [day, items.sort((a, b) => a.at.localeCompare(b.at))] as const)
    .sort((a, b) => a[1][0]!.at.localeCompare(b[1][0]!.at));
  if (!groups.length)
    return <p className="text-sm text-zinc-500">Nothing has happened to it yet.</p>;
  return (
    <div className="relative space-y-4 before:absolute before:inset-y-2 before:start-[13px] before:w-px before:bg-zinc-200">
      {groups.map(([day, items]) => (
        <section key={day}>
          <h4 className="relative z-10 mb-1 inline-block bg-snow py-1 pe-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase ring-4 ring-snow">
            {day}
          </h4>
          <ul className="space-y-1">
            {items.map((it, i) => {
              if (it.kind === 'review') {
                const r = it.r;
                const d = DECISION[r.decision];
                return (
                  <li key={`r${i}`} className="relative flex gap-3 py-1.5">
                    <span
                      className={cx(
                        'relative z-10 flex size-7 shrink-0 items-center justify-center ring-4 ring-snow',
                        d.tone,
                      )}
                    >
                      <d.icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5 text-sm">
                      <p>
                        <span className="font-semibold">
                          {r.actor ?? (r.decision === 'timed_out' ? 'The workflow' : 'Someone')}
                        </span>{' '}
                        {d.label}
                        {r.stageName &&
                          r.decision !== 'submitted' &&
                          r.decision !== 'resubmitted' && (
                            <span className="text-zinc-600"> at {r.stageName}</span>
                          )}{' '}
                        <span className="text-xs text-zinc-400">
                          <TimeAgo at={r.at} />
                        </span>
                      </p>
                      {r.comment && (
                        <p className="mt-1.5 bg-zinc-100 px-3 py-2 text-zinc-800 ring-1 ring-zinc-200">
                          {r.comment}
                        </p>
                      )}
                    </div>
                  </li>
                );
              }
              if (it.kind === 'download')
                return (
                  <li key={`d${i}`} className="relative flex gap-3 py-1.5">
                    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center bg-zinc-100 text-zinc-700 ring-4 ring-snow">
                      <Download className="size-3.5" />
                    </span>
                    <p className="min-w-0 pt-1 text-sm">
                      <span className="font-semibold">{it.v.actor ?? 'Someone'}</span> downloaded{' '}
                      {it.v.detail || 'a file'}{' '}
                      <span className="text-xs text-zinc-400">
                        <TimeAgo at={it.v.at} />
                      </span>
                    </p>
                  </li>
                );
              const key = `${day}|${it.who}`;
              const many = it.times.length > 1;
              return (
                <li key={`o${i}`} className="relative flex gap-3 py-1.5">
                  <span className="relative z-10 flex size-7 shrink-0 items-center justify-center bg-zinc-100 text-zinc-500 ring-4 ring-snow">
                    <Eye className="size-3.5" />
                  </span>
                  <div className="min-w-0 pt-1 text-sm text-zinc-600">
                    <p>
                      <span className="font-semibold text-ink">{it.who}</span> opened it{' '}
                      {many ? `${it.times.length} times, last ` : 'once '}
                      <span className="text-xs text-zinc-400">
                        <TimeAgo at={it.times[0]!} />
                      </span>
                      {many && (
                        <>
                          {' · '}
                          <button
                            type="button"
                            onClick={() => setOpen({ ...open, [key]: !open[key] })}
                            className="underline decoration-dotted underline-offset-2 hover:text-ink"
                          >
                            {open[key] ? 'hide' : 'show'}
                          </button>
                        </>
                      )}
                    </p>
                    {many && open[key] && (
                      <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
                        {it.times.map((t) => (
                          <li key={t}>{exactTime(t)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Who did what, when — the submission's audit trail. Detailed also lists each time someone opened it. */
export function ReviewTimeline({
  reviews,
  views = [],
  detailed = false,
}: {
  reviews: ReviewDto[];
  views?: SubmissionViewDto[];
  detailed?: boolean;
}) {
  if (!reviews.length && !views.length) return null;
  type Entry = { kind: 'review'; r: ReviewDto } | { kind: 'view'; v: SubmissionViewDto };
  const opens = views.filter((v) => (v.kind ?? 'opened') === 'opened');
  // Downloads are always part of the story; plain opening only in the detailed log.
  const entries: Entry[] = [
    ...reviews.map((r): Entry => ({ kind: 'review', r })),
    ...views
      .filter((v) => detailed || v.kind === 'downloaded')
      .map((v): Entry => ({ kind: 'view', v })),
  ].sort((x, y) =>
    (x.kind === 'review' ? x.r.at : x.v.at).localeCompare(y.kind === 'review' ? y.r.at : y.v.at),
  );
  const people = new Set(opens.map((v) => v.actor ?? 'Someone'));
  return (
    <div className="space-y-4">
      <ol className="relative space-y-4 before:absolute before:inset-y-2 before:start-[13px] before:w-px before:bg-zinc-200">
        {entries.map((e, i) => {
          if (e.kind === 'view') {
            const down = e.v.kind === 'downloaded';
            return (
              <li key={`v${i}`} className="relative flex gap-3">
                <span className="relative z-10 flex size-7 shrink-0 items-center justify-center bg-zinc-100 text-zinc-500 ring-4 ring-snow">
                  {down ? <Download className="size-3.5" /> : <Eye className="size-3.5" />}
                </span>
                <p className="min-w-0 pt-1 text-sm text-zinc-600">
                  <span className="font-medium text-ink">{e.v.actor ?? 'Someone'}</span>{' '}
                  {down ? `downloaded ${e.v.detail || 'a file'}` : 'opened it'}
                  <span className="text-xs text-zinc-400">
                    {' '}
                    · <TimeAgo at={e.v.at} />
                  </span>
                </p>
              </li>
            );
          }
          const r = e.r;
          const d = DECISION[r.decision];
          return (
            <li key={i} className="relative flex gap-3">
              <span
                className={cx(
                  'relative z-10 flex size-7 shrink-0 items-center justify-center ring-4 ring-snow',
                  d.tone,
                )}
              >
                <d.icon className="size-3.5" />
              </span>
              <div className="min-w-0 pt-0.5 text-sm">
                <p>
                  <span className="font-medium">
                    {r.actor ?? (r.decision === 'timed_out' ? 'The workflow' : 'Someone')}
                  </span>{' '}
                  {d.label}
                  {r.stageName && r.decision !== 'submitted' && r.decision !== 'resubmitted' && (
                    <span className="text-zinc-500"> at {r.stageName}</span>
                  )}
                  <span className="text-xs text-zinc-400">
                    {' '}
                    · <TimeAgo at={r.at} />
                  </span>
                </p>
                {r.comment && (
                  <p className="mt-1 rounded-lg bg-zinc-50 px-3 py-2 text-zinc-700 ring-1 ring-zinc-200">
                    {r.comment}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!detailed && opens.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <Eye className="size-3.5" aria-hidden />
          Opened {opens.length} {opens.length === 1 ? 'time' : 'times'} by {people.size}{' '}
          {people.size === 1 ? 'person' : 'people'}, last <TimeAgo at={opens[0]!.at} />
        </p>
      )}
    </div>
  );
}

export const fmtAnswer = (v: unknown) =>
  v === undefined || v === null || v === ''
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? 'Yes'
        : 'No'
      : Array.isArray(v)
        ? v.join(', ')
        : typeof v === 'object'
          ? 'lat' in (v as object)
            ? `${(v as { lat: number }).lat}, ${(v as { lon: number }).lon}`
            : JSON.stringify(v)
          : String(v);

/** Answers laid out by section, with option labels. */
const ANSWER_WIDTH: Record<QuestionWidth, string> = {
  full: '@xl:col-span-12',
  '1/2': '@xl:col-span-6',
  '1/3': '@xl:col-span-4',
  '2/3': '@xl:col-span-8',
  '1/4': '@xl:col-span-3',
  '3/4': '@xl:col-span-9',
};

export function AnswerList({
  definition,
  answers,
  tenantId,
  project,
}: {
  definition: FormDefinition | null;
  answers: Record<string, unknown>;
  tenantId?: string;
  project?: string;
}) {
  if (!definition)
    return (
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {Object.entries(answers).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-zinc-500">{k}</dt>
            <dd className="text-sm">{fmtAnswer(v)}</dd>
          </div>
        ))}
      </dl>
    );
  /** One question's answer: pictures, files and places as what they are, choices by their labels. */
  const cell = (q: Question, v: unknown) => {
    const label = (x: unknown) => q.options?.find((o) => o.value === x)?.label ?? x;
    const ids =
      Array.isArray(v) && (q.type === 'image' || q.type === 'file')
        ? (v as string[])
        : typeof v === 'string'
          ? [v]
          : [];
    if (tenantId && project && q.type === 'file' && ids.length)
      return (
        <span className="flex flex-col gap-1">
          {ids.map((id) => (
            <AttachmentLink key={id} tenantId={tenantId} project={project} id={id} />
          ))}
        </span>
      );
    if (tenantId && project && (q.type === 'image' || q.type === 'signature') && ids.length)
      return (
        <span className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <AttachmentImage
              key={id}
              tenantId={tenantId}
              project={project}
              id={id}
              className="h-28 w-40 border border-zinc-200"
            />
          ))}
        </span>
      );
    if (tenantId && project && typeof v === 'string' && q.type === 'entity')
      return <EntityName tenantId={tenantId} project={project} id={v} />;
    return fmtAnswer(Array.isArray(v) ? v.map(label) : label(v));
  };
  /** The rows of answers a section holds: one, or one per fill-in of a repeating section. */
  const rowsOf = (s: FormDefinition['sections'][number]): Record<string, unknown>[] =>
    s.repeat
      ? Array.isArray(answers[s.key])
        ? (answers[s.key] as Record<string, unknown>[])
        : []
      : [answers];
  return (
    <div className="@container space-y-5">
      {definition.sections.map((s) => {
        const rows = rowsOf(s).filter((r) =>
          s.questions.some((q) => q.type !== 'note' && q.key in r),
        );
        if (!rows.length) return null;
        return (
          <section key={s.key} className="border border-zinc-200 bg-snow">
            {s.title && (
              <header className="-mx-px -mt-px bg-accent-600 px-4 py-2.5">
                <h4 className="truncate text-sm font-semibold text-on-accent">{s.title}</h4>
              </header>
            )}
            <div className="space-y-3 p-4">
              {rows.map((row, ri) => (
                <div key={ri} className={cx(s.repeat && 'border border-zinc-200 bg-snow')}>
                  {s.repeat && (
                    <div className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold text-zinc-600">{`${s.repeat.itemLabel || 'Item'} ${ri + 1}`}</div>
                  )}
                  {/* The questions in the widths the form was designed with (a narrow window shows one per row). */}
                  <dl className={cx('grid gap-x-6 gap-y-4 @xl:grid-cols-12', s.repeat && 'p-4')}>
                    {s.questions
                      .filter((q) => q.type !== 'note' && q.key in row)
                      .map((q) => (
                        <div
                          key={q.key}
                          className={cx('min-w-0', ANSWER_WIDTH[questionWidth(q, s.columns)])}
                        >
                          <dt className="mb-1 text-[13px] font-medium text-zinc-700">{q.label}</dt>
                          <dd className="min-h-9 border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm break-words text-ink">
                            {cell(q, row[q.key])}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const DOCUMENT_FORMATS: { id: DocumentFormat; label: string; icon: LucideIcon }[] = [
  { id: 'pdf', label: 'PDF', icon: FileText },
  { id: 'docx', label: 'Word', icon: FileText },
  { id: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
];

/** Makes one of the form's documents for this submission: each document once, with a button for each file type. */
export function SubmissionDocuments({
  tenantId,
  project,
  formKey,
  submissionId,
  documents,
}: {
  tenantId: string;
  project: string;
  formKey: string;
  submissionId: string;
  documents: DocumentTemplate[];
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!documents.length) return null;
  const make = async (d: DocumentTemplate, format: DocumentFormat) => {
    setBusy(`${d.id}|${format}`);
    try {
      saveBlob(
        await api.submissionDocument(tenantId, project, formKey, submissionId, d.id, format),
        `${d.name}.${format}`,
      );
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The document could not be made');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div ref={box} className="relative">
      <Button
        icon={FileDown}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Documents <ChevronDown className="size-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 z-30 mt-1 w-[24rem] max-w-[90vw] border border-zinc-300 bg-snow shadow-lg"
        >
          <div className="border-b border-zinc-200 px-3 py-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
            Make from this submission
          </div>
          <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.name}</span>
                  {d.description && (
                    <span className="block text-xs text-zinc-500">{d.description}</span>
                  )}
                </span>
                <span className="w-36 shrink-0">
                  <Listbox
                    compact
                    label={`Download ${d.name} as`}
                    placeholder={busy?.startsWith(`${d.id}|`) ? 'Making…' : 'Download as'}
                    disabled={!!busy}
                    value={null}
                    options={DOCUMENT_FORMATS.filter((f) => d.formats.includes(f.id)).map((f) => ({
                      value: f.id,
                      label: f.label,
                      icon: f.icon,
                    }))}
                    onChange={(f) => void make(d, f as DocumentFormat)}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

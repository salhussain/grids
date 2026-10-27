import { approvalsOf } from '@grids/forms';
import { StagePartCard, useStagePart, withoutStagePart } from './StageFields';
import { withRecord } from '@grids/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, ErrorNotice, Loading, Textarea, cx, dateTime, useToast } from '@grids/ui';
import {
  AlignLeft,
  Check,
  CircleDot,
  Clock,
  CornerUpLeft,
  ListTree,
  MapPin,
  Pencil,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import {
  ActivityLog,
  AnswerList,
  TimeAgo,
  ReviewTimeline,
  StageTrack,
  SubmissionDocuments,
  SubmissionStatusPill,
} from './status';

/** The colour of the project this was opened from: a window added to the page body would otherwise wear the workspace's. */
function projectBrand(): React.CSSProperties | undefined {
  const scope = [...document.querySelectorAll('.brand-scope')].pop();
  if (!scope) return undefined;
  const look = getComputedStyle(scope);
  const brand = {
    '--brand-600': look.getPropertyValue('--brand-600').trim(),
    '--brand-contrast': look.getPropertyValue('--brand-contrast').trim(),
  };
  return brand['--brand-600'] ? (brand as React.CSSProperties) : undefined;
}

/** Refreshes everything that shows submissions after a decision. */
export function useInvalidateSubmissions(tenantId: string) {
  const qc = useQueryClient();
  return () => {
    for (const k of ['inbox', 'submission', 'submissions', 'forms'])
      void qc.invalidateQueries({ queryKey: [k, tenantId] });
  };
}

/**
 * A submission in a side sheet: answers, where it is in its approval path, the
 * review trail, and — for reviewers — approve / send back / reject.
 */
export function SubmissionSheet({
  tenantId,
  project,
  id,
  onClose,
}: {
  tenantId: string;
  project: string;
  id: string;
  onClose(): void;
}) {
  const sub = useQuery({
    queryKey: ['submission', tenantId, project, id],
    queryFn: () => api.submission(tenantId, project, id),
  });
  const forms = useQuery({
    queryKey: ['forms', tenantId, project],
    queryFn: () => api.forms(tenantId, project),
  });
  const form = forms.data?.find((f) => f.id === sub.data?.formId);
  const toast = useToast();
  const invalidate = useInvalidateSubmissions(tenantId);
  const [comment, setComment] = useState('');
  const part = useStagePart(sub.data, form?.published);
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject' | 'return') =>
      api.review(tenantId, project, id, {
        decision,
        comment,
        answers: decision === 'approve' && part.def ? part.answers : {},
      }),
    onError: part.fail,
    onSuccess: (s, decision) => {
      toast(
        decision === 'approve'
          ? s.status === 'approved'
            ? 'Approved'
            : `Approved — now with ${s.stageName}`
          : decision === 'reject'
            ? 'Rejected'
            : 'Sent back for changes',
      );
      setComment('');
      invalidate();
    },
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = sub.data;
  const stage =
    s?.stage !== null && s?.stage !== undefined && form
      ? approvalsOf(form.settings)[s.stage]
      : undefined;
  const lastReturn = s?.reviews.filter((r) => r.decision === 'returned').at(-1);
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" style={projectBrand()}>
      <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal
        aria-label="Submission"
        className="relative flex h-full w-full max-w-xl animate-[slideIn_.25s_ease-out] flex-col bg-snow shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-zinc-200 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-zinc-500">{s?.project.name ?? '…'}</p>
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {s?.formName ?? 'Submission'}
            </h2>
          </div>
          {s && <SubmissionStatusPill s={s} />}
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <ErrorNotice error={sub.error} />
          {!s ? (
            <Loading />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-100 pb-4 text-sm text-zinc-700">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-4 text-zinc-400" /> {s.submittedBy ?? 'Unknown'}
                </span>
                {s.entity && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4 text-zinc-400" /> {s.entity.name}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-zinc-500">
                  <Clock className="size-4 text-zinc-400" /> {dateTime(s.submittedAt)}
                </span>
                {form && (
                  <span className="ms-auto">
                    <SubmissionDocuments
                      tenantId={tenantId}
                      project={project}
                      formKey={s.formKey}
                      submissionId={s.id}
                      documents={withRecord(form.settings.documents ?? [])}
                    />
                  </span>
                )}
              </div>
              <StageTrack
                stages={s.stages}
                current={s.stage}
                status={s.status}
                outcome={s.outcome}
              />
              {s.status === 'returned' && lastReturn && (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  <p className="font-medium">
                    Changes requested{lastReturn.actor ? ` by ${lastReturn.actor}` : ''}
                  </p>
                  <p className="mt-0.5">{lastReturn.comment}</p>
                </div>
              )}
              <AnswerList
                definition={withoutStagePart(
                  form?.published ?? form?.draft ?? null,
                  s.nodeId,
                  !!part.def,
                )}
                answers={s.answers}
                tenantId={tenantId}
                project={project}
              />
              <StagePartCard part={part} s={s} tenantId={tenantId} project={project} />
              {s.reviews.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold">Activity</h3>
                  <ReviewTimeline reviews={s.reviews} />
                </section>
              )}
            </>
          )}
        </div>
        {s?.canReview && (
          <footer className="space-y-3 border-t border-zinc-200 bg-zinc-50/80 px-6 py-4">
            <div className="text-xs text-zinc-500">
              Reviewing as{' '}
              <span className="font-medium text-zinc-700">{s.stageName ?? 'reviewer'}</span>
              {stage?.description && <> · {stage.description}</>}
            </div>
            <Textarea
              aria-label="Comment"
              placeholder="Add a comment (required to send back or reject)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-16"
            />
            <ErrorNotice error={review.error} />
            <div className="flex flex-wrap gap-2">
              <Button
                icon={Check}
                onClick={() => part.check() && review.mutate('approve')}
                loading={review.isPending && review.variables === 'approve'}
                disabled={review.isPending}
              >
                Approve
              </Button>
              {(stage?.allowReturn ?? true) && (
                <Button
                  variant="secondary"
                  icon={CornerUpLeft}
                  onClick={() => review.mutate('return')}
                  disabled={review.isPending || !comment.trim()}
                >
                  Send back
                </Button>
              )}
              <span className="flex-1" />
              <Button
                variant="danger"
                icon={X}
                onClick={() => review.mutate('reject')}
                disabled={review.isPending || !comment.trim()}
              >
                Reject
              </Button>
            </div>
          </footer>
        )}
        {s?.canResubmit && (
          <footer className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-amber-50/60 px-6 py-4">
            <p className="text-sm text-amber-900">Update your answers and send it again.</p>
            <Link
              to={`/o/${tenantId}/fill/${project}/${s.formKey}`}
              search={{ resubmit: s.id }}
              onClick={onClose}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              <Pencil className="size-4" /> Edit and resubmit
            </Link>
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}

/** Where a submission is on its way, step by step, top to bottom. */
function Steps({ s }: { s: NonNullable<ReturnType<typeof useSubmission>['data']> }) {
  const finished = s.status === 'approved';
  const rows: {
    name: string;
    note?: React.ReactNode;
    state: 'done' | 'here' | 'todo' | 'bad' | 'back';
  }[] = [
    {
      name: 'Submitted',
      note: (
        <>
          {s.submittedBy ?? 'Someone'} · <TimeAgo at={s.submittedAt} />
        </>
      ),
      state: 'done',
    },
    ...s.stages.map((name, i) => {
      // Who decided at this stage and when (the latest decision there).
      const d = [...s.reviews]
        .reverse()
        .find((r) => r.stage === i && ['approved', 'rejected', 'returned'].includes(r.decision));
      return {
        name,
        note: d ? (
          <>
            {d.actor ?? 'Someone'} · <TimeAgo at={d.at} />
          </>
        ) : undefined,
        state: (finished || (s.stage !== null && i < s.stage)
          ? 'done'
          : s.stage === i
            ? s.status === 'rejected'
              ? 'bad'
              : s.status === 'returned'
                ? 'back'
                : 'here'
            : 'todo') as 'done' | 'here' | 'todo' | 'bad' | 'back',
      };
    }),
  ];
  if (s.status === 'approved' || s.status === 'rejected')
    rows.push({
      name: s.outcome ?? (s.status === 'approved' ? 'Approved' : 'Rejected'),
      state: s.status === 'approved' ? 'done' : 'bad',
    });
  return (
    <ol>
      {rows.map((r, i) => (
        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
          {i < rows.length - 1 && (
            <span className="absolute start-[11px] top-6 bottom-0 w-0.5 bg-zinc-200" />
          )}
          <span
            className={cx(
              'relative z-10 flex size-6 shrink-0 items-center justify-center text-xs',
              r.state === 'done'
                ? 'bg-accent-600 text-on-accent'
                : r.state === 'here'
                  ? 'text-accent-700'
                  : r.state === 'bad'
                    ? 'bg-red-600 text-white'
                    : r.state === 'back'
                      ? 'bg-amber-500 text-white'
                      : 'bg-zinc-100 text-zinc-400',
            )}
          >
            {r.state === 'done' ? (
              <Check className="size-3.5" />
            ) : r.state === 'bad' ? (
              <X className="size-3.5" />
            ) : r.state === 'back' ? (
              <CornerUpLeft className="size-3.5" />
            ) : r.state === 'here' ? (
              <CircleDot className="size-5 animate-pulse" />
            ) : (
              i
            )}
          </span>
          <div className="min-w-0 pt-0.5">
            <div className={cx('text-sm', r.state === 'todo' ? 'text-zinc-500' : 'font-semibold')}>
              {r.name}
            </div>
            {r.note && <div className="text-xs text-zinc-500">{r.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function useSubmission(tenantId: string, project: string, id: string) {
  return useQuery({
    queryKey: ['submission', tenantId, project, id],
    queryFn: () => api.submission(tenantId, project, id),
  });
}

/** Only the history of a submission: where it stands, then everything that happened to it, day by day. */
export function SubmissionActivity({
  tenantId,
  project,
  id,
}: {
  tenantId: string;
  project: string;
  id: string;
}) {
  const sub = useSubmission(tenantId, project, id);
  if (sub.isPending) return <Loading />;
  if (sub.isError || !sub.data) return <ErrorNotice error={sub.error} />;
  const s = sub.data;
  const short = (n: string) => n.split(' · ')[0]!;
  const done = s.status === 'approved' || s.status === 'rejected';
  // At the final stage, or finished: the path shows nothing more than the status beside it.
  const atLast = done || (s.stage !== null && s.stage >= s.stages.length - 1);
  const lastMove =
    [...s.reviews].filter((r) => r.decision !== 'timed_out').at(-1)?.at ?? s.submittedAt;
  return (
    <div className="-mx-6 -my-5 flex max-h-[70vh] min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-accent-50 px-6 py-3">
        <SubmissionStatusPill s={s} />
        <span className="text-sm">
          {done
            ? 'Decided'
            : s.status === 'returned'
              ? 'Waiting for the sender since'
              : 'Waiting since'}{' '}
          <TimeAgo at={done ? (s.decidedAt ?? lastMove) : lastMove} />
        </span>
        {!atLast && (
          <ol className="ms-auto flex flex-wrap items-center gap-1.5 text-xs" aria-label="Stages">
            {['Submitted', ...s.stages].map((name, i) => {
              const at = i === 0 ? null : i - 1;
              const here = !done && at !== null && s.stage === at;
              const passed = i === 0 || done || (s.stage !== null && at! < s.stage);
              return (
                <li key={`${i}-${name}`} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-zinc-400">›</span>}
                  <span
                    title={name}
                    className={cx(
                      'border px-2 py-1',
                      here
                        ? 'border-accent-600 bg-accent-600 font-semibold text-on-accent'
                        : passed
                          ? 'border-accent-600 text-accent-700'
                          : 'border-zinc-300 text-zinc-500',
                    )}
                  >
                    {i === 0 ? name : short(name)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <h3 className="mb-3 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
          Activity
        </h3>
        <ActivityLog reviews={s.reviews} views={s.views ?? []} />
      </div>
    </div>
  );
}

/** A submission read in full: its answers in the middle, its path and the decision on the right. */
export function SubmissionPane({
  tenantId,
  project,
  id,
  actionsHost,
}: {
  tenantId: string;
  project: string;
  id: string;
  /** A place in the window's header for the documents button and the status (the title is shown there too). */ actionsHost?: HTMLElement | null;
}) {
  const sub = useSubmission(tenantId, project, id);
  const forms = useQuery({
    queryKey: ['forms', tenantId, project],
    queryFn: () => api.forms(tenantId, project),
  });
  const form = forms.data?.find((f) => f.id === sub.data?.formId);
  const toast = useToast();
  const invalidate = useInvalidateSubmissions(tenantId);
  const [comment, setComment] = useState('');
  const [detailed, setDetailed] = useState(false);
  const part = useStagePart(sub.data, form?.published);
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject' | 'return') =>
      api.review(tenantId, project, id, {
        decision,
        comment,
        answers: decision === 'approve' && part.def ? part.answers : {},
      }),
    onError: part.fail,
    onSuccess: (s, decision) => {
      toast(
        decision === 'approve'
          ? s.status === 'approved'
            ? 'Approved'
            : `Approved. Now with ${s.stageName}`
          : decision === 'reject'
            ? 'Rejected'
            : 'Sent back for changes',
      );
      setComment('');
      invalidate();
    },
  });
  const s = sub.data;
  const stage =
    s?.stage !== null && s?.stage !== undefined && form
      ? approvalsOf(form.settings)[s.stage]
      : undefined;
  const lastReturn = s?.reviews.filter((r) => r.decision === 'returned').at(-1);
  if (!s)
    return <div className="p-6">{sub.error ? <ErrorNotice error={sub.error} /> : <Loading />}</div>;
  return (
    <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
      <div className="min-h-0 min-w-0 space-y-5 overflow-y-auto p-5 sm:p-6">
        {actionsHost !== undefined ? (
          actionsHost &&
          createPortal(
            <>
              {form && (
                <SubmissionDocuments
                  tenantId={tenantId}
                  project={project}
                  formKey={s.formKey}
                  submissionId={s.id}
                  documents={withRecord(form.settings.documents ?? [])}
                />
              )}
            </>,
            actionsHost,
          )
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-semibold tracking-tight">
                {s.entity?.name ?? s.formName}
              </h2>
              <p className="mt-0.5 text-[13px] text-zinc-500">
                {s.formName} · submitted by {s.submittedBy ?? 'unknown'} · {dateTime(s.submittedAt)}
              </p>
            </div>
            {form && (
              <SubmissionDocuments
                tenantId={tenantId}
                project={project}
                formKey={s.formKey}
                submissionId={s.id}
                documents={withRecord(form.settings.documents ?? [])}
              />
            )}
            <SubmissionStatusPill s={s} />
          </div>
        )}
        {s.status === 'returned' && lastReturn && (
          <div className="border-s-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">
              Changes requested{lastReturn.actor ? ` by ${lastReturn.actor}` : ''}
            </p>
            <p className="mt-0.5">{lastReturn.comment}</p>
          </div>
        )}
        <AnswerList
          definition={withoutStagePart(
            form?.published ?? form?.draft ?? null,
            s.nodeId,
            !!part.def,
          )}
          answers={s.answers}
          tenantId={tenantId}
          project={project}
        />
        <StagePartCard part={part} s={s} tenantId={tenantId} project={project} />
      </div>
      <aside className="flex min-h-0 flex-col border-zinc-200 bg-snow xl:border-s">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          <section>
            <h3 className="mb-3 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
              Where it is
            </h3>
            <Steps s={s} />
            {stage?.description && (
              <p className="mt-4 border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600">
                <b className="font-semibold text-ink">Instructions:</b> {stage.description}
              </p>
            )}
          </section>
          {(s.reviews.length > 0 || (s.views ?? []).length > 0) && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                  Activity
                </h3>
                {(s.views ?? []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDetailed(!detailed)}
                    title={detailed ? 'Show the summary' : 'Show every time it was opened'}
                    className="inline-flex h-7 items-center gap-1.5 px-2 text-xs text-zinc-700 hover:bg-zinc-100"
                  >
                    {detailed ? (
                      <AlignLeft className="size-3.5" />
                    ) : (
                      <ListTree className="size-3.5" />
                    )}
                    {detailed ? 'Summary' : 'Detailed'}
                  </button>
                )}
              </div>
              <ReviewTimeline reviews={s.reviews} views={s.views ?? []} detailed={detailed} />
            </section>
          )}
        </div>
        {s.canReview && (
          <div className="space-y-3 border-t border-zinc-200 bg-zinc-50 p-5">
            <div className="text-[13px] font-medium">
              Comment{' '}
              <span className="font-normal text-zinc-500">· needed to send back or reject</span>
            </div>
            <Textarea
              aria-label="Comment"
              placeholder="Add internal notes related to your decision"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-16"
            />
            <ErrorNotice error={review.error} />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                icon={Check}
                onClick={() => part.check() && review.mutate('approve')}
                loading={review.isPending && review.variables === 'approve'}
                disabled={review.isPending}
              >
                Approve
              </Button>
              {(stage?.allowReturn ?? true) && (
                <Button
                  className="flex-1"
                  variant="secondary"
                  icon={CornerUpLeft}
                  onClick={() => review.mutate('return')}
                  disabled={review.isPending || !comment.trim()}
                >
                  Send back
                </Button>
              )}
              <Button
                variant="danger"
                icon={X}
                aria-label="Reject"
                title="Reject"
                onClick={() => review.mutate('reject')}
                disabled={review.isPending || !comment.trim()}
              />
            </div>
          </div>
        )}
        {s.canResubmit && (
          <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-amber-50 p-5">
            <p className="text-sm text-amber-900">Update your answers and send it again.</p>
            <Link
              to={`/o/${tenantId}/fill/${project}/${s.formKey}`}
              search={{ resubmit: s.id }}
              className="inline-flex h-9 items-center gap-2 bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              <Pencil className="size-4" /> Edit and resubmit
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}

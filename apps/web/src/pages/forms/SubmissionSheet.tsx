import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, ErrorNotice, Loading, Textarea, dateTime, useToast } from '@grids/ui';
import { Check, CornerUpLeft, MapPin, Pencil, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import { AnswerList, ReviewTimeline, StageTrack, SubmissionStatusPill } from './status';

/** Refreshes everything that shows submissions after a decision. */
export function useInvalidateSubmissions(tenantId: string) {
  const qc = useQueryClient();
  return () => {
    for (const k of ['inbox', 'submission', 'submissions', 'forms']) void qc.invalidateQueries({ queryKey: [k, tenantId] });
  };
}

/**
 * A submission in a side sheet: answers, where it is in its approval path, the
 * review trail, and — for reviewers — approve / send back / reject.
 */
export function SubmissionSheet({ tenantId, project, id, onClose }: { tenantId: string; project: string; id: string; onClose(): void }) {
  const sub = useQuery({ queryKey: ['submission', tenantId, project, id], queryFn: () => api.submission(tenantId, project, id) });
  const forms = useQuery({ queryKey: ['forms', tenantId, project], queryFn: () => api.forms(tenantId, project) });
  const form = forms.data?.find((f) => f.id === sub.data?.formId);
  const toast = useToast();
  const invalidate = useInvalidateSubmissions(tenantId);
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject' | 'return') => api.review(tenantId, project, id, { decision, comment }),
    onSuccess: (s, decision) => {
      toast(decision === 'approve' ? (s.status === 'approved' ? 'Approved' : `Approved — now with ${s.stageName}`) : decision === 'reject' ? 'Rejected' : 'Sent back for changes');
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
  const stage = s?.stage !== null && s?.stage !== undefined ? form?.settings.workflow.stages[s.stage] : undefined;
  const lastReturn = s?.reviews.filter((r) => r.decision === 'returned').at(-1);
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside role="dialog" aria-modal aria-label="Submission" className="relative flex h-full w-full max-w-xl animate-[slideIn_.25s_ease-out] flex-col bg-snow shadow-2xl">
        <header className="flex items-start gap-3 border-b border-zinc-200 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-zinc-500">{s?.project.name ?? '…'}</p>
            <h2 className="truncate text-lg font-semibold tracking-tight">{s?.formName ?? 'Submission'}</h2>
          </div>
          {s && <SubmissionStatusPill s={s} />}
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <ErrorNotice error={sub.error} />
          {!s ? (
            <Loading />
          ) : (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-600">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-4 text-zinc-400" /> {s.submittedBy ?? 'Unknown'}
                </span>
                {s.entity && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4 text-zinc-400" /> {s.entity.name}
                  </span>
                )}
                <span className="text-zinc-500">{dateTime(s.submittedAt)}</span>
              </div>
              <StageTrack stages={s.stages} current={s.stage} status={s.status} />
              {s.status === 'returned' && lastReturn && (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  <p className="font-medium">Changes requested{lastReturn.actor ? ` by ${lastReturn.actor}` : ''}</p>
                  <p className="mt-0.5">{lastReturn.comment}</p>
                </div>
              )}
              <AnswerList definition={form?.published ?? form?.draft ?? null} answers={s.answers} />
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
              Reviewing as <span className="font-medium text-zinc-700">{s.stageName ?? 'reviewer'}</span>
              {stage?.description && <> · {stage.description}</>}
            </div>
            <Textarea aria-label="Comment" placeholder="Add a comment (required to send back or reject)" value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-16" />
            <ErrorNotice error={review.error} />
            <div className="flex flex-wrap gap-2">
              <Button icon={Check} onClick={() => review.mutate('approve')} loading={review.isPending && review.variables === 'approve'} disabled={review.isPending}>
                Approve
              </Button>
              {(stage?.allowReturn ?? true) && (
                <Button variant="secondary" icon={CornerUpLeft} onClick={() => review.mutate('return')} disabled={review.isPending || !comment.trim()}>
                  Send back
                </Button>
              )}
              <span className="flex-1" />
              <Button variant="danger" icon={X} onClick={() => review.mutate('reject')} disabled={review.isPending || !comment.trim()}>
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

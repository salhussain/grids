import type { FormDefinition, ReviewDto, SubmissionDto, SubmissionStatus } from '@grids/schema';
import { Status, cx, relTime } from '@grids/ui';
import { Check, CircleDot, CornerUpLeft, RotateCcw, Send, X } from 'lucide-react';

export const STATUS_INFO: Record<SubmissionStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent' }> = {
  complete: { label: 'Submitted', tone: 'neutral' },
  in_review: { label: 'In review', tone: 'info' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  returned: { label: 'Changes requested', tone: 'warn' },
};

export function SubmissionStatusPill({ s }: { s: Pick<SubmissionDto, 'status'> }) {
  const i = STATUS_INFO[s.status];
  return <Status value={s.status} tone={i.tone} label={i.label} />;
}

/** The approval path: stages done, current, and to come. */
export function StageTrack({ stages, current, status, className }: { stages: string[]; current: number | null; status: SubmissionStatus; className?: string }) {
  if (!stages.length) return null;
  const finished = status === 'approved';
  return (
    <ol className={cx('flex flex-wrap items-center gap-1.5 text-xs', className)} aria-label="Approval stages">
      <li className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600">
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
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
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
              {bad ? <X className="size-3" /> : back ? <CornerUpLeft className="size-3" /> : done ? <Check className="size-3" /> : here ? <CircleDot className="size-3 animate-pulse" /> : <span className="num">{i + 1}</span>}
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const DECISION: Record<ReviewDto['decision'], { label: string; icon: typeof Check; tone: string }> = {
  submitted: { label: 'submitted', icon: Send, tone: 'bg-zinc-100 text-zinc-600' },
  resubmitted: { label: 'resubmitted', icon: RotateCcw, tone: 'bg-sky-50 text-sky-700' },
  approved: { label: 'approved', icon: Check, tone: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'rejected', icon: X, tone: 'bg-red-50 text-red-700' },
  returned: { label: 'sent back for changes', icon: CornerUpLeft, tone: 'bg-amber-50 text-amber-700' },
};

/** Who did what, when — the submission's audit trail. */
export function ReviewTimeline({ reviews }: { reviews: ReviewDto[] }) {
  if (!reviews.length) return null;
  return (
    <ol className="relative space-y-4 before:absolute before:inset-y-2 before:start-[13px] before:w-px before:bg-zinc-200">
      {reviews.map((r, i) => {
        const d = DECISION[r.decision];
        return (
          <li key={i} className="relative flex gap-3">
            <span className={cx('relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-snow', d.tone)}>
              <d.icon className="size-3.5" />
            </span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p>
                <span className="font-medium">{r.actor ?? 'Someone'}</span> {d.label}
                {r.stageName && r.decision !== 'submitted' && r.decision !== 'resubmitted' && <span className="text-zinc-500"> at {r.stageName}</span>}
                <span className="text-xs text-zinc-400"> · {relTime(r.at)}</span>
              </p>
              {r.comment && <p className="mt-1 rounded-lg bg-zinc-50 px-3 py-2 text-zinc-700 ring-1 ring-zinc-200">{r.comment}</p>}
            </div>
          </li>
        );
      })}
    </ol>
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
export function AnswerList({ definition, answers }: { definition: FormDefinition | null; answers: Record<string, unknown> }) {
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
  return (
    <div className="space-y-5">
      {definition.sections.map((s) => {
        const qs = s.questions.filter((q) => q.type !== 'note' && q.key in answers);
        if (!qs.length) return null;
        return (
          <section key={s.key}>
            {s.title && <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{s.title}</h4>}
            <dl className="grid gap-x-6 gap-y-3 rounded-xl bg-zinc-50/70 p-4 ring-1 ring-zinc-200/70 sm:grid-cols-2">
              {qs.map((q) => {
                const v = answers[q.key];
                const label = (x: unknown) => q.options?.find((o) => o.value === x)?.label ?? x;
                const shown = Array.isArray(v) ? v.map(label) : label(v);
                return (
                  <div key={q.key} className="min-w-0">
                    <dt className="text-xs text-zinc-500">{q.label}</dt>
                    <dd className="mt-0.5 text-sm font-medium break-words">{fmtAnswer(shown)}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

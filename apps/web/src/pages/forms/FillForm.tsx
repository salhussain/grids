import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { validate } from '@grids/forms';
import { FORM_LAYOUT_INFO, localizeForm, uuidv7, type SubmissionDto } from '@grids/schema';
import { ApiError, Button, ErrorNotice, Loading, Select, cx } from '@grids/ui';
import { ArrowLeft, CheckCircle2, CloudOff, CornerUpLeft, GitBranch, ListChecks, Lock, MapPin, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { FormRunner, type Answers } from '../projects/FormRenderer';
import { useOutbox } from './outbox';
import { useInvalidateSubmissions } from './SubmissionSheet';
import { StageTrack } from './status';

/**
 * Fills in (or, after it was sent back, corrects and resubmits) a published form.
 * Used from the Forms menu and from a project's Forms tab.
 */
export function FillForm({
  tenantId,
  project,
  formKey,
  back,
  resubmitId,
  entityId,
  inboxHref,
  projectName,
}: {
  tenantId: string;
  project: string;
  formKey: string;
  back: { to: string; label: string; search?: Record<string, string> };
  resubmitId?: string;
  entityId?: string;
  inboxHref: string;
  projectName?: string;
}) {
  const outbox = useOutbox();
  const { locale } = useI18n();
  const invalidate = useInvalidateSubmissions(tenantId);
  const forms = useQuery({ queryKey: ['forms', tenantId, project], queryFn: () => api.forms(tenantId, project) });
  const prior = useQuery({ queryKey: ['submission', tenantId, project, resubmitId], queryFn: () => api.submission(tenantId, project, resubmitId!), enabled: !!resubmitId });
  const form = forms.data?.find((f) => f.key === formKey);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [entity, setEntity] = useState<string>(entityId ?? '');
  const [done, setDone] = useState<SubmissionDto | 'offline' | null>(null);
  useEffect(() => {
    if (prior.data) setAnswers(prior.data.answers);
  }, [prior.data]);
  const subjects = useQuery({
    queryKey: ['entities', tenantId, project, 'subjects', form?.subjectType?.key],
    queryFn: () => api.entities(tenantId, project, { type: form!.subjectType!.key, pageSize: 200 }),
    enabled: !!form?.subjectType && !resubmitId,
  });
  const submit = useMutation({
    mutationFn: async (): Promise<SubmissionDto | 'offline'> => {
      const def = form!.published!;
      const local = validate(def, answers);
      if (!local.ok) {
        setErrors(local.errors);
        throw new Error('Some answers need attention');
      }
      try {
        if (resubmitId) return await api.resubmit(tenantId, project, resubmitId, { answers });
        const input = { id: uuidv7(), version: form!.currentVersion!, entityId: entity || null, answers, collectedAt: new Date().toISOString() };
        try {
          return await api.submit(tenantId, project, form!.key, input);
        } catch (e) {
          if (e instanceof ApiError) throw e;
          outbox.add({ tenantId, project, form: form!.key, formName: form!.name, input });
          return 'offline';
        }
      } catch (e) {
        if (e instanceof ApiError && e.problem.errors) setErrors(Object.fromEntries(e.problem.errors.map((x) => [x.path, x.message])));
        throw e;
      }
    },
    onSuccess: (r) => {
      setDone(r);
      invalidate();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (forms.isPending || (resubmitId && prior.isPending)) return <Loading />;
  if (forms.error) return <ErrorNotice error={forms.error} />;
  if (!form?.published) return <ErrorNotice error={new Error('This form is not published yet.')} />;
  // Shown in the person's language when the form has a translation for it.
  const def = localizeForm(form.published, locale);
  const wf = form.settings.workflow;
  const stages = wf.enabled ? wf.stages : [];
  const lastReturn = prior.data?.reviews.filter((r) => r.decision === 'returned').at(-1);
  const questionCount = def.sections.reduce((n, s) => n + s.questions.filter((q) => q.type !== 'note' && q.type !== 'calculate').length, 0);

  const backLink = (
    <Link to={back.to} search={back.search} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-ink">
      <ArrowLeft className="size-4" /> {back.label}
    </Link>
  );

  if (!form.canFill && !resubmitId)
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <div className="flex flex-col items-center rounded-3xl border border-zinc-200 bg-snow px-6 py-16 text-center">
          <Lock className="mb-3 size-8 text-zinc-400" />
          <p className="font-semibold">You can’t fill in this form</p>
          <p className="mt-1 text-sm text-zinc-500">Ask a project manager for access.</p>
        </div>
      </div>
    );

  if (done) {
    const s = done === 'offline' ? null : done;
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <div className="animate-[fadeUp_.35s_ease-out] overflow-hidden rounded-3xl border border-zinc-200 bg-snow text-center shadow-[var(--shadow-raised)]">
          <div className="bg-[radial-gradient(80%_100%_at_50%_0%,color-mix(in_oklab,var(--brand-600)_16%,transparent),transparent)] px-6 pt-12 pb-8">
            <span className={cx('mx-auto flex size-16 items-center justify-center ring-8', s?.status === 'in_review' ? 'bg-sky-50 text-sky-600 ring-sky-50/50' : 'bg-emerald-50 text-emerald-600 ring-emerald-50/50')}>
              {done === 'offline' ? <CloudOff className="size-8" /> : <CheckCircle2 className="size-8" />}
            </span>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">
              {done === 'offline' ? 'Saved on this device' : s?.status === 'in_review' ? 'Sent for review' : 'Thank you!'}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
              {done === 'offline'
                ? 'It will be sent automatically when you are back online.'
                : def.thankYou || (s?.status === 'in_review' ? `It’s now waiting on ${s.stageName}. You’ll see each decision in your submissions.` : 'Your submission has been recorded.')}
            </p>
            {s && s.stages.length > 0 && <StageTrack stages={s.stages} current={s.stage} status={s.status} className="mt-6 justify-center" />}
          </div>
          <div className="flex flex-wrap justify-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-6 py-4">
            {!resubmitId && (
              <Button
                variant="secondary"
                icon={RotateCcw}
                onClick={() => {
                  setDone(null);
                  setAnswers({});
                  setErrors({});
                }}
              >
                Fill in another
              </Button>
            )}
            <Link to={inboxHref} search={{ tab: 'mine' }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700">
              <ListChecks className="size-4" /> My submissions
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {backLink}
      <header className="relative overflow-hidden rounded-3xl border border-zinc-200 bg-snow px-6 py-7 shadow-[var(--shadow-card,0_1px_2px_rgb(0_0_0/0.04))] sm:px-8">
        <div className="pointer-events-none absolute -end-16 -top-20 size-56 rounded-full bg-accent-500/10 blur-2xl" />
        {projectName && <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">{projectName}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{def.title}</h1>
        {def.description && <p className="mt-1.5 text-sm text-zinc-600">{def.description}</p>}
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-600">
          <span className="bg-zinc-100 px-2.5 py-1">{questionCount} questions</span>
          <span className="bg-zinc-100 px-2.5 py-1">{FORM_LAYOUT_INFO[def.layout].label}</span>
          {stages.length > 0 && (
            <span className="inline-flex items-center gap-1 bg-sky-50 px-2.5 py-1 text-sky-800">
              <GitBranch className="size-3" /> Reviewed by {stages.map((s) => s.name).join(' → ')}
            </span>
          )}
        </div>
      </header>
      {resubmitId && lastReturn && (
        <div className="flex gap-3 rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <CornerUpLeft className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{lastReturn.actor ?? 'A reviewer'} asked for changes</p>
            <p className="mt-0.5">{lastReturn.comment}</p>
          </div>
        </div>
      )}
      <FormRunner
        definition={def}
        answers={answers}
        onChange={setAnswers}
        errors={errors}
        onErrors={setErrors}
        onSubmit={() => submit.mutate()}
        submitting={submit.isPending}
        canSubmit={!form.subjectType || !!entity || !!resubmitId}
        submitLabel={resubmitId ? 'Resubmit' : stages.length ? 'Submit for review' : 'Submit'}
        header={
          <>
            {form.subjectType && (
              <div className="rounded-2xl border border-zinc-200 bg-snow p-5">
                <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <MapPin className="size-4 text-accent-600" /> Which {form.subjectType.name.toLowerCase()}?
                </label>
                {resubmitId ? (
                  <p className="text-sm">{prior.data?.entity?.name ?? '—'}</p>
                ) : (
                  <Select aria-label={form.subjectType.name} value={entity} onChange={(e) => setEntity(e.target.value)}>
                    <option value="">Choose…</option>
                    {subjects.data?.items.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {e.parent ? ` (${e.parent.name})` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}
            <ErrorNotice error={submit.error} />
          </>
        }
        secondary={
          <Button variant="ghost" onClick={() => (setAnswers(prior.data?.answers ?? {}), setErrors({}))}>
            Clear
          </Button>
        }
      />
    </div>
  );
}

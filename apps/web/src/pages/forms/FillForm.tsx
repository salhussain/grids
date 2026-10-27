import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { approvalsOf, defaultAnswers, forFiller, questionsOf, validate } from '@grids/forms';
import {
  FORM_LAYOUT_INFO,
  localizeForm,
  uuidv7,
  type FormDefinition,
  type SubmissionDto,
  PROJECT_SUBJECT,
} from '@grids/schema';
import { ApiError, Button, ErrorNotice, LanguageMenu, Loading, Select, cx } from '@grids/ui';
import { LOCALES } from '@grids/i18n';
import { ArrowLeft, CheckCircle2, Clock, CloudOff, CornerUpLeft, GitBranch, ListChecks, Lock, MapPin, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { useWorkspace } from '../../session';
import { FormEnv, HeaderImage } from '../projects/FormInputs';
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
  back?: { to: string; label: string; search?: Record<string, string> };
  resubmitId?: string;
  entityId?: string;
  inboxHref: string;
  projectName?: string;
}) {
  const outbox = useOutbox();
  const { locale, t } = useI18n();
  const ws = useWorkspace();
  // A form can offer languages of its own; the person's choice here only changes this form.
  const [formLang, setFormLang] = useState<string | null>(null);
  const activeLocale = formLang ?? locale;
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
  // A new submission opens with each question's default value (once the form has loaded).
  const seeded = useRef(false);
  useEffect(() => {
    if (resubmitId || !form?.published || seeded.current) return;
    seeded.current = true;
    setAnswers(defaultAnswers(form.published));
  }, [form?.published, resubmitId]);
  // A form about the project itself needs no choice: the server uses the project's own entity.
  const aboutProject = form?.subjectType?.key === PROJECT_SUBJECT;
  const subjects = useQuery({
    queryKey: ['entities', tenantId, project, 'subjects', form?.subjectType?.key],
    queryFn: () => api.entities(tenantId, project, { type: form!.subjectType!.key, pageSize: 200 }),
    enabled: !!form?.subjectType && !aboutProject && !resubmitId,
  });
  // A question can be the form's main place, taking the place of the choice above the form.
  const mainKey = form?.published ? questionsOf(form.published).find((q) => q.primary)?.key : undefined;
  const subjectId = mainKey ? ((answers[mainKey] as string | undefined) ?? '') : entity;
  const submit = useMutation({
    mutationFn: async (): Promise<SubmissionDto | 'offline'> => {
      // Checked in the person's language, so messages match what they see.
      const local = validate(forFiller(localized(form!.published!, form!.draft, activeLocale)), answers);
      if (!local.ok) {
        setErrors(local.errors);
        throw new Error('Some answers need attention');
      }
      try {
        if (resubmitId) return await api.resubmit(tenantId, project, resubmitId, { answers });
        const input = { id: uuidv7(), version: form!.currentVersion!, entityId: subjectId || null, answers, collectedAt: new Date().toISOString() };
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
  // Shown in the person's language when the form has a translation for it. Translations
  // are presentation only, so the latest saved ones apply without republishing.
  // Parts that approvers fill in at a step are not in the applicant's form.
  const def = forFiller(localized(form.published, form.draft, activeLocale));
  // The original language, and every language the form has some translated text for.
  const original = ws.localization.defaultLanguage;
  const offered = LOCALES.filter(
    (l) =>
      l.code === original ||
      Object.values({ ...form.published!.translations[l.code], ...form.draft.translations[l.code] }).some((v) => v?.trim()),
  );
  const stages = approvalsOf(form.settings);
  const lastReturn = prior.data?.reviews.filter((r) => r.decision === 'returned').at(-1);
  const questionCount = def.sections.reduce((n, s) => n + s.questions.filter((q) => q.type !== 'note' && q.type !== 'calculate').length, 0);

  const backLink = back && (
    <Link to={back.to} search={back.search} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-ink">
      <ArrowLeft className="size-4" /> {back.label}
    </Link>
  );
  // Closed, not open yet or full: the author's message instead of the form (the server refuses it as well).
  if (form.availability.state !== 'open' && !resubmitId)
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <div className="flex flex-col items-center gap-3 border border-zinc-200 bg-snow px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center bg-zinc-100 text-zinc-500">
            {form.availability.state === 'not_yet' ? <Clock className="size-6" /> : <Lock className="size-6" />}
          </span>
          <h1 className="text-lg font-semibold">
            {form.availability.state === 'not_yet' ? 'Not open yet' : form.availability.state === 'limit' ? 'Already sent' : 'Closed'}
          </h1>
          <p className="max-w-md text-sm text-zinc-600">{form.availability.message}</p>
        </div>
      </div>
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
              {done === 'offline'
                ? t('web.form.savedOffline')
                : s?.status === 'in_review'
                  ? t('web.form.sentForReview')
                  : t('web.form.thankYou')}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
              {done === 'offline'
                ? t('web.form.sentLater')
                : def.thankYou ||
                  (s?.status === 'in_review'
                    ? t('web.form.waitingOn', { stage: s.stageName ?? '' })
                    : t('web.form.recorded'))}
            </p>
            {s && s.stages.length > 0 && <StageTrack stages={s.stages} current={s.stage} status={s.status} outcome={s.outcome} className="mt-6 justify-center" />}
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
                {t('web.form.fillAnother')}
              </Button>
            )}
            <Link
              to={inboxHref}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              <ListChecks className="size-4" /> {t('web.form.mySubmissions')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // A form that lays questions side by side gets a wider page to do it in.
  const sideBySide = def.sections.some((sec) => (sec.columns ?? 1) > 1 || sec.questions.some((q) => q.width && q.width !== 'full'));
  return (
    <div className={cx('mx-auto space-y-6', sideBySide ? 'max-w-4xl' : 'max-w-2xl')}>
      {backLink}
      {offered.length > 1 && (
        <div className="flex justify-end">
          <LanguageMenu
            value={offered.some((l) => l.code === activeLocale) ? activeLocale : original}
            onChange={setFormLang}
            label={t('web.prefs.language')}
            draftLabel={t('common.draftTranslation')}
            options={offered.map((l) => ({ code: l.code, label: l.nativeName, draft: l.status === 'draft' }))}
          />
        </div>
      )}
      <header className={cx('relative overflow-hidden rounded-3xl border border-zinc-200 bg-snow px-6 py-7 shadow-[var(--shadow-card,0_1px_2px_rgb(0_0_0/0.04))] sm:px-8', def.look.headerImage && 'min-h-44 border-transparent text-white')}>
        {def.look.headerImage ? <HeaderImage tenantId={tenantId} project={project} id={def.look.headerImage} /> : <div className="pointer-events-none absolute -end-16 -top-20 size-56 rounded-full bg-accent-500/10 blur-2xl" />}
        <div className="relative">
        {projectName && <p className={cx('text-xs font-medium tracking-wide uppercase', def.look.headerImage ? 'text-white/85' : 'text-accent-700')}>{projectName}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{def.title}</h1>
        {def.description && <p className={cx('mt-1.5 text-sm', def.look.headerImage ? 'text-white/90' : 'text-zinc-600')}>{def.description}</p>}
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-600">
          <span className="bg-zinc-100 px-2.5 py-1">
            {t('web.form.questions', { count: questionCount })}
          </span>
          <span className="bg-zinc-100 px-2.5 py-1">{FORM_LAYOUT_INFO[def.layout].label}</span>
          {stages.length > 0 && (
            <span className="inline-flex items-center gap-1 bg-sky-50 px-2.5 py-1 text-sky-800">
              <GitBranch className="size-3" />{' '}
              {t('web.form.reviewedBy', { stages: stages.map((s) => s.name || s.id).join(' → ') })}
            </span>
          )}
        </div>
        </div>
      </header>
      {resubmitId && lastReturn && (
        <div className="flex gap-3 rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <CornerUpLeft className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              {t('web.form.askedForChanges', { name: lastReturn.actor ?? t('web.form.aReviewer') })}
            </p>
            <p className="mt-0.5">{lastReturn.comment}</p>
          </div>
        </div>
      )}
      <FormEnv.Provider value={{ tenantId, project, formKey: form.key, subjectId: subjectId || prior.data?.entity?.id || null, answers: {} }}>
      <FormRunner
        definition={def}
        answers={answers}
        onChange={setAnswers}
        errors={errors}
        onErrors={setErrors}
        onSubmit={() => submit.mutate()}
        submitting={submit.isPending}
        canSubmit={!form.subjectType || aboutProject || !!subjectId || !!resubmitId}
        submitLabel={
          resubmitId
            ? t('web.form.resubmit')
            : stages.length
              ? t('web.form.submitForReview')
              : t('web.form.submit')
        }
        header={
          <>
            {form.subjectType && !aboutProject && !mainKey && (
              <div className="rounded-2xl border border-zinc-200 bg-snow p-5">
                <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <MapPin className="size-4 text-accent-600" />{' '}
                  {t('web.form.which', { type: form.subjectType.name.toLowerCase() })}
                </label>
                {resubmitId ? (
                  <p className="text-sm">{prior.data?.entity?.name ?? '—'}</p>
                ) : (
                  <Select
                    aria-label={form.subjectType.name}
                    value={entity}
                    onChange={(e) => setEntity(e.target.value)}
                  >
                    <option value="">{t('web.form.choose')}</option>
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
          <Button
            variant="ghost"
            onClick={() => (setAnswers(prior.data?.answers ?? (form?.published ? defaultAnswers(form.published) : {})), setErrors({}))}
          >
            {t('web.form.clear')}
          </Button>
        }
      />
      </FormEnv.Provider>
    </div>
  );
}

/** The published form in `locale`, using its published translations with the latest saved ones on top. */
function localized(
  published: FormDefinition,
  draft: FormDefinition,
  locale: string,
): FormDefinition {
  const translations = { ...published.translations };
  for (const [lang, texts] of Object.entries(draft.translations))
    translations[lang] = { ...published.translations[lang], ...texts };
  return localizeForm({ ...published, translations }, locale);
}

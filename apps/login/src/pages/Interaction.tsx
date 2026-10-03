import { Spinner } from '@grids/ui';
import { ArrowLeft, Check, Copy, Download, KeyRound, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call, LoginError, type Details, type StepResult, type TotpSetup } from '../api';
import { I18nProvider, useT } from '../i18n';
import { Shell } from '../Shell';
import { CodeField, ErrorBanner, LinkButton, Notice, PasswordField, StepHeader, StrengthMeter, SubmitButton, TextField } from '../widgets';

type View =
  | { kind: 'signIn' }
  | { kind: 'register' }
  | { kind: 'forgot' }
  | { kind: 'forgotSent'; email: string }
  | { kind: 'verify'; email: string }
  | { kind: 'mfa' }
  | { kind: 'mfaSetup' }
  | { kind: 'recovery'; codes: string[]; redirectTo: string }
  | { kind: 'redirecting' }
  | { kind: 'expired' };

const go = (url: string) => window.location.assign(url);

/** Shared request state for a step form. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** /ui/interaction/:uid — the OIDC sign-in flow. */
export function InteractionPage({ uid }: { uid: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    call<Details | { redirectTo: string }>(`/ui/interaction/${uid}/details`)
      .then((d) => {
        if ('redirectTo' in d) {
          setView({ kind: 'redirecting' });
          return go(d.redirectTo);
        }
        setDetails(d);
        const p = d.pending;
        if (p?.stage === 'verify_email') setView({ kind: 'verify', email: p.email ?? '' });
        else if (p?.stage === 'mfa') setView({ kind: 'mfa' });
        else if (p?.stage === 'mfa_setup') setView({ kind: 'mfaSetup' });
        else setView({ kind: 'signIn' });
      })
      .catch((e: unknown) => {
        if (e instanceof LoginError && [400, 404, 410].includes(e.status)) setView({ kind: 'expired' });
        else setLoadError(e);
      });
  }, [uid]);

  const org = details?.organization ?? null;
  return (
    <I18nProvider enabled={org?.languages} fallback={org?.defaultLanguage} hint={details?.uiLocales} overrides={org?.overrides}>
      <Shell org={org}>
        {loadError ? (
          <ErrorBanner error={loadError} />
        ) : !view ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6 text-accent-600" />
          </div>
        ) : (
          <Step uid={uid} details={details} view={view} setView={setView} />
        )}
      </Shell>
    </I18nProvider>
  );
}

function Step({ uid, details, view, setView }: { uid: string; details: Details | null; view: View; setView(v: View): void }) {
  const t = useT();
  const name = details?.organization ? details.organization.appName || details.organization.name : (details?.client.name ?? 'Grids');
  const base = `/ui/interaction/${uid}`;

  /** Follows whatever the server says comes next. */
  const advance = (r: StepResult) => {
    if ('redirectTo' in r) {
      setView({ kind: 'redirecting' });
      go(r.redirectTo);
    } else if (r.step === 'verify') setView({ kind: 'verify', email: r.email });
    else if (r.step === 'mfa') setView({ kind: 'mfa' });
    else setView({ kind: 'mfaSetup' });
  };

  switch (view.kind) {
    case 'signIn':
      return <SignIn base={base} name={name} details={details!} onNext={advance} setView={setView} />;
    case 'register':
      return <Register base={base} name={name} hint={details?.loginHint ?? ''} onNext={advance} setView={setView} />;
    case 'forgot':
      return <Forgot setView={setView} hint={details?.loginHint ?? ''} />;
    case 'forgotSent':
      return (
        <>
          <StepHeader icon={<Mail className="size-5" />} title={t('auth.forgot.title')} />
          <Notice tone="success">{t('auth.forgot.sent', { email: view.email })}</Notice>
          <BackToSignIn setView={setView} />
        </>
      );
    case 'verify':
      return <Verify base={base} email={view.email} onNext={advance} />;
    case 'mfa':
      return <Mfa base={base} onNext={advance} />;
    case 'mfaSetup':
      return <MfaSetup base={base} name={name} onDone={(codes, redirectTo) => setView({ kind: 'recovery', codes, redirectTo })} />;
    case 'recovery':
      return <RecoveryCodes codes={view.codes} onDone={() => (setView({ kind: 'redirecting' }), go(view.redirectTo))} />;
    case 'redirecting':
      return (
        <div className="flex flex-col items-center gap-4 py-16 text-zinc-600" role="status">
          <Spinner className="size-6 text-accent-600" />
          {t('auth.redirecting')}
        </div>
      );
    case 'expired':
      return (
        <>
          <StepHeader title={t('auth.signIn.title')} />
          <ErrorBanner error={new LoginError('session_expired', 410)} />
          <button type="button" onClick={() => history.back()} className="mt-6 text-sm font-medium text-accent-700 hover:underline">
            {t('common.back')}
          </button>
        </>
      );
  }
}

function BackToSignIn({ setView }: { setView(v: View): void }) {
  const t = useT();
  return (
    <LinkButton onClick={() => setView({ kind: 'signIn' })} className="mt-6 inline-flex items-center gap-1.5">
      <ArrowLeft className="size-4 rtl:rotate-180" /> {t('auth.forgot.back')}
    </LinkButton>
  );
}

function SignIn({ base, name, details, onNext, setView }: { base: string; name: string; details: Details; onNext(r: StepResult): void; setView(v: View): void }) {
  const t = useT();
  const [email, setEmail] = useState(details.loginHint ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const { busy, error, run } = useSubmit();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => call<StepResult>(`${base}/login`, { email, password, remember }));
    if (r) onNext(r);
  };
  return (
    <form onSubmit={submit} noValidate>
      <StepHeader title={t('auth.signIn.title')} subtitle={t('auth.signIn.subtitle', { name })} />
      <div className="space-y-5">
        {!!error && <ErrorBanner error={error} />}
        <TextField label={t('auth.signIn.email')} type="email" autoComplete="username" autoFocus={!email} required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        <div>
          <PasswordField label={t('auth.signIn.password')} autoComplete="current-password" autoFocus={!!email} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <LinkButton onClick={() => setView({ kind: 'forgot' })}>{t('auth.signIn.forgot')}</LinkButton>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--brand-600)]" />
          {t('auth.signIn.remember')}
        </label>
        <SubmitButton loading={busy} disabled={!email || !password}>
          {t('auth.signIn.submit')}
        </SubmitButton>
      </div>
      {details.registrationAllowed && (
        <p className="mt-8 border-t border-zinc-200 pt-6 text-sm text-zinc-600">
          {t('auth.signIn.noAccount', { name })} <LinkButton onClick={() => setView({ kind: 'register' })}>{t('auth.signIn.createAccount')}</LinkButton>
        </p>
      )}
    </form>
  );
}

function Register({ base, name, hint, onNext, setView }: { base: string; name: string; hint: string; onNext(r: StepResult): void; setView(v: View): void }) {
  const t = useT();
  const [f, setF] = useState({ givenName: '', familyName: '', email: hint, password: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSubmit();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => call<StepResult>(`${base}/register`, f));
    if (r) onNext(r);
  };
  return (
    <form onSubmit={submit} noValidate>
      <StepHeader title={t('auth.register.title')} subtitle={t('auth.register.subtitle', { name })} />
      <div className="space-y-5">
        {!!error && <ErrorBanner error={error} />}
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('auth.register.givenName')} autoComplete="given-name" autoFocus required value={f.givenName} onChange={set('givenName')} />
          <TextField label={t('auth.register.familyName')} autoComplete="family-name" required value={f.familyName} onChange={set('familyName')} />
        </div>
        <TextField label={t('auth.signIn.email')} type="email" autoComplete="email" required value={f.email} onChange={set('email')} dir="ltr" />
        <div>
          <PasswordField label={t('auth.signIn.password')} autoComplete="new-password" required value={f.password} onChange={set('password')} />
          <StrengthMeter password={f.password} />
        </div>
        <SubmitButton loading={busy} disabled={!f.email || !f.password || !f.givenName}>
          {t('auth.register.submit')}
        </SubmitButton>
      </div>
      <p className="mt-8 border-t border-zinc-200 pt-6 text-sm text-zinc-600">
        {t('auth.register.haveAccount')} <LinkButton onClick={() => setView({ kind: 'signIn' })}>{t('auth.register.signInInstead')}</LinkButton>
      </p>
    </form>
  );
}

function Forgot({ setView, hint }: { setView(v: View): void; hint: string }) {
  const t = useT();
  const [email, setEmail] = useState(hint);
  const { busy, error, run } = useSubmit();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => call('/ui/api/password/forgot', { email }));
    if (r) setView({ kind: 'forgotSent', email });
  };
  return (
    <form onSubmit={submit} noValidate>
      <StepHeader icon={<KeyRound className="size-5" />} title={t('auth.forgot.title')} subtitle={t('auth.forgot.body')} />
      <div className="space-y-5">
        {!!error && <ErrorBanner error={error} />}
        <TextField label={t('auth.signIn.email')} type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        <SubmitButton loading={busy} disabled={!email}>
          {t('auth.forgot.submit')}
        </SubmitButton>
      </div>
      <BackToSignIn setView={setView} />
    </form>
  );
}

function Verify({ base, email, onNext }: { base: string; email: string; onNext(r: StepResult): void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const { busy, error, run } = useSubmit();
  const verify = async (c = code) => {
    const r = await run(() => call<StepResult>(`${base}/verify`, { code: c }));
    if (r) onNext(r);
    else setCode('');
  };
  const resend = async () => {
    setResent(false);
    if (await run(() => call(`${base}/verify/resend`, {}))) setResent(true);
  };
  return (
    <form onSubmit={(e) => (e.preventDefault(), verify())} noValidate>
      <StepHeader icon={<Mail className="size-5" />} title={t('auth.verify.title')} subtitle={t('auth.verify.body', { email })} />
      <div className="space-y-5">
        {!!error && <ErrorBanner error={error} />}
        {resent && <Notice tone="success">{t('auth.verify.resent')}</Notice>}
        <CodeField label={t('auth.verify.code')} value={code} onChange={setCode} onComplete={(c) => void verify(c)} />
        <SubmitButton loading={busy} disabled={code.length !== 6}>
          {t('auth.verify.submit')}
        </SubmitButton>
        <LinkButton onClick={() => void resend()}>{t('auth.verify.resend')}</LinkButton>
      </div>
    </form>
  );
}

function Mfa({ base, onNext }: { base: string; onNext(r: StepResult): void }) {
  const t = useT();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const verify = async (c = code) => {
    const r = await run(() => call<StepResult>(`${base}/mfa`, recovery ? { recoveryCode: c } : { code: c }));
    if (r) onNext(r);
    else setCode('');
  };
  return (
    <form onSubmit={(e) => (e.preventDefault(), verify())} noValidate>
      <StepHeader icon={<Smartphone className="size-5" />} title={t('auth.mfa.title')} subtitle={recovery ? undefined : t('auth.mfa.body')} />
      <div className="space-y-5">
        {!!error && <ErrorBanner error={error} />}
        {recovery ? (
          <TextField label={t('auth.mfa.recoveryCode')} autoFocus autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" className="[&_input]:font-mono [&_input]:tracking-wider" />
        ) : (
          <CodeField label={t('auth.mfa.code')} value={code} onChange={setCode} onComplete={(c) => void verify(c)} />
        )}
        <SubmitButton loading={busy} disabled={recovery ? code.length < 8 : code.length !== 6}>
          {t('auth.mfa.submit')}
        </SubmitButton>
        <LinkButton
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
            setError(null);
          }}
        >
          {recovery ? t('auth.mfa.useApp') : t('auth.mfa.useRecovery')}
        </LinkButton>
      </div>
    </form>
  );
}

/** Authenticator enrolment: QR + manual key, then a code to prove it works. */
export function TotpEnrol({ start, confirm, intro }: { start(): Promise<TotpSetup>; confirm(code: string): Promise<void>; intro?: string }) {
  const t = useT();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run(start).then((s) => s && setSetup(s));
  }, []);
  const submit = async (c = code) => {
    if ((await run(() => confirm(c).then(() => true))) !== true) setCode('');
  };
  if (!setup)
    return error ? (
      <ErrorBanner error={error} />
    ) : (
      <div className="flex justify-center py-10">
        <Spinner className="size-6 text-accent-600" />
      </div>
    );
  return (
    <form onSubmit={(e) => (e.preventDefault(), submit())} noValidate className="space-y-5">
      {intro && <Notice>{intro}</Notice>}
      {!!error && <ErrorBanner error={error} />}
      <ol className="space-y-5 text-sm text-zinc-700">
        <li>
          <p>{t('auth.mfaSetup.scan')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <img src={setup.qr} alt="" width={168} height={168} className="border border-zinc-200 bg-white p-1.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-500">{t('auth.mfaSetup.manual')}</p>
              <code dir="ltr" className="mt-1.5 block font-mono text-[13px] leading-6 break-all text-ink select-all">
                {setup.secret.match(/.{1,4}/g)?.join(' ')}
              </code>
            </div>
          </div>
        </li>
        <li>{t('auth.mfaSetup.enter')}</li>
      </ol>
      <CodeField label={t('auth.mfa.code')} value={code} onChange={setCode} onComplete={(c) => void submit(c)} autoFocus={false} />
      <SubmitButton loading={busy} disabled={code.length !== 6}>
        {t('auth.mfaSetup.submit')}
      </SubmitButton>
    </form>
  );
}

function MfaSetup({ base, name, onDone }: { base: string; name: string; onDone(codes: string[], redirectTo: string): void }) {
  const t = useT();
  return (
    <>
      <StepHeader icon={<ShieldCheck className="size-5" />} title={t('auth.mfaSetup.title')} />
      <TotpEnrol
        intro={t('auth.mfaSetup.required', { name })}
        start={() => call<TotpSetup>(`${base}/mfa-setup/start`, {})}
        confirm={async (code) => {
          const r = await call<{ recoveryCodes: string[]; redirectTo: string }>(`${base}/mfa-setup/confirm`, { code });
          onDone(r.recoveryCodes, r.redirectTo);
        }}
      />
    </>
  );
}

/** Shows one-time recovery codes; continuing requires confirming they were saved. */
export function RecoveryCodes({ codes, onDone, doneLabel }: { codes: string[]; onDone(): void; doneLabel?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  const copy = async () => {
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    a.download = 'grids-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <StepHeader icon={<KeyRound className="size-5" />} title={t('auth.recovery.title')} subtitle={t('auth.recovery.body')} />
      <ul dir="ltr" className="grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200" aria-label={t('auth.recovery.title')}>
        {codes.map((c) => (
          <li key={c} className="bg-zinc-50 px-3 py-2.5 text-center font-mono text-sm tracking-wider text-ink">
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => void copy()} className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm text-ink hover:border-zinc-600">
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          {copied ? t('auth.recovery.copied') : t('auth.recovery.copy')}
        </button>
        <button type="button" onClick={download} className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm text-ink hover:border-zinc-600">
          <Download className="size-4" /> {t('auth.recovery.download')}
        </button>
      </div>
      <label className="mt-6 flex cursor-pointer items-center gap-2.5 text-sm text-zinc-700">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-[var(--brand-600)]" />
        {t('auth.recovery.confirm')}
      </label>
      <form onSubmit={(e) => (e.preventDefault(), onDone())} className="mt-5">
        <SubmitButton disabled={!saved}>{doneLabel ?? t('common.continue')}</SubmitButton>
      </form>
    </div>
  );
}

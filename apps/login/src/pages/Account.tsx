import { cx, Spinner } from '@grids/ui';
import { KeyRound, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { call, LoginError, type TotpSetup } from '../api';
import { I18nProvider, useT } from '../i18n';
import { Shell } from '../Shell';
import { ErrorBanner, Notice, PasswordField, StepHeader, StrengthMeter, SubmitButton } from '../widgets';
import { RecoveryCodes, TotpEnrol } from './Interaction';

interface Account {
  email: string;
  givenName: string | null;
  familyName: string | null;
  locale: string | null;
  mfa: { enabled: boolean; recoveryCodesLeft: number };
  mfaRequired: boolean;
}

/** Only links back to http(s) pages; anything else is ignored. */
const returnTo = (() => {
  const v = new URLSearchParams(location.search).get('return_to');
  try {
    return v && /^https?:$/.test(new URL(v).protocol) ? v : null;
  } catch {
    return null;
  }
})();

/** /ui/account — password and two-step settings for the signed-in person. */
export function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => call<Account>('/ui/api/account').then(setAccount, setError);
  useEffect(() => void load(), []);
  return (
    <I18nProvider hint={account?.locale}>
      <Shell org={null}>
        {error ? <SignedOut error={error} /> : !account ? <div className="flex justify-center py-16"><Spinner className="size-6 text-accent-600" /></div> : <Settings account={account} reload={load} />}
      </Shell>
    </I18nProvider>
  );
}

function SignedOut({ error }: { error: unknown }) {
  const t = useT();
  return (
    <>
      <StepHeader title={t('auth.account.title')} />
      {error instanceof LoginError && error.status === 401 ? <Notice>{t('auth.account.signedOut')}</Notice> : <ErrorBanner error={error} />}
      {returnTo && <ReturnLink />}
    </>
  );
}

function ReturnLink() {
  const t = useT();
  return (
    <a href={returnTo!} className="mt-6 inline-block text-sm font-medium text-accent-700 hover:underline">
      {t('auth.account.returnToApp')}
    </a>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-zinc-200 py-6">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-ink">
        <span className="text-accent-700">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Settings({ account, reload }: { account: Account; reload(): void }) {
  const t = useT();
  const name = [account.givenName, account.familyName].filter(Boolean).join(' ');
  return (
    <div>
      <StepHeader title={t('auth.account.title')} />
      <Section icon={<UserRound className="size-4" />} title={t('auth.account.profile')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-zinc-500">{t('auth.account.name')}</dt>
          <dd className="text-ink">{name || '—'}</dd>
          <dt className="text-zinc-500">{t('auth.account.email')}</dt>
          <dd className="break-all text-ink" dir="ltr">
            {account.email}
          </dd>
        </dl>
      </Section>
      <Section icon={<LockKeyhole className="size-4" />} title={t('auth.account.changePassword')}>
        <ChangePassword email={account.email} />
      </Section>
      <Section icon={<ShieldCheck className="size-4" />} title={t('auth.account.twoStep')}>
        <TwoStep account={account} reload={reload} />
      </Section>
      {returnTo && <ReturnLink />}
    </div>
  );
}

function ChangePassword({ email }: { email: string }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await call('/ui/api/account/password', { current, next });
      setDone(true);
      setCurrent('');
      setNext('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {!!error && <ErrorBanner error={error} />}
      {done && <Notice tone="success">{t('auth.account.passwordChanged')}</Notice>}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <PasswordField label={t('auth.account.currentPassword')} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <div>
        <PasswordField label={t('auth.reset.newPassword')} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <StrengthMeter password={next} />
      </div>
      <SubmitButton loading={busy} disabled={!current || !next}>
        {t('auth.reset.submit')}
      </SubmitButton>
    </form>
  );
}

function TwoStep({ account, reload }: { account: Account; reload(): void }) {
  const t = useT();
  const [mode, setMode] = useState<'idle' | 'enrol' | { codes: string[] }>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (typeof mode === 'object')
    return <RecoveryCodes codes={mode.codes} onDone={() => (setMode('idle'), reload())} doneLabel={t('common.close')} />;
  if (mode === 'enrol')
    return (
      <TotpEnrol
        start={() => call<TotpSetup>('/ui/api/account/mfa/start', {})}
        confirm={async (code) => setMode({ codes: (await call<{ recoveryCodes: string[] }>('/ui/api/account/mfa/confirm', { code })).recoveryCodes })}
      />
    );

  const on = account.mfa.enabled;
  return (
    <div className="space-y-4">
      {!!error && <ErrorBanner error={error} />}
      <div className="flex items-start gap-3">
        <span className={cx('mt-1 size-2.5 shrink-0', on ? 'bg-emerald-500' : 'bg-zinc-400')} aria-hidden />
        <div className="text-sm">
          <p className="text-ink">{on ? t('auth.account.twoStepOn') : t('auth.account.twoStepOff')}</p>
          {account.mfaRequired && <p className="mt-1 text-xs font-medium text-accent-700">{t('auth.account.requiredByOrg')}</p>}
          {on && <p className="mt-1 text-xs text-zinc-500">{t('auth.account.recoveryLeft', { count: account.mfa.recoveryCodesLeft })}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!on && (
          <button type="button" onClick={() => setMode('enrol')} className="inline-flex h-9 items-center gap-2 bg-accent-600 px-3.5 text-sm font-medium text-on-accent hover:bg-accent-700">
            <ShieldCheck className="size-4" /> {t('auth.account.enable')}
          </button>
        )}
        {on && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(async () => setMode({ codes: (await call<{ recoveryCodes: string[] }>('/ui/api/account/recovery-codes', {})).recoveryCodes }))}
            className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3.5 text-sm text-ink hover:border-zinc-600"
          >
            <KeyRound className="size-4" /> {t('auth.account.newRecoveryCodes')}
          </button>
        )}
        {on && !account.mfaRequired && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(async () => (await call('/ui/api/account/mfa', undefined, 'DELETE'), reload()))}
            className="inline-flex h-9 items-center gap-2 border border-red-300 bg-snow px-3.5 text-sm text-red-700 hover:border-red-600 hover:bg-red-600 hover:text-white"
          >
            {t('auth.account.disable')}
          </button>
        )}
      </div>
    </div>
  );
}

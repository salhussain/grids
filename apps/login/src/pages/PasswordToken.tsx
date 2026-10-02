import { Spinner } from '@grids/ui';
import { CircleCheck, KeyRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { call, LoginError } from '../api';
import { I18nProvider, useT } from '../i18n';
import { Shell } from '../Shell';
import { ErrorBanner, Notice, PasswordField, StepHeader, StrengthMeter, SubmitButton } from '../widgets';

interface TokenInfo {
  kind: 'reset' | 'setup';
  email: string;
  locale: string | null;
  appUrl: string;
}

/** /ui/reset/:token and /ui/setup/:token — choose a password from an emailed link. */
export function PasswordTokenPage({ token }: { token: string }) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    call<TokenInfo>(`/ui/api/password/check/${encodeURIComponent(token)}`).then(setInfo, setError);
  }, [token]);
  return (
    <I18nProvider hint={info?.locale}>
      <Shell org={null}>
        {error ? (
          <InvalidLink error={error} />
        ) : !info ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6 text-accent-600" />
          </div>
        ) : (
          <ChoosePassword token={token} info={info} />
        )}
      </Shell>
    </I18nProvider>
  );
}

function InvalidLink({ error }: { error: unknown }) {
  const t = useT();
  return (
    <>
      <StepHeader icon={<KeyRound className="size-5" />} title={t('auth.reset.title')} />
      <ErrorBanner error={error instanceof LoginError && error.status === 404 ? new LoginError('invalid_link', 404) : error} />
    </>
  );
}

function ChoosePassword({ token, info }: { token: string; info: TokenInfo }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const mismatch = touched && confirm.length > 0 && confirm !== password;
  const setup = info.kind === 'setup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await call('/ui/api/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <>
        <StepHeader icon={<CircleCheck className="size-5" />} title={setup ? t('auth.reset.setupTitle') : t('auth.reset.title')} />
        <Notice tone="success">{t('auth.reset.done')}</Notice>
        <a href={info.appUrl} className="mt-6 inline-flex h-11 w-full items-center justify-center bg-accent-600 px-4 text-[15px] font-medium text-on-accent hover:bg-accent-700">
          {t('auth.reset.signIn')}
        </a>
      </>
    );

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader
        icon={<KeyRound className="size-5" />}
        title={setup ? t('auth.reset.setupTitle') : t('auth.reset.title')}
        subtitle={setup ? t('auth.reset.setupBody') : <span dir="ltr">{info.email}</span>}
      />
      <div className="space-y-5">
        {!!error && <ErrorBanner error={error} />}
        {/* Lets password managers save the new credential against the right account. */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <div>
          <PasswordField label={t('auth.reset.newPassword')} autoComplete="new-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
          <StrengthMeter password={password} />
        </div>
        <PasswordField
          label={t('auth.reset.confirmPassword')}
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={() => setTouched(true)}
          error={mismatch ? t('auth.reset.mismatch') : null}
        />
        <SubmitButton loading={busy} disabled={!password || !confirm}>
          {t('auth.reset.submit')}
        </SubmitButton>
      </div>
    </form>
  );
}

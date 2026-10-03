import { cx, Spinner } from '@grids/ui';
import { AlertCircle, Check, Eye, EyeOff, Info } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { LoginError } from './api';
import { useT } from './i18n';

const inputCls =
  'h-11 w-full border border-zinc-300 bg-snow px-3 text-[15px] text-ink placeholder:text-zinc-400 transition-colors hover:border-zinc-500 focus:border-accent-600 focus:outline-2 focus:-outline-offset-2 focus:outline-accent-600 aria-[invalid=true]:border-red-600';

/** Labelled input with an optional note. */
export function TextField({
  label,
  note,
  error,
  trailing,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; note?: ReactNode; error?: string | null; trailing?: ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-zinc-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          aria-invalid={!!error || undefined}
          aria-describedby={note || error ? `${id}-note` : undefined}
          className={cx(inputCls, !!trailing && 'pe-11')}
          {...props}
        />
        {trailing && <div className="absolute inset-y-0 end-0 flex items-center">{trailing}</div>}
      </div>
      {(error || note) && (
        <div id={`${id}-note`} className={cx('mt-1.5 text-xs', error ? 'text-red-700' : 'text-zinc-500')}>
          {error ?? note}
        </div>
      )}
    </div>
  );
}

/** Password input with show/hide and a Caps Lock warning. */
export function PasswordField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; note?: ReactNode; error?: string | null }) {
  const t = useT();
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);
  return (
    <TextField
      {...props}
      type={show ? 'text' : 'password'}
      onKeyDown={onKey}
      onKeyUp={onKey}
      note={caps ? <span className="text-amber-700">{t('auth.signIn.capsLock')}</span> : props.note}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="flex size-11 items-center justify-center text-zinc-500 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600"
          aria-label={show ? t('auth.signIn.hidePassword') : t('auth.signIn.showPassword')}
          aria-pressed={show}
        >
          {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      }
    />
  );
}

/** One-time code input: digits only, autofill from SMS/OS, submits when complete. */
export function CodeField({
  label,
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus = true,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  onComplete?(v: string): void;
  length?: number;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-zinc-700">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={length}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, length);
          onChange(v);
          if (v.length === length) onComplete?.(v);
        }}
        dir="ltr"
        className={cx(inputCls, 'h-14 text-center font-mono text-2xl tracking-[0.5em]')}
        placeholder={'·'.repeat(length)}
      />
    </div>
  );
}

export function SubmitButton({ loading, children, disabled }: { loading?: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="relative inline-flex h-11 w-full items-center justify-center gap-2 bg-accent-600 px-4 text-[15px] font-medium text-on-accent transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function LinkButton({ onClick, children, className }: { onClick(): void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('text-sm font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-accent-600', className)}>
      {children}
    </button>
  );
}

/** Translated error banner for a failed request. */
export function ErrorBanner({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const e = error instanceof LoginError ? error : new LoginError('generic', 0);
  const key = `auth.errors.${e.code}`;
  const msg = t(key, e.vars);
  return (
    <div role="alert" className="flex gap-2.5 border-s-4 border-red-600 bg-red-50 px-3.5 py-3 text-sm text-red-800">
      <AlertCircle className="mt-px size-4 shrink-0" />
      <span>{msg === key ? t('auth.errors.generic') : msg}</span>
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' }) {
  const Icon = tone === 'success' ? Check : Info;
  return (
    <div role="status" className="flex gap-2.5 border-s-4 border-accent-600 bg-accent-50 px-3.5 py-3 text-sm text-accent-800">
      <Icon className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Heading block for each step. */
export function StepHeader({ title, subtitle, icon }: { title: string; subtitle?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-7">
      {icon && <div className="mb-5 flex size-11 items-center justify-center bg-accent-50 text-accent-700">{icon}</div>}
      <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] text-zinc-600">{subtitle}</p>}
    </div>
  );
}

/** 0–4 strength score: length dominates, character variety adds a little. */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((r) => r.test(pw)).length;
  let s = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (variety >= 3) s++;
  if (/^(.)\1+$/.test(pw) || /^(?:1234|password|qwerty)/i.test(pw)) s = Math.min(s, 1);
  return Math.min(4, Math.max(pw.length >= 6 ? 1 : 0, s));
}

export function StrengthMeter({ password }: { password: string }) {
  const t = useT();
  const score = passwordScore(password);
  const labels = ['', t('auth.strength.weak'), t('auth.strength.fair'), t('auth.strength.good'), t('auth.strength.strong')];
  const tone = ['bg-zinc-200', 'bg-red-600', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'][score];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" role="meter" aria-label={t('auth.strength.label')} aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} aria-valuetext={labels[score] || undefined}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cx('h-1 flex-1 transition-colors', i <= score ? tone : 'bg-zinc-200')} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-xs text-zinc-500">
        <span>{t('auth.strength.hint')}</span>
        {score > 0 && <span className="shrink-0 font-medium text-zinc-700">{labels[score]}</span>}
      </div>
    </div>
  );
}

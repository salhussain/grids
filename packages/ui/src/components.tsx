import { AlertTriangle, Check, Copy, Loader2, X } from 'lucide-react';
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from './http';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent-600 text-white border border-accent-700/40 shadow-[0_1px_2px_rgb(16_24_40/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] hover:bg-accent-700',
  secondary:
    'bg-snow text-ink border border-zinc-300 shadow-[0_1px_2px_rgb(16_24_40/0.05)] hover:bg-zinc-50 hover:border-zinc-400',
  ghost: 'text-zinc-700 border border-transparent hover:bg-zinc-200/60',
  danger:
    'bg-snow text-red-700 border border-red-300 shadow-[0_1px_2px_rgb(16_24_40/0.05)] hover:bg-red-600 hover:text-white hover:border-red-600',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color] active:translate-y-px',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-45',
        size === 'md' ? 'h-9 px-3.5 text-sm' : 'h-7 rounded-md px-2.5 text-xs',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        Icon && <Icon className={size === 'md' ? 'size-4' : 'size-3.5'} />
      )}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- form controls

const control =
  'block rounded-lg border border-zinc-300 bg-snow px-3 text-sm text-ink placeholder:text-zinc-400 transition-shadow hover:border-zinc-400 focus:border-accent-600 focus:outline-none focus:ring-4 focus:ring-accent-600/15 disabled:bg-zinc-100 disabled:text-zinc-500';

/** Full width unless the caller sets an explicit width (`w-*`): utilities can't override each other reliably. */
const width = (className?: string) =>
  className && /(^|\s)(\w+:)?w-/.test(className) ? '' : 'w-full';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, width(className), 'h-9', className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={cx(control, width(className), 'min-h-24 py-2', className)} />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(control, width(className), 'h-9 pe-8', className)}>
      {children}
    </select>
  );
}

/**
 * Labelled form control. The label is associated by id (not by wrapping), so the
 * control's accessible name is exactly the label: a wrapping label would also
 * include e.g. every <option> of a select. Hints/errors are wired via aria-describedby.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cx('block', className)}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-zinc-700">
        {label}
        {required && (
          <span className="text-accent-600" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {cloneElement(children, {
        id,
        ...(note ? { 'aria-describedby': noteId } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {note && (
        <span
          id={noteId}
          className={cx('mt-1 block text-xs', error ? 'text-red-700' : 'text-zinc-500')}
        >
          {note}
        </span>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  description,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 size-4 shrink-0 appearance-none border border-zinc-400 bg-snow checked:border-accent-600 checked:bg-accent-600 checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><path d=%22M3.5 8.5l3 3 6-7%22 stroke=%22white%22 stroke-width=%222%22 fill=%22none%22/></svg>')] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
      />
      <span>
        <span className="text-ink">{label}</span>
        {description && <span className="block text-xs text-zinc-500">{description}</span>}
      </span>
    </label>
  );
}

/** A switch with a visible label (and optional description) beside it. */
export function SwitchField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
      <div className="text-sm leading-tight">
        <div className="text-ink">{label}</div>
        {description && <div className="mt-0.5 text-xs text-zinc-500">{description}</div>}
      </div>
    </div>
  );
}

/** On/off switch (square track and thumb). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-accent-600 bg-accent-600' : 'border-zinc-300 bg-zinc-200',
      )}
    >
      <span
        className={cx(
          'block size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(16_24_40/0.25)] transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------- layout

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No body padding (tables). */
  flush?: boolean;
}) {
  return (
    <section className={cx('overflow-hidden rounded-xl border border-zinc-200 bg-snow', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 text-xs font-medium tracking-[0.12em] text-zinc-500 uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {meta && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'warn' | 'bad';
}) {
  return (
    <div className="border border-zinc-200 bg-snow px-5 py-4">
      <div className="text-[13px] font-medium text-zinc-500">{label}</div>
      <div
        className={cx(
          'num mt-2 text-[26px] font-semibold tracking-[-0.02em]',
          tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

/** Label/value list; splits into two columns only when its container is wide. */
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="@container">
      <dl className="grid grid-cols-1 gap-x-8 @xl:grid-cols-2">
        {items.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-2.5 text-sm last:border-0 @xl:[&:nth-last-child(2)]:border-0"
          >
            <dt className="shrink-0 text-zinc-500">{k}</dt>
            <dd className="min-w-0 truncate text-right text-ink">
              {v ?? <span className="text-zinc-400">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="mb-6 flex overflow-x-auto border-b border-zinc-300">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px flex shrink-0 items-center gap-2 rounded-none border-b-2 px-4 py-2.5 text-sm transition-colors',
            value === t.id
              ? 'border-accent-600 font-medium text-ink'
              : 'border-transparent text-zinc-600 hover:border-zinc-400 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="num rounded-full bg-zinc-200 px-1.5 text-xs text-zinc-700">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tables

export function Table({
  head,
  children,
  empty,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : !!children;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-start text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-semibold tracking-[0.06em] text-zinc-500 uppercase">
            {head.map((h, i) => (
              <th
                key={i}
                className="px-4 py-2.5 font-medium whitespace-nowrap first:ps-5 last:pe-5"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 [&>tr]:transition-colors [&>tr:hover]:bg-zinc-50/80">{children}</tbody>
      </table>
      {!hasRows && empty && (
        <div className="px-5 py-12 text-center text-sm text-zinc-500">{empty}</div>
      )}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('px-4 py-3 align-middle first:ps-5 last:pe-5', className)}>{children}</td>
);

// ---------------------------------------------------------------- status

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';
const TONES: Record<Tone, string> = {
  good: 'text-emerald-800 bg-emerald-50 border-emerald-300 [--dot:#198038]',
  warn: 'text-amber-900 bg-amber-50 border-amber-300 [--dot:#b28600]',
  bad: 'text-red-800 bg-red-50 border-red-300 [--dot:#da1e28]',
  info: 'text-sky-900 bg-sky-50 border-sky-300 [--dot:#0072c3]',
  accent: 'text-accent-800 bg-accent-50 border-accent-100 [--dot:#0f62fe]',
  neutral: 'text-zinc-700 bg-zinc-100 border-zinc-300 [--dot:#6f6f6f]',
};

const STATUS_TONE: Record<string, Tone> = {
  active: 'good',
  paid: 'good',
  verified: 'good',
  sent: 'good',
  resolved: 'good',
  trialing: 'info',
  pending: 'info',
  open: 'info',
  provisioning: 'warn',
  pending_payment: 'warn',
  past_due: 'bad',
  overdue: 'bad',
  failed: 'bad',
  suspended: 'bad',
  urgent: 'bad',
  high: 'warn',
  cancelled: 'neutral',
  closed: 'neutral',
  void: 'neutral',
  expired: 'neutral',
  revoked: 'neutral',
  low: 'neutral',
  normal: 'neutral',
};

/** Status label with a square marker: never colour alone. */
export function Status({ value, tone, label }: { value: string; tone?: Tone; label?: string }) {
  const t = tone ?? STATUS_TONE[value] ?? 'neutral';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize',
        TONES[t],
      )}
    >
      <span className="size-1.5 rounded-full bg-[var(--dot)]" />
      {label ?? value.replace(/_/g, ' ')}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-zinc-700 shadow-none">
      {children}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[13px]', className)}>{children}</span>;
}

// ---------------------------------------------------------------- feedback

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-accent-600', className)} aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="flex justify-center py-20">
      <Spinner />
    </div>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const p = error instanceof ApiError ? error.problem : null;
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{p?.title ?? 'Something went wrong'}</p>
        {(p?.detail ?? (error instanceof Error && !p ? error.message : null)) && (
          <p className="mt-0.5">{p?.detail ?? (error as Error).message}</p>
        )}
        {p?.errors?.map((e) => (
          <p key={e.path} className="mt-0.5 text-xs">
            <Mono>{e.path.replace(/^\//, '')}</Mono> — {e.message}
          </p>
        ))}
      </div>
    </div>
  );
}

export function Callout({
  tone = 'info',
  icon: Icon,
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn';
  icon?: React.ComponentType<{ className?: string }>;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex flex-col gap-3 rounded-xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
        tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-accent-100 bg-accent-50',
      )}
    >
      <div className="flex gap-3">
        {Icon && (
          <Icon
            className={cx(
              'mt-0.5 size-5 shrink-0',
              tone === 'warn' ? 'text-amber-700' : 'text-accent-700',
            )}
          />
        )}
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          {children && <div className="mt-0.5 text-sm text-zinc-700">{children}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-50 ring-1 ring-accent-100">
        <Icon className="size-5 text-accent-600" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-zinc-500">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CopyField({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={cx(control, 'h-9 w-full rounded-e-none border-r-0 font-mono text-xs')}
      />
      <Button
        variant="secondary"
        className="rounded-s-none"
        icon={copied ? Check : Copy}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : label}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- dialog

/** Modal built on native <dialog>: focus trapping, Esc to close, backdrop. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  closeLabel = 'Close',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Accessible name of the close (×) button, for translated UIs. */
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'm-auto max-h-[90vh] w-[calc(100%-2rem)] rounded-2xl border border-zinc-200 bg-snow p-0 text-ink shadow-[var(--shadow-raised)]',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label={closeLabel}
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-zinc-50/70 px-6 py-3.5">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- toasts

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed end-4 bottom-4 z-50 flex flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="chrome flex items-center gap-2.5 rounded-xl bg-chrome px-4 py-3 text-sm text-white shadow-[var(--shadow-raised)] ring-1 ring-white/10"
          >
            <Check className="size-4 text-emerald-400" />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

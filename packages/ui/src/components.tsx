import { AlertTriangle, Check, Copy, Loader2, Save, X } from 'lucide-react';
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  createContext,
  forwardRef,
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
    'bg-[#7a1f24] text-white border border-[#5c1519] shadow-[0_1px_2px_rgb(16_24_40/0.12),inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-[#641a1e]',
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

type IconType = React.ComponentType<{ className?: string }>;

/** A control with an icon at its start. */
function WithIcon({
  icon: Icon,
  className,
  top,
  children,
}: {
  icon: IconType;
  className?: string;
  top?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx('relative', width(className), className?.match(/(^|\s)(\w+:)?w-\S+/)?.[0])}>
      <Icon
        className={cx(
          'pointer-events-none absolute start-3 size-4 text-zinc-400',
          top ? 'top-3' : 'top-1/2 -translate-y-1/2',
        )}
      />
      {children}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: IconType }
>(function Input({ className, icon, ...props }, ref) {
  const input = (
    <input
      {...props}
      ref={ref}
      className={cx(control, icon ? 'w-full ps-9' : width(className), 'h-9', !icon && className)}
    />
  );
  return icon ? (
    <WithIcon icon={icon} className={className}>
      {input}
    </WithIcon>
  ) : (
    input
  );
});

export function Textarea({
  className,
  icon,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { icon?: IconType }) {
  const area = (
    <textarea
      {...props}
      className={cx(
        control,
        icon ? 'w-full ps-9' : width(className),
        'min-h-24 py-2',
        !icon && className,
      )}
    />
  );
  return icon ? (
    <WithIcon icon={icon} className={className} top>
      {area}
    </WithIcon>
  ) : (
    area
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
  intro,
  error,
  required,
  className,
  row,
  children,
}: {
  /** Label and help on the left, the control on the right. */
  row?: boolean;
  label: string;
  hint?: ReactNode;
  /** Help text between the label and the control, rather than under it. */
  intro?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  if (row)
    return (
      <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
        <div className="min-w-40 flex-1 text-sm leading-tight">
          <label htmlFor={id} className="block font-medium text-ink">
            {label}
          </label>
          {(intro || note) && (
            <span
              id={noteId}
              className={cx('mt-0.5 block text-xs', error ? 'text-red-700' : 'text-zinc-500')}
            >
              {intro}
              {intro && note ? ' · ' : ''}
              {note}
            </span>
          )}
        </div>
        <div className="w-full shrink-0 sm:w-56">
          {cloneElement(children, {
            id,
            ...(note ? { 'aria-describedby': noteId } : {}),
            ...(error ? { 'aria-invalid': true } : {}),
          })}
        </div>
      </div>
    );
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
      {intro && <span className="-mt-1 mb-1.5 block text-xs text-zinc-500">{intro}</span>}
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
        'relative inline-flex h-6 w-11 shrink-0 items-center border transition-colors disabled:opacity-50',
        checked ? 'border-accent-600 bg-accent-600' : 'border-zinc-300 bg-zinc-200',
      )}
    >
      <span
        className={cx(
          'block size-[18px] bg-white shadow-[0_1px_3px_rgb(16_24_40/0.25)] transition-transform',
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
  divided,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A line under the header, as on a project's page. */
  divided?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between',
        divided ? 'mb-6 border-b border-zinc-300 pb-4' : 'mb-8',
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 font-mono text-[11px] tracking-[0.1em] text-zinc-500 uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h1>
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

/**
 * Heading for a page inside a larger page (a project's menu items): the same title,
 * one-line description and actions at the right on every one of them.
 */
export function SectionHead({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-zinc-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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
    <div className="rounded-lg border border-zinc-200 bg-snow px-5 py-4">
      <div className="font-mono text-[11px] tracking-[0.08em] text-zinc-500 uppercase">{label}</div>
      <div
        className={cx(
          'num mt-2 font-mono text-[26px] font-medium tracking-[-0.03em]',
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
  tabs: {
    id: T;
    label: string;
    count?: number;
    icon?: React.ComponentType<{ className?: string }>;
  }[];
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
          {t.icon && <t.icon className="size-4" aria-hidden />}
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="num rounded-full bg-zinc-200 px-1.5 text-xs text-zinc-700">
              {t.count}
            </span>
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
  tintEmpty,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: ReactNode;
  /** Fill the empty message with the accent tint (for a table inside a titled panel). */
  tintEmpty?: boolean;
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
                className="px-4 py-2.5 text-start font-medium whitespace-nowrap first:ps-5 last:pe-5"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 [&>tr]:transition-colors [&>tr:hover]:bg-zinc-50/80">
          {children}
        </tbody>
      </table>
      {!hasRows && empty && (
        <div
          className={cx(
            'text-center text-sm text-zinc-500',
            tintEmpty ? 'border-t border-accent-100 bg-accent-50' : 'px-5 py-12',
          )}
        >
          {empty}
        </div>
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
  good: 'text-emerald-800 bg-emerald-50',
  warn: 'text-amber-900 bg-amber-50',
  bad: 'text-red-800 bg-red-50',
  info: 'text-sky-900 bg-sky-50',
  accent: 'text-accent-800 bg-accent-50',
  neutral: 'text-zinc-700 bg-zinc-100',
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
export function Status({
  value,
  tone,
  label,
  color,
}: {
  value: string;
  tone?: Tone;
  label?: string;
  /** Any CSS colour (a #rrggbb or a variable), instead of a tone. */ color?: string | null;
}) {
  const t = tone ?? STATUS_TONE[value] ?? 'neutral';
  const own = color && /^(#[0-9a-f]{6}|var\(--[a-z0-9-]+\))$/i.test(color) ? color : null;
  return (
    <span
      className={cx(
        'inline-flex items-center px-2.5 py-0.5 text-xs font-medium whitespace-nowrap capitalize',
        own ? 'text-ink' : TONES[t],
      )}
      style={
        own
          ? ({
              background: `color-mix(in srgb, ${own} 14%, white)`,
              color: `color-mix(in srgb, ${own} 75%, black)`,
            } as React.CSSProperties)
          : undefined
      }
    >
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

/** Spinner that only appears if loading takes a moment, so fast loads don't flash. */
export function Loading() {
  return (
    <div className="loading-delay flex justify-center py-20">
      <Spinner />
    </div>
  );
}

/**
 * The error shown above a form or table. When a new one appears it scrolls into view (the dialog
 * or page may be scrolled down) and a toast repeats it, so it is not missed.
 */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <Notice error={error} />;
}

function Notice({ error }: { error: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const p = error instanceof ApiError ? error.problem : null;
  const detail = p?.detail ?? (error instanceof Error && !p ? error.message : null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast([p?.title ?? 'Something went wrong', detail].filter(Boolean).join(': '));
    // Once for each new error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  return (
    <div
      ref={ref}
      role="alert"
      className="mb-4 flex scroll-mt-20 gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{p?.title ?? 'Something went wrong'}</p>
        {detail && <p className="mt-0.5">{detail}</p>}
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
      <Icon className="mb-3 size-7 text-accent-600" />
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-zinc-500">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** An empty page or section: the message on the accent tint, with an optional action. */
export function EmptyState(props: React.ComponentProps<typeof Empty>) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-snow">
      <Empty {...props} />
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
  tone,
  headerActions,
  closeLabel = 'Close',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean | 'full';
  /** `danger`: the top edge takes the delete button's red instead of the accent. */
  tone?: 'danger';
  /** Buttons or tags in the header, before the close button. */
  headerActions?: ReactNode;
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
      // React passes a dialog's close up to the dialogs around it; a nested one must only close itself.
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'm-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border-0 border-t-4 border-solid bg-snow p-0 text-ink shadow-[var(--shadow-raised)]',
        wide === 'full' ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-lg',
        tone === 'danger' ? 'border-t-[#7a1f24]' : 'border-t-accent-600',
      )}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              <button
                onClick={onClose}
                aria-label={closeLabel}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-zinc-50/70 px-6 py-3.5">
              {withFooterIcons(footer)}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Footer buttons get a default icon so every dialog reads the same: a cross on the dismiss button,
 *  a disk on a "Save…" action and a tick on any other confirming one. Buttons that bring their own icon are left alone. */
function withFooterIcons(footer: ReactNode): ReactNode {
  const flat = (n: ReactNode): ReactNode[] =>
    Children.toArray(n).flatMap((c) =>
      isValidElement<{ children?: ReactNode }>(c) && c.type === Fragment
        ? flat(c.props.children)
        : [c],
    );
  const items = flat(footer);
  const confirms = items.some(
    (n) =>
      isValidElement<{ variant?: Variant; icon?: unknown }>(n) &&
      n.type === Button &&
      (n.props.variant ?? 'primary') === 'primary',
  );
  return items.map((n) => {
    if (
      !isValidElement<{ variant?: Variant; icon?: unknown; children?: ReactNode }>(n) ||
      n.type !== Button ||
      n.props.icon
    )
      return n;
    const v = n.props.variant ?? 'primary';
    if (v === 'primary')
      return cloneElement(n, {
        icon:
          typeof n.props.children === 'string' && /^save/i.test(n.props.children) ? Save : Check,
      });
    if (v === 'secondary' && confirms) return cloneElement(n, { icon: X });
    return n;
  });
}

// ---------------------------------------------------------------- toasts

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    // The same message shown at once (twelve widgets failing the same way) appears once.
    setItems((xs) => (xs.some((x) => x.msg === msg) ? xs : [...xs, { id, msg }]));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
  }, []);
  // A popover sits in the top layer, so toasts show above open dialogs too.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el?.showPopover) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (items.length) el.showPopover();
    } catch {
      /* popover unsupported */
    }
  }, [items]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        ref={box}
        popover="manual"
        aria-live="polite"
        className="pointer-events-none fixed inset-auto end-4 bottom-4 m-0 flex flex-col gap-2 overflow-visible border-0 bg-transparent p-0"
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

/** Settings sections down the left, the selected one's content beside them (along the top on a phone). */
export function VerticalTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  wide,
  children,
}: {
  tabs: { id: T; label: string; icon?: React.ComponentType<{ className?: string }>; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
  /** Content that needs the full width (a form beside its preview). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label={label} className="lg:sticky lg:top-20 lg:self-start">
        <div
          role="tablist"
          aria-orientation="vertical"
          className="flex gap-1 overflow-x-auto pb-2 lg:block lg:overflow-visible lg:pb-0"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={value === t.id}
              onClick={() => onChange(t.id)}
              className={cx(
                'flex w-full shrink-0 items-center gap-2.5 border-s-2 px-2 py-1.5 text-start text-sm whitespace-nowrap transition-colors',
                value === t.id
                  ? 'border-accent-600 bg-accent-50 font-medium text-ink'
                  : 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-ink',
              )}
            >
              {t.icon && <t.icon className="size-4 shrink-0" aria-hidden />}
              <span className="flex-1">{t.label}</span>
              {t.count !== undefined && <span className="num text-xs text-zinc-400">{t.count}</span>}
            </button>
          ))}
        </div>
      </nav>
      <div role="tabpanel" className={cx('min-h-[28rem] min-w-0 space-y-4', !wide && 'max-w-4xl')}>
        {children}
      </div>
    </div>
  );
}

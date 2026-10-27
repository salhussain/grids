import {
  DEFAULT_REPORTING_PERIODS,
  REFRESH_RATES,
  type ExplorerConfig,
  type RefreshConfig,
  type ProjectStatus,
  type ProjectVisibility,
  type ReportingConfig,
  type ReportingPeriod,
} from '@grids/schema';
import {
  confirmDialog,
  Button,
  Dialog,
  Field,
  Input,
  Panel,
  Select,
  Table,
  Td,
  cx,
} from '@grids/ui';
import {
  Calendar,
  CalendarOff,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Globe,
  Hash,
  ImageOff,
  ImagePlus,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  PencilRuler,
  Plus,
  RefreshCw,
  RefreshCwOff,
  Rocket,
  Search,
  Trash2,
  Type,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { contrastOn } from '../../theme';
import { ICONS } from './context';

export const VISIBILITY: Record<
  ProjectVisibility,
  { label: string; text: string; icon: typeof Lock }
> = {
  private: { label: 'Private', text: 'Only project members', icon: Lock },
  organisation: { label: 'Organisation', text: 'Every member can view', icon: Users },
  public: { label: 'Public', text: 'Anyone can view public dashboards', icon: Globe },
};
export const STATUS: Record<ProjectStatus, { label: string; text: string; icon: typeof Lock }> = {
  draft: { label: 'Draft', text: 'Only managers see it while you set it up', icon: PencilRuler },
  live: { label: 'Live', text: 'Visible to everyone it is shared with', icon: Rocket },
};

/** A row of selectable cards (radio group) – clearer than a dropdown for 2–4 choices. */
export function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel,
  intro,
}: {
  label: string;
  value: T;
  onChange(v: T): void;
  options: Record<T, { label: string; text: string; icon: typeof Lock }>;
  hideLabel?: boolean;
  intro?: string;
}) {
  return (
    <fieldset>
      <legend
        className={cx(
          'mb-1.5 text-xs font-medium tracking-wide text-zinc-600',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </legend>
      {intro && <p className="-mt-1 mb-1.5 text-xs text-zinc-500">{intro}</p>}
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-px border border-zinc-300 bg-zinc-300 sm:auto-cols-fr sm:grid-flow-col"
      >
        {(Object.entries(options) as [T, { label: string; text: string; icon: typeof Lock }][]).map(
          ([k, o]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={value === k}
              onClick={() => onChange(k)}
              className={cx(
                'flex flex-col items-center gap-1.5 px-4 py-4 text-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
                value === k
                  ? 'bg-accent-50 shadow-[inset_0_-2px_0_var(--brand-600)]'
                  : 'bg-snow hover:bg-zinc-50',
              )}
            >
              <o.icon
                className={cx('size-6 shrink-0', value === k ? 'text-accent-700' : 'text-zinc-500')}
              />
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs leading-snug text-zinc-500">{o.text}</span>
            </button>
          ),
        )}
      </div>
    </fieldset>
  );
}

/**
 * Image upload: drop a file on the box or click it. Shows the image with Replace / Remove on hover.
 * Stored as a data URL (resized so pages stay light).
 */
export function ImageField({
  label,
  value,
  onChange,
  hint,
  aspect = 'square',
  maxSize = 512,
  hideLabel,
  intro,
}: {
  label: string;
  value: string | null;
  onChange(v: string | null): void;
  hint?: string;
  aspect?: 'square' | 'wide';
  /** Longest edge in pixels after resizing. */
  maxSize?: number;
  hideLabel?: boolean;
  intro?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const pick = async (file: File) => {
    setError(null);
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type))
      return setError('Use a PNG, JPEG, WebP or SVG image');
    if (file.type === 'image/svg+xml') {
      if (file.size > 300_000) return setError('SVG files must be under 300 KB');
      return onChange(await readAsDataUrl(file));
    }
    try {
      onChange(await resize(file, maxSize));
    } catch {
      setError('That image could not be read');
    }
  };
  return (
    <div className={cx(aspect === 'square' ? 'w-40 shrink-0' : 'min-w-0 flex-1')}>
      <label
        htmlFor={id}
        className={cx(
          'mb-1.5 block text-xs font-medium tracking-wide text-zinc-600',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </label>
      {intro && <p className="-mt-1 mb-1.5 text-xs text-zinc-500">{intro}</p>}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) =>
          !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)
        }
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void pick(f);
        }}
        className={cx(
          'group relative flex items-center justify-center overflow-hidden border border-dashed text-center transition-colors focus-within:outline-2 focus-within:outline-accent-600',
          aspect === 'wide' ? 'h-40 w-full' : 'size-40',
          over
            ? 'border-accent-600 bg-accent-50'
            : value
              ? 'border-zinc-300 bg-zinc-50'
              : 'border-zinc-400 bg-zinc-50 hover:border-accent-600 hover:bg-accent-50/50',
        )}
      >
        {value && (
          <img
            src={value}
            alt=""
            className={cx('size-full', aspect === 'wide' ? 'object-cover' : 'object-contain p-2')}
          />
        )}
        {!value && (
          <label
            htmlFor={id}
            className="flex size-full cursor-pointer flex-col items-center justify-center gap-1.5 px-3 text-xs text-zinc-500"
          >
            <ImagePlus
              className={cx(
                'size-6',
                over ? 'text-accent-600' : 'text-zinc-400 group-hover:text-accent-600',
              )}
            />
            <span className="font-medium text-zinc-700">
              {over ? 'Drop to upload' : 'Drag an image here'}
            </span>
            {!over && <span>or click to browse</span>}
          </label>
        )}
        {value && over && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <span className="text-sm font-medium text-white">Drop to replace</span>
          </div>
        )}
        {value && !over && (
          <div className="absolute end-2 top-2 flex gap-1">
            <button
              type="button"
              onClick={() => input.current?.click()}
              aria-label={`Replace ${label.toLowerCase()}`}
              title="Replace"
              className="flex size-8 items-center justify-center border border-zinc-300 bg-snow/95 text-zinc-700 shadow-surface backdrop-blur hover:border-zinc-500 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-600"
            >
              <Upload className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Remove ${label.toLowerCase()}`}
              title="Remove"
              className="flex size-8 items-center justify-center border border-zinc-300 bg-snow/95 text-zinc-700 shadow-surface backdrop-blur hover:border-red-300 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-accent-600"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className={cx('mt-1.5 text-xs', error ? 'text-red-700' : 'text-zinc-500')}>
        {error ?? hint}
      </p>
    </div>
  );
}

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });

async function resize(file: File, max: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
}

/** A grid of icons to choose from (with the current one highlighted). */
/** The icon field: shows the current icon; clicking it opens a searchable icon selector. */
export function IconPicker({
  value,
  onChange,
  onClear,
  emptyLabel = 'No icon. Select an icon…',
  color,
  label = 'Icon',
  hideLabel,
  intro,
}: {
  /** Empty means no icon (only when `onClear` is given). */
  value: string | undefined;
  onChange(v: string): void;
  /** Makes the icon optional: a trash button next to the field removes it. */
  onClear?(): void;
  /** What the field says while no icon is chosen. */
  emptyLabel?: string;
  color?: string;
  label?: string;
  hideLabel?: boolean;
  intro?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const bg = color ?? 'var(--brand-600)';
  const Current = value ? (ICONS[value] ?? ICONS.box!) : null;
  const names = Object.keys(ICONS).filter(
    (k) => !q || k.replace(/-/g, ' ').includes(q.toLowerCase()),
  );
  const close = () => {
    setOpen(false);
    setQ('');
  };
  return (
    <div>
      {!hideLabel && (
        <div className="mb-1.5 text-xs font-medium tracking-wide text-zinc-600">{label}</div>
      )}
      {!hideLabel && intro && <p className="-mt-1 mb-1.5 text-xs text-zinc-500">{intro}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={hideLabel ? label : undefined}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex h-10 min-w-0 flex-1 items-center gap-3 border border-zinc-300 bg-snow px-1.5 pe-3 text-start text-sm hover:border-zinc-500 focus-visible:outline-2 focus-visible:outline-accent-600"
        >
          {Current ? (
            <span
              className="flex size-7 shrink-0 items-center justify-center"
              style={{ background: bg, color: contrastOn(color ?? '#0f62fe') }}
            >
              <Current className="size-4" />
            </span>
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center border border-dashed border-zinc-300 text-zinc-400">
              <ImageOff className="size-4" />
            </span>
          )}
          <span className={cx('min-w-0 flex-1 truncate', value ? 'capitalize' : 'text-zinc-500')}>
            {value ? value.replace(/-/g, ' ') : emptyLabel}
          </span>
          <ChevronRight className="size-4 shrink-0 text-zinc-400 rtl:rotate-180" />
        </button>
        {onClear && value && (
          <button
            type="button"
            aria-label="Clear icon"
            title="Clear icon"
            onClick={onClear}
            className="flex size-10 shrink-0 items-center justify-center border border-zinc-300 bg-snow text-zinc-600 hover:border-zinc-500 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-accent-600"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      <Dialog
        open={open}
        onClose={close}
        title="Choose an icon"
        description="Pick the icon that stands for this on maps, in lists and in menus."
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              aria-label="Search icons"
              placeholder="Search icons"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 w-full border border-zinc-300 bg-snow ps-9 pe-3 text-sm focus:border-accent-600 focus:outline-none"
            />
          </div>
          <div
            role="radiogroup"
            aria-label={label}
            className="grid max-h-[50vh] grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1 overflow-y-auto border border-zinc-200 p-2"
          >
            {names.map((k) => {
              const I = ICONS[k]!;
              const on = value === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={k.replace(/-/g, ' ')}
                  title={k.replace(/-/g, ' ')}
                  onClick={() => {
                    onChange(k);
                    close();
                  }}
                  className={cx(
                    'flex h-12 items-center justify-center transition-colors',
                    on ? '' : 'text-zinc-600 hover:bg-zinc-100',
                  )}
                  style={on ? { background: bg, color: contrastOn(color ?? '#0f62fe') } : undefined}
                >
                  <I className="size-5" />
                </button>
              );
            })}
            {!names.length && (
              <p className="col-span-full px-2 py-6 text-center text-sm text-zinc-500">
                No icons match “{q}”.
              </p>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

const COLOURS = [
  '#0f62fe',
  '#0e7c66',
  '#6929c4',
  '#da1e28',
  '#b28600',
  '#d12771',
  '#005d5d',
  '#4d0505',
];

/** Preset swatches plus a custom colour and hex field. */
export function ColourPicker({
  value,
  onChange,
  label = 'Colour',
  swatches = true,
  hideLabel,
  intro,
}: {
  value: string;
  onChange(v: string): void;
  label?: string;
  swatches?: boolean;
  hideLabel?: boolean;
  intro?: string;
}) {
  return (
    <div>
      {!hideLabel && (
        <div className="mb-1.5 text-xs font-medium tracking-wide text-zinc-600">{label}</div>
      )}
      {!hideLabel && intro && <p className="-mt-1 mb-1.5 text-xs text-zinc-500">{intro}</p>}
      {swatches && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
          {COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              aria-pressed={value.toLowerCase() === c}
              onClick={() => onChange(c)}
              className={cx(
                'flex size-8 items-center justify-center border-2',
                value.toLowerCase() === c ? 'border-ink' : 'border-transparent',
              )}
              style={{ background: c }}
            >
              {value.toLowerCase() === c && (
                <Check className="size-4" style={{ color: contrastOn(c) }} />
              )}
            </button>
          ))}
        </div>
      )}
      <div
        className={cx(
          'flex h-10 items-center gap-3 border border-zinc-300 bg-snow px-1.5 focus-within:border-accent-600 hover:border-zinc-500',
          swatches && 'mt-2',
        )}
      >
        <input
          type="color"
          aria-label="Custom colour"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-7 shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
        <input
          aria-label="Hex colour"
          value={value}
          onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && onChange(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm uppercase focus:outline-none"
        />
      </div>
    </div>
  );
}

/** A short row of options (2–3) as one control; the chosen option's explanation shows underneath. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  intro,
}: {
  label: string;
  intro?: string;
  value: T;
  onChange(v: T): void;
  options: Record<T, { label: string; text: string; icon: typeof Lock }>;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-zinc-600">{label}</legend>
      {intro && <p className="-mt-1 mb-1.5 text-xs text-zinc-500">{intro}</p>}
      <div role="radiogroup" aria-label={label} className="flex border border-zinc-300">
        {(Object.entries(options) as [T, { label: string; text: string; icon: typeof Lock }][]).map(
          ([k, o]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={value === k}
              title={o.text}
              onClick={() => onChange(k)}
              className={cx(
                'flex h-9 flex-1 items-center justify-center gap-1.5 border-s border-zinc-300 px-2 text-sm first:border-s-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
                value === k
                  ? 'bg-accent-50 font-medium text-accent-800 shadow-[inset_0_-2px_0_var(--brand-600)]'
                  : 'bg-snow text-zinc-700 hover:bg-zinc-50',
              )}
            >
              <o.icon className="size-4 shrink-0" />
              {o.label}
            </button>
          ),
        )}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">{options[value].text}</p>
    </fieldset>
  );
}

const LAYOUTS: { value: ExplorerConfig['layout']; label: string; text: string; art: string }[] = [
  {
    value: 'map',
    label: 'Map only',
    text: 'Full-screen map with layers. No dashboards.',
    art: '<rect width="160" height="100" fill="#cfdde8"/><path d="M14 70 30 40 52 46 62 64 44 86Z" fill="#b9cdb4"/><path d="M92 20 126 14 138 40 112 52Z" fill="#b9cdb4"/><rect x="8" y="8" width="42" height="26" fill="#fff" opacity="0.9"/>',
  },
  {
    value: 'both',
    label: 'Map and dashboards',
    text: 'Map with a dashboard panel beside it.',
    art: '<rect width="160" height="100" fill="#cfdde8"/><path d="M12 70 26 40 46 46 54 64 38 86Z" fill="#b9cdb4"/><path d="M70 20 96 14 104 40 84 52Z" fill="#b9cdb4"/><rect x="8" y="8" width="34" height="22" fill="#fff" opacity="0.9"/><rect x="108" y="6" width="46" height="88" fill="#fff"/><rect x="113" y="12" width="36" height="8" fill="#dfe5e9"/><rect x="113" y="24" width="16" height="14" fill="#e7f0ec"/><rect x="133" y="24" width="16" height="14" fill="#e7f0ec"/><rect x="113" y="42" width="36" height="22" fill="#eef1f4"/>',
  },
  {
    value: 'dashboard',
    label: 'Dashboards only',
    text: 'The whole view is the dashboard. No map.',
    art: '<rect width="160" height="100" fill="#eef1f4"/><rect x="8" y="8" width="34" height="18" fill="#fff"/><rect x="46" y="8" width="34" height="18" fill="#fff"/><rect x="84" y="8" width="34" height="18" fill="#fff"/><rect x="122" y="8" width="30" height="18" fill="#fff"/><rect x="8" y="32" width="100" height="60" fill="#fff"/><path d="M14 80 C30 70 38 52 56 58 S86 50 102 42" fill="none" stroke="#2f7a63" stroke-width="2"/><rect x="112" y="32" width="40" height="60" fill="#fff"/><circle cx="132" cy="58" r="12" fill="none" stroke="#d9822b" stroke-width="6"/>',
  },
];
const LAYER_CHOICES: Record<'hide' | 'keep', { label: string; text: string; icon: LucideIcon }> = {
  hide: {
    label: 'Hide dashboards',
    text: 'The map takes the full width and shows its legend. A button brings them back.',
    icon: EyeOff,
  },
  keep: { label: 'Keep them', text: 'The dashboards stay beside the map.', icon: Eye },
};
const PANEL_CHOICES: Record<
  'open' | 'collapsed',
  { label: string; text: string; icon: LucideIcon }
> = {
  open: { label: 'Open', text: 'The dashboard panel is showing.', icon: PanelRightOpen },
  collapsed: {
    label: 'Collapsed',
    text: 'Start with the map clear; open the panel when needed.',
    icon: PanelRightClose,
  },
};

/**
 * What people see when they open a project (map, dashboards or both) and, with both, how the
 * dashboard panel behaves. Used when creating a project and in its settings.
 */
export function ExplorerLayoutFields({
  value,
  onChange,
  dashboardCount,
}: {
  value: ExplorerConfig;
  onChange(v: ExplorerConfig): void;
  dashboardCount?: number;
}) {
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Explorer layout" className="grid gap-3 sm:grid-cols-3">
        {LAYOUTS.map((l) => {
          const on = value.layout === l.value;
          return (
            <button
              key={l.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ ...value, layout: l.value })}
              className={cx(
                'border p-2.5 text-start transition-colors',
                on
                  ? 'border-accent-600 bg-accent-50 ring-2 ring-accent-600/15'
                  : 'border-zinc-300 hover:border-zinc-500',
              )}
            >
              <svg
                viewBox="0 0 160 100"
                className="block w-full"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: l.art }}
              />
              <span className={cx('mt-2.5 block text-sm', on ? 'font-semibold' : 'font-medium')}>
                {l.label}
              </span>
              <span className="mt-1 block text-xs leading-snug text-zinc-500">{l.text}</span>
            </button>
          );
        })}
      </div>
      {value.layout === 'both' && (
        <div className="space-y-4 border-t border-zinc-200 pt-5">
          <ChoiceCards
            label="When a map layer is on"
            intro="Picking a layer can give the map the full width"
            value={value.hideOnLayer ? 'hide' : 'keep'}
            onChange={(v) => onChange({ ...value, hideOnLayer: v === 'hide' })}
            options={LAYER_CHOICES}
          />
          <ChoiceCards
            label="Open with the dashboard panel"
            intro="How the panel starts when someone opens the project"
            value={value.panelStart}
            onChange={(panelStart) => onChange({ ...value, panelStart })}
            options={PANEL_CHOICES}
          />
        </div>
      )}
      {value.layout !== 'both' && (
        <p className="bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          {value.layout === 'map'
            ? 'Dashboards are not shown in this layout. Map layers and overlays still are.'
            : 'The map and its layers are not shown in this layout.'}
          {value.layout === 'dashboard' &&
            dashboardCount === 0 &&
            ' This project has no dashboards yet, so people will see an empty page until you add one.'}
        </p>
      )}
    </div>
  );
}

const UNIT_LABEL: Record<ReportingPeriod['unit'], string> = {
  hours: 'Hours',
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
  years: 'Years',
};
const plural = (n: number, unit: ReportingPeriod['unit']) =>
  Math.abs(n) === 1 ? unit.slice(0, -1) : unit;
/** "Last 7 days", "Next 30 days". */
const spans = (p: Pick<ReportingPeriod, 'unit' | 'n'>) =>
  `${p.n < 0 ? 'Last' : 'Next'} ${Math.abs(p.n).toLocaleString()} ${plural(p.n, p.unit)}`;

/**
 * The reporting periods a project offers in its dashboards and map layers, as a table: each one
 * is added or edited in a window, can be hidden without deleting, and people may also be allowed
 * to pick their own dates.
 */
export function ReportingFields({
  value,
  onChange,
}: {
  value: ReportingConfig;
  onChange(v: ReportingConfig): void;
}) {
  const [editing, setEditing] = useState<ReportingPeriod | 'new' | null>(null);
  const update = (id: string, patch: Partial<ReportingPeriod>) =>
    onChange({
      ...value,
      periods: value.periods.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  return (
    <div className="space-y-5">
      <ChoiceCards
        label="Reporting period picker"
        intro="Whether people can choose the time period for dashboards and map layers"
        value={value.enabled ? 'on' : 'off'}
        onChange={(v) => onChange({ ...value, enabled: v === 'on' })}
        options={{
          on: {
            label: 'Enabled',
            text: 'People choose the period from the list below.',
            icon: Calendar,
          },
          off: {
            label: 'Disabled',
            text: 'Every widget and layer keeps its own period.',
            icon: CalendarOff,
          },
        }}
      />
      {value.enabled && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <div className="text-xs font-medium tracking-wide text-zinc-600">
              Periods people can pick
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-xs text-zinc-500 underline hover:text-ink"
                onClick={async () =>
                  (await confirmDialog(
                    'Replace the list with the standard periods? Your own periods will be removed.',
                  )) && onChange({ ...value, periods: DEFAULT_REPORTING_PERIODS })
                }
              >
                Reset to the standard periods
              </button>
              <Button
                size="sm"
                icon={Plus}
                disabled={value.periods.length >= 12}
                onClick={() => setEditing('new')}
              >
                Add a period
              </Button>
            </div>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            These appear in the reporting period menu of the explorer, for dashboards and map
            layers. A hidden period stays in the list but is not offered.
          </p>
          {value.periods.length === 0 ? (
            <p className="bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              No periods yet. Widgets and layers keep their own period unless people pick custom
              dates.
            </p>
          ) : (
            <Panel flush>
              <Table head={['Name', 'Covers', 'How far', '']}>
                {value.periods.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-100">
                    <Td className={cx('font-medium', p.hidden && 'text-zinc-400')}>{p.label}</Td>
                    <Td className={p.hidden ? 'text-zinc-400' : undefined}>{spans(p)}</Td>
                    <Td className={cx('num', p.hidden && 'text-zinc-400')}>
                      {p.n > 0 ? `+${p.n}` : p.n}
                    </Td>
                    <Td>
                      <span className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={`Edit ${p.label}`}
                          title="Edit"
                          onClick={() => setEditing(p)}
                          className="p-1 text-zinc-500 hover:text-ink"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={p.hidden ? `Show ${p.label}` : `Hide ${p.label}`}
                          aria-pressed={!!p.hidden}
                          title={
                            p.hidden
                              ? 'Hidden: click to offer it again'
                              : 'Hide from the menu without deleting'
                          }
                          onClick={() => update(p.id, { hidden: p.hidden ? undefined : true })}
                          className={cx(
                            'p-1 hover:text-ink',
                            p.hidden ? 'text-amber-700' : 'text-zinc-500',
                          )}
                        >
                          {p.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${p.label}`}
                          title="Delete"
                          onClick={async () =>
                            (await confirmDialog(`Delete the period “${p.label}”?`)) &&
                            onChange({
                              ...value,
                              periods: value.periods.filter((x) => x.id !== p.id),
                            })
                          }
                          className="p-1 text-zinc-500 hover:text-red-700"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </span>
                    </Td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}
        </div>
      )}
      {value.enabled && (
        <ChoiceCards
          label="Custom dates"
          intro="Whether people can also choose their own start and end date"
          value={value.allowCustom ? 'yes' : 'no'}
          onChange={(v) => onChange({ ...value, allowCustom: v === 'yes' })}
          options={{
            yes: {
              label: 'Allow custom dates',
              text: 'People can pick any range as well as the periods above.',
              icon: Calendar,
            },
            no: {
              label: 'Only these periods',
              text: 'People choose from the list and nothing else.',
              icon: Lock,
            },
          }}
        />
      )}
      {editing && (
        <PeriodDialog
          period={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            onChange({
              ...value,
              periods:
                editing === 'new'
                  ? [...value.periods, p]
                  : value.periods.map((x) => (x.id === p.id ? p : x)),
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Adds or edits one reporting period. */
function PeriodDialog({
  period,
  onClose,
  onSave,
}: {
  period: ReportingPeriod | null;
  onClose(): void;
  onSave(p: ReportingPeriod): void;
}) {
  const [label, setLabel] = useState(period?.label ?? '');
  const [unit, setUnit] = useState<ReportingPeriod['unit']>(period?.unit ?? 'days');
  const [n, setN] = useState<string>(String(period?.n ?? -30));
  const num = Math.trunc(Number(n));
  const valid =
    label.trim().length > 0 && Number.isFinite(num) && num !== 0 && Math.abs(num) <= 3650;
  return (
    <Dialog
      open
      onClose={onClose}
      title={period ? `Edit ${period.label}` : 'Add a period'}
      description="A window of time people can pick for dashboards and map layers."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onSave({
                id: period?.id ?? `p${Date.now().toString(36)}`,
                label: label.trim(),
                unit,
                n: num,
                ...(period?.hidden && { hidden: true }),
              })
            }
          >
            {period ? 'Save period' : 'Add period'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" intro="How it appears in the menu">
          <Input
            icon={Type}
            autoFocus
            maxLength={40}
            placeholder="e.g. Last 7 days"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Covers" intro="The unit of time">
          <Select
            icon={Calendar}
            value={unit}
            onChange={(e) => setUnit(e.target.value as ReportingPeriod['unit'])}
          >
            {(Object.keys(UNIT_LABEL) as ReportingPeriod['unit'][]).map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="How far"
          intro="A minus looks back (-30 is the last 30), a plus looks ahead (30 is the next 30)"
        >
          <Input
            icon={Hash}
            type="number"
            min={-3650}
            max={3650}
            placeholder="-30"
            value={n}
            onChange={(e) => setN(e.target.value)}
          />
        </Field>
        {valid && (
          <p className="bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{spans({ unit, n: num })}</p>
        )}
      </div>
    </Dialog>
  );
}

const RATE_LABEL: Record<number, string> = {
  0: 'Off',
  30: 'Every 30 seconds',
  60: 'Every minute',
  300: 'Every 5 minutes',
  900: 'Every 15 minutes',
};

/**
 * How a project's dashboards and map layers refresh themselves: whether people see the refresh
 * controls, and the rate everyone starts at (on every page load it goes back to this).
 */
export function RefreshFields({
  value,
  onChange,
}: {
  value: RefreshConfig;
  onChange(v: RefreshConfig): void;
}) {
  return (
    <div className="space-y-5">
      <ChoiceCards
        label="Auto-refresh"
        intro="Whether dashboards and map layers refresh themselves, and whether people can change it"
        value={value.enabled ? 'on' : 'off'}
        onChange={(v) => onChange({ ...value, enabled: v === 'on' })}
        options={{
          on: {
            label: 'Enabled',
            text: 'Data refreshes by itself. People can change the rate for their visit.',
            icon: RefreshCw,
          },
          off: {
            label: 'Disabled',
            text: 'No auto-refresh and no refresh controls.',
            icon: RefreshCwOff,
          },
        }}
      />
      {value.enabled && (
        <>
          <Field
            label="Default rate"
            intro="What everyone starts at each time they open or reload the project"
          >
            <Select
              icon={RefreshCw}
              value={String(value.every)}
              onChange={(e) => onChange({ ...value, every: Number(e.target.value) })}
            >
              {REFRESH_RATES.map((r) => (
                <option key={r} value={String(r)}>
                  {RATE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <ChoiceCards
            label="When the tab is in the background"
            intro="Pausing saves data and battery for people who leave the page open"
            value={value.pauseHidden ? 'pause' : 'keep'}
            onChange={(v) => onChange({ ...value, pauseHidden: v === 'pause' })}
            options={{
              pause: {
                label: 'Pause',
                text: 'Stop refreshing until they come back to the tab.',
                icon: EyeOff,
              },
              keep: {
                label: 'Keep refreshing',
                text: 'Refresh even when the tab is hidden.',
                icon: Eye,
              },
            }}
          />
        </>
      )}
    </div>
  );
}

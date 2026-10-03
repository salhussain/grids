import type { ProjectStatus, ProjectVisibility } from '@grids/schema';
import { cx } from '@grids/ui';
import { Globe, ImagePlus, Lock, PencilRuler, Rocket, Trash2, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { ICONS } from './context';

export const VISIBILITY: Record<ProjectVisibility, { label: string; text: string; icon: typeof Lock }> = {
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
}: {
  label: string;
  value: T;
  onChange(v: T): void;
  options: Record<T, { label: string; text: string; icon: typeof Lock }>;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-zinc-600">{label}</legend>
      <div role="radiogroup" aria-label={label} className="grid gap-px border border-zinc-300 bg-zinc-300 sm:auto-cols-fr sm:grid-flow-col">
        {(Object.entries(options) as [T, { label: string; text: string; icon: typeof Lock }][]).map(([k, o]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={value === k}
            onClick={() => onChange(k)}
            className={cx(
              'flex items-start gap-2.5 px-3 py-2.5 text-start transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
              value === k ? 'bg-accent-50 shadow-[inset_0_-2px_0_var(--brand-600)]' : 'bg-snow hover:bg-zinc-50',
            )}
          >
            <o.icon className={cx('mt-0.5 size-4 shrink-0', value === k ? 'text-accent-700' : 'text-zinc-500')} />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-zinc-500">{o.text}</span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Image upload with preview, stored as a data URL (resized so pages stay light). */
export function ImageField({
  label,
  value,
  onChange,
  hint,
  aspect = 'square',
  maxSize = 512,
}: {
  label: string;
  value: string | null;
  onChange(v: string | null): void;
  hint?: string;
  aspect?: 'square' | 'wide';
  /** Longest edge in pixels after resizing. */
  maxSize?: number;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File) => {
    setError(null);
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setError('Use a PNG, JPEG, WebP or SVG image');
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
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-zinc-600">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <label
          htmlFor={id}
          className={cx(
            'group relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden border border-dashed border-zinc-400 bg-zinc-50 hover:border-accent-600',
            aspect === 'wide' ? 'h-20 w-40' : 'size-20',
          )}
        >
          {value ? <img src={value} alt="" className={cx('size-full', aspect === 'wide' ? 'object-cover' : 'object-contain p-1')} /> : <ImagePlus className="size-6 text-zinc-400 group-hover:text-accent-600" />}
        </label>
        <input
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
        <div className="min-w-0 text-xs text-zinc-500">
          {error ? <span className="text-red-700">{error}</span> : hint}
          {value && (
            <button type="button" onClick={() => onChange(null)} className="mt-1 flex items-center gap-1 text-red-700 hover:underline">
              <Trash2 className="size-3.5" /> Remove
            </button>
          )}
        </div>
      </div>
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
export function IconPicker({ value, onChange, color, label = 'Icon' }: { value: string; onChange(v: string): void; color?: string; label?: string }) {
  const [q, setQ] = useState('');
  const names = Object.keys(ICONS).filter((k) => !q || k.includes(q.toLowerCase()));
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-medium tracking-wide text-zinc-600">
        {label}
        <input aria-label="Search icons" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="h-6 w-28 border border-zinc-300 bg-snow px-1.5 text-xs font-normal" />
      </legend>
      <div role="radiogroup" aria-label={label} className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto border border-zinc-200 p-1.5 sm:grid-cols-10">
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
              onClick={() => onChange(k)}
              className={cx('flex aspect-square items-center justify-center transition-colors', on ? 'text-white' : 'text-zinc-600 hover:bg-zinc-100')}
              style={on ? { background: color ?? 'var(--brand-600)' } : undefined}
            >
              <I className="size-4" />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

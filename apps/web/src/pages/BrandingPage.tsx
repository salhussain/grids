import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Home, ImagePlus, Network, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Theme } from '@grids/schema';
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Panel,
  Status,
  Textarea,
  cx,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';
import { applyTheme, contrastOn } from '../theme';

const PRESETS = [
  '#0f62fe',
  '#198038',
  '#8a3ffc',
  '#da1e28',
  '#007d79',
  '#ff832b',
  '#161616',
  '#b28600',
];
const MAX_LOGO_BYTES = 200 * 1024;

export function BrandingPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Theme>(ws.theme);
  const [logoError, setLogoError] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview.current) applyTheme(draft, preview.current);
  }, [draft]);
  const save = useMutation({
    mutationFn: () => api.setTheme(ws.tenant.id, draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workspace', ws.tenant.id] });
      toast('Branding saved');
    },
  });
  if (!can('branding.manage')) return <NoAccess what="branding" />;
  const set = <K extends keyof Theme>(k: K, v: Theme[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const featured = ws.features.includes('custom_branding');

  function onLogo(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES)
      return setLogoError(
        `Logo must be under 200 KB (this one is ${Math.round(file.size / 1024)} KB).`,
      );
    const reader = new FileReader();
    reader.onload = () => set('logo', reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.nav.branding')}
        meta={<span>Make the workspace look like {ws.tenant.name}.</span>}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDraft(ws.theme)}>
              Reset
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Save branding
            </Button>
          </>
        }
      />
      {!featured && (
        <div className="mb-6 border-s-4 border-amber-500 bg-amber-50 px-5 py-3 text-sm">
          Custom colours and logos need a plan with custom branding. You can still set the name and
          welcome message.
        </div>
      )}
      <ErrorNotice error={save.error} />
      <div className="mt-2 grid gap-6 xl:grid-cols-[1fr_440px]">
        <div className="space-y-6">
          <Panel title="Identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Workspace name" hint={`Shown instead of “${ws.tenant.name}” when set`}>
                <Input
                  value={draft.appName}
                  onChange={(e) => set('appName', e.target.value)}
                  placeholder={ws.tenant.name}
                  maxLength={40}
                />
              </Field>
              <div>
                <span className="mb-1.5 block text-xs font-medium tracking-wide text-zinc-600">
                  Logo
                </span>
                <div className="flex items-center gap-3">
                  <div className="flex size-12 items-center justify-center border border-zinc-300 bg-zinc-50">
                    {draft.logo ? (
                      <img src={draft.logo} alt="Logo preview" className="size-10 object-contain" />
                    ) : (
                      <ImagePlus className="size-5 text-zinc-400" />
                    )}
                  </div>
                  <label className="inline-flex h-9 cursor-pointer items-center border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-900">
                    Upload
                    <input
                      type="file"
                      accept="image/png,image/svg+xml,image/jpeg,image/webp"
                      className="sr-only"
                      aria-label="Upload logo"
                      onChange={(e) => onLogo(e.target.files?.[0])}
                    />
                  </label>
                  {draft.logo && (
                    <Button variant="ghost" size="sm" icon={X} onClick={() => set('logo', null)}>
                      Remove
                    </Button>
                  )}
                </div>
                {logoError && <p className="mt-1 text-xs text-red-700">{logoError}</p>}
                <p className="mt-1 text-xs text-zinc-500">
                  PNG, SVG, JPEG or WebP, square works best, under 200 KB.
                </p>
              </div>
              <Field
                label="Welcome message"
                className="sm:col-span-2"
                hint="Shown on everyone’s home page"
              >
                <Textarea
                  rows={2}
                  value={draft.welcomeMessage}
                  onChange={(e) => set('welcomeMessage', e.target.value)}
                  maxLength={500}
                />
              </Field>
            </div>
          </Panel>
          <Panel title="Maps" description="Basemaps for the explorer. Leave blank for the defaults (CARTO Voyager by day, Dark Matter by night). Any MapLibre or Mapbox style URL works, e.g. MapTiler with your key.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Day style URL">
                <Input
                  value={draft.mapStyles.light ?? ''}
                  placeholder="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
                  onChange={(e) => set('mapStyles', { ...draft.mapStyles, light: e.target.value.trim() || null })}
                />
              </Field>
              <Field label="Night style URL">
                <Input
                  value={draft.mapStyles.dark ?? ''}
                  placeholder="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
                  onChange={(e) => set('mapStyles', { ...draft.mapStyles, dark: e.target.value.trim() || null })}
                />
              </Field>
            </div>
          </Panel>
          <Panel title="Colour">
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => set('primaryColor', c)}
                  aria-label={`Use ${c}`}
                  aria-pressed={draft.primaryColor === c}
                  className={cx(
                    'flex size-9 items-center justify-center border-2',
                    draft.primaryColor === c ? 'border-ink' : 'border-transparent',
                  )}
                  style={{ background: c }}
                >
                  {draft.primaryColor === c && (
                    <Check className="size-4" style={{ color: contrastOn(c) }} />
                  )}
                </button>
              ))}
              <label className="ml-2 flex items-center gap-2 text-sm">
                <input
                  type="color"
                  value={draft.primaryColor}
                  onChange={(e) => set('primaryColor', e.target.value)}
                  aria-label="Custom colour"
                  className="size-9 cursor-pointer border border-zinc-300 bg-snow p-0.5"
                />
                <Input
                  value={draft.primaryColor}
                  onChange={(e) =>
                    /^#[0-9a-f]{0,6}$/i.test(e.target.value) && set('primaryColor', e.target.value)
                  }
                  className="w-28 font-mono"
                  aria-label="Hex colour"
                />
              </label>
            </div>
            <div className="mt-5">
              <span className="mb-2 block text-xs font-medium tracking-wide text-zinc-600">
                Sidebar style
              </span>
              <div role="radiogroup" className="inline-flex border border-zinc-300">
                {(['dark', 'light', 'brand'] as const).map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={draft.sidebar === s}
                    onClick={() => set('sidebar', s)}
                    className={cx(
                      'px-4 py-2 text-sm capitalize',
                      draft.sidebar === s ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-100',
                    )}
                  >
                    {s === 'brand' ? 'Brand colour' : s}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <aside className="xl:sticky xl:top-8 xl:self-start">
          <div className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Live preview
          </div>
          <div
            ref={preview}
            className="flex h-80 overflow-hidden border border-zinc-300 bg-canvas"
            aria-label="Branding preview"
          >
            <div
              className={cx(
                'flex w-40 flex-col',
                draft.sidebar === 'dark'
                  ? 'chrome bg-chrome text-zinc-300'
                  : draft.sidebar === 'light'
                    ? 'border-r border-zinc-200 bg-snow text-zinc-700'
                    : 'bg-accent-700 text-on-accent',
              )}
            >
              <div className="flex items-center gap-2 border-b border-current/10 p-3">
                {draft.logo ? (
                  <img src={draft.logo} alt="" className="size-6 object-contain" />
                ) : (
                  <span className="flex size-6 items-center justify-center bg-accent-600 text-xs font-semibold text-on-accent">
                    {(draft.appName || ws.tenant.name).slice(0, 1)}
                  </span>
                )}
                <span className="truncate text-xs font-semibold">
                  {draft.appName || ws.tenant.name}
                </span>
              </div>
              {[Home, Users, Network].map((Icon, i) => (
                <div
                  key={i}
                  className={cx(
                    'flex items-center gap-2 border-s-[3px] px-3 py-1.5 text-xs',
                    i === 1
                      ? draft.sidebar === 'brand'
                        ? 'border-on-accent bg-black/20'
                        : 'border-accent-500 bg-accent-600/10'
                      : 'border-transparent',
                  )}
                >
                  <Icon className="size-3.5" /> {['Home', 'People', 'Structure'][i]}
                </div>
              ))}
            </div>
            <div className="flex-1 space-y-3 p-4">
              <div className="text-sm font-semibold">People</div>
              <div className="flex gap-2">
                <span className="inline-flex h-7 items-center bg-accent-600 px-2.5 text-xs font-medium text-on-accent">
                  Invite people
                </span>
                <span className="inline-flex h-7 items-center border border-zinc-300 bg-snow px-2.5 text-xs">
                  Export
                </span>
              </div>
              <div className="border border-zinc-200 bg-snow p-3 text-xs">
                <div className="flex justify-between">
                  <span>Ana Smith</span>
                  <Status value="active" />
                </div>
                <div className="mt-2 h-1.5 bg-zinc-100">
                  <div className="h-full w-2/3 bg-accent-600" />
                </div>
              </div>
              <div className="border-s-4 border-accent-600 bg-accent-50 p-2 text-xs">
                Your branding applies to everyone in {ws.tenant.name}.
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

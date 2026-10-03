import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCALES } from '@grids/i18n';
import type { PlatformSettingsDto } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, Listbox, Loading, PageHeader, Panel, Textarea, cx, useToast } from '@grids/ui';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';

/** Platform-wide branding and languages. */
export function SettingsPage() {
  const t = useT();
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: api.platformSettings });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorNotice error={q.error} />;
  return (
    <>
      <PageHeader eyebrow={t('console.nav.administration')} title={t('console.settings.title')} meta={<span>{t('console.settings.intro')}</span>} />
      <SettingsForm initial={q.data} />
    </>
  );
}

function SettingsForm({ initial }: { initial: PlatformSettingsDto }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [b, setB] = useState(initial.branding);
  const [l, setL] = useState(initial.localization);
  const dirty = JSON.stringify({ b, l }) !== JSON.stringify({ b: initial.branding, l: initial.localization });
  const save = useMutation({
    mutationFn: () => api.savePlatformSettings({ branding: b, localization: l }),
    onSuccess: (d) => {
      qc.setQueryData(['platform-settings'], d);
      void qc.invalidateQueries({ queryKey: ['platform'] });
      toast(t('console.settings.saved'));
    },
  });
  // Keep the default inside the chosen set.
  useEffect(() => {
    if (!l.consoleLanguages.includes(l.consoleDefault)) setL((x) => ({ ...x, consoleDefault: x.consoleLanguages[0] ?? 'en' }));
    if (!l.orgLanguages.includes(l.orgDefault)) setL((x) => ({ ...x, orgDefault: x.orgLanguages[0] ?? 'en' }));
  }, [l]);

  return (
    <div className="space-y-6">
      <ErrorNotice error={save.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={t('console.settings.branding')} description={t('console.settings.brandingHint')}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('console.settings.appName')}>
                <Input value={b.appName} onChange={(e) => setB({ ...b, appName: e.target.value })} />
              </Field>
              <Field label={t('console.settings.colour')}>
                <div className="flex gap-2">
                  <input type="color" aria-label={t('console.settings.colour')} value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} className="h-9 w-12 border border-zinc-300 bg-snow" />
                  <Input value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} className="font-mono" />
                </div>
              </Field>
            </div>
            <LogoField label={t('console.settings.logo')} value={b.logo} onChange={(logo) => setB({ ...b, logo })} />
            <Field label={t('console.settings.welcome')}>
              <Textarea value={b.welcomeMessage} onChange={(e) => setB({ ...b, welcomeMessage: e.target.value })} />
            </Field>
            <Field label={t('console.settings.supportEmail')}>
              <Input type="email" value={b.supportEmail} onChange={(e) => setB({ ...b, supportEmail: e.target.value })} />
            </Field>
          </div>
        </Panel>
        <Panel title={t('console.settings.preview')}>
          <div className="overflow-hidden border border-zinc-200">
            <div className="flex items-center gap-3 bg-[#161616] px-4 py-3 text-white">
              {b.logo ? <img src={b.logo} alt="" className="size-8 bg-white object-contain p-0.5" /> : <span className="size-8" style={{ background: b.primaryColor }} />}
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-[0.12em] uppercase">{b.appName || 'Grids'}</div>
                <div className="text-[11px] text-zinc-400">{t('console.shell.subtitle')}</div>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <div className="text-lg font-semibold">{b.welcomeMessage || 'One platform for your data'}</div>
              <div className="h-9 border border-zinc-300" />
              <div className="flex h-9 items-center justify-center text-sm font-medium text-white" style={{ background: b.primaryColor }}>
                Sign in
              </div>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title={t('console.settings.languages')}>
        <div className="grid gap-6 lg:grid-cols-2">
          <LanguageSet
            title={t('console.settings.consoleLanguages')}
            hint={t('console.settings.consoleLanguagesHint')}
            value={l.consoleLanguages}
            onChange={(consoleLanguages) => setL({ ...l, consoleLanguages })}
            defaultLabel={t('console.settings.consoleDefault')}
            defaultValue={l.consoleDefault}
            onDefault={(consoleDefault) => setL({ ...l, consoleDefault })}
          />
          <LanguageSet
            title={t('console.settings.orgLanguages')}
            hint={t('console.settings.orgLanguagesHint')}
            value={l.orgLanguages}
            onChange={(orgLanguages) => setL({ ...l, orgLanguages })}
            defaultLabel={t('console.settings.orgDefault')}
            defaultValue={l.orgDefault}
            onDefault={(orgDefault) => setL({ ...l, orgDefault })}
          />
        </div>
      </Panel>
      <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-zinc-200 bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          {t('console.settings.save')}
        </Button>
      </div>
    </div>
  );
}

function LanguageSet({ title, hint, value, onChange, defaultLabel, defaultValue, onDefault }: { title: string; hint: string; value: string[]; onChange(v: string[]): void; defaultLabel: string; defaultValue: string; onDefault(v: string): void }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-3 text-xs text-zinc-500">{hint}</p>
      <ul className="grid gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-2">
        {LOCALES.map((loc) => {
          const on = value.includes(loc.code);
          return (
            <li key={loc.code} className="bg-snow">
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && value.length === 1}
                  onChange={() => onChange(on ? value.filter((c) => c !== loc.code) : LOCALES.map((x) => x.code as string).filter((c) => c === loc.code || value.includes(c)))}
                  className="size-4 accent-[var(--brand-600)]"
                />
                <span lang={loc.code} className="flex-1">
                  {loc.nativeName}
                </span>
                {loc.status === 'draft' && <span className="text-[10px] text-amber-700">draft</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <Field label={defaultLabel} className="mt-3">
        <Listbox label={defaultLabel} value={defaultValue} onChange={onDefault} options={LOCALES.filter((x) => value.includes(x.code)).map((x) => ({ value: x.code as string, label: x.nativeName }))} />
      </Field>
    </div>
  );
}

function LogoField({ label, value, onChange }: { label: string; value: string | null; onChange(v: string | null): void }) {
  const [error, setError] = useState<string | null>(null);
  const pick = async (f: File) => {
    setError(null);
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return setError('PNG, JPEG, WebP or SVG');
    if (f.type === 'image/svg+xml') {
      if (f.size > 300_000) return setError('SVG files must be under 300 KB');
      const r = new FileReader();
      r.onload = () => onChange(String(r.result));
      return r.readAsDataURL(f);
    }
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    onChange(c.toDataURL('image/png'));
  };
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium tracking-wide text-zinc-600">{label}</div>
      <div className="flex items-center gap-3">
        <label className={cx('flex size-16 cursor-pointer items-center justify-center border border-dashed border-zinc-400 bg-zinc-50 hover:border-accent-600')}>
          {value ? <img src={value} alt="" className="size-full object-contain p-1" /> : <ImagePlus className="size-5 text-zinc-400" />}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="flex items-center gap-1 text-xs text-red-700 hover:underline">
            <Trash2 className="size-3.5" /> Remove
          </button>
        )}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LOCALES } from '@grids/i18n';
import type { LocalizationDto, MeDto } from '@grids/schema';
import { applyColorMode, cx, Dialog, storedColorMode, useToast } from '@grids/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api';
import { localeName, useT } from './i18n';

/** Keeps the page in the person's saved colour mode (also across devices). */
export function useColorModePreference(me: MeDto | undefined) {
  const mode = me?.preferences.colorMode;
  useEffect(() => {
    if (mode && mode !== storedColorMode()) applyColorMode(mode);
  }, [mode]);
  // First paint used the device's cached mode; keep "system" live-following the OS.
  useEffect(() => applyColorMode(storedColorMode()), []);
}

function useSavePreferences() {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation({
    mutationFn: api.setPreferences,
    onSuccess: (me) => {
      qc.setQueryData(['me'], me);
      applyColorMode(me.preferences.colorMode);
      toast(t('web.prefs.saved'));
    },
  });
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * One-button light/dark switch. Follows the device until clicked and always shows
 * the mode it switches to; picking the device's own mode goes back to "system".
 */
export function ThemeToggle({ me, className }: { me: MeDto; className?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: api.setPreferences,
    onSuccess: (next) => qc.setQueryData(['me'], next),
  });
  const [osDark, setOsDark] = useState(() => systemDark().matches);
  useEffect(() => {
    const mq = systemDark();
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const mode = save.variables?.colorMode ?? me.preferences.colorMode;
  const dark = mode === 'system' ? osDark : mode === 'dark';
  const label = dark ? t('web.shell.lightMode') : t('web.shell.darkMode');
  const icon = 'absolute size-4 transition-[opacity,transform] duration-[400ms] motion-reduce:transition-none';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        const next = dark === osDark ? (dark ? 'light' : 'dark') : 'system';
        applyColorMode(next);
        save.mutate({ colorMode: next });
      }}
      className={cx('relative flex size-8 shrink-0 items-center justify-center', className)}
    >
      <Sun className={cx(icon, dark ? 'scale-100 rotate-0 opacity-100' : 'scale-60 -rotate-90 opacity-0')} />
      <Moon className={cx(icon, dark ? 'scale-60 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100')} />
    </button>
  );
}

/** Appearance and language, per person. Languages are limited to the organisation's set. */
export function PreferencesDialog({
  open,
  onClose,
  me,
  localization,
}: {
  open: boolean;
  onClose(): void;
  me: MeDto;
  localization: LocalizationDto | null;
}) {
  const t = useT();
  const save = useSavePreferences();
  const p = me.preferences;
  const languages = LOCALES.filter((l) => !localization || localization.languages.includes(l.code));
  const modes = [
    { v: 'light', icon: Sun, label: t('common.light') },
    { v: 'dark', icon: Moon, label: t('common.dark') },
    { v: 'system', icon: Monitor, label: t('common.system') },
  ] as const;
  return (
    <Dialog open={open} onClose={onClose} title={t('web.prefs.title')} closeLabel={t('common.close')}>
      <div className="space-y-6">
        <fieldset>
          <legend className="text-sm font-medium">{t('web.prefs.appearance')}</legend>
          <p className="mt-0.5 text-xs text-zinc-500">{t('web.prefs.appearanceHint')}</p>
          <div role="radiogroup" className="mt-3 grid grid-cols-3 gap-px border border-zinc-300 bg-zinc-300">
            {modes.map((m) => (
              <button
                key={m.v}
                type="button"
                role="radio"
                aria-checked={p.colorMode === m.v}
                onClick={() => save.mutate({ colorMode: m.v })}
                className={cx(
                  'flex flex-col items-center gap-1.5 py-3 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
                  p.colorMode === m.v ? 'bg-ink text-canvas' : 'bg-snow text-zinc-700 hover:bg-zinc-50',
                )}
              >
                <m.icon className="size-5" strokeWidth={1.75} />
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">{t('web.prefs.language')}</legend>
          <p className="mt-0.5 text-xs text-zinc-500">{t('web.prefs.languageHint')}</p>
          <div className="mt-3 grid gap-px border border-zinc-300 bg-zinc-300 sm:grid-cols-2">
            {[
              {
                code: null,
                label: t('web.prefs.orgDefault', {
                  name: localeName(localization?.defaultLanguage ?? 'en'),
                }),
              },
              ...languages.map((l) => ({ code: l.code as string | null, label: l.nativeName })),
            ].map((l) => (
              <button
                key={l.code ?? 'default'}
                type="button"
                role="radio"
                aria-checked={p.locale === l.code}
                onClick={() => save.mutate({ locale: l.code })}
                lang={l.code ?? undefined}
                className={cx(
                  'px-3 py-2.5 text-start text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
                  p.locale === l.code ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-50',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

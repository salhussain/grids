import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LOCALES } from '@grids/i18n';
import type { LocalizationDto, MeDto } from '@grids/schema';
import { applyColorMode, cx, LanguageMenu, storedColorMode, ThemeToggle } from '@grids/ui';
import { useEffect } from 'react';
import { api } from './api';
import { useI18n } from './i18n';

/** Keeps the page in the person's saved colour mode (also across devices). */
export function useColorModePreference(me: MeDto | undefined) {
  const mode = me?.preferences.colorMode;
  useEffect(() => {
    if (mode && mode !== storedColorMode()) applyColorMode(mode);
  }, [mode]);
  // First paint used the device's cached mode; keep "system" live-following the OS.
  useEffect(() => applyColorMode(storedColorMode()), []);
}

/**
 * Language and appearance, always top right, the same controls as the sign-in
 * page; saved as the person's preferences. Languages are those the organisation
 * offers (all of them outside a workspace).
 */
export function HeaderControls({
  me,
  localization,
  className,
}: {
  me: MeDto;
  localization: LocalizationDto | null;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: api.setPreferences,
    onSuccess: (next) => qc.setQueryData(['me'], next),
  });
  const languages = LOCALES.filter((l) => !localization || localization.languages.includes(l.code));
  const mode = save.variables?.colorMode ?? me.preferences.colorMode;
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <LanguageMenu
        value={locale}
        onChange={(code) => save.mutate({ locale: code })}
        label={t('web.prefs.language')}
        draftLabel={t('common.draftTranslation')}
        options={languages.map((l) => ({
          code: l.code,
          label: l.nativeName,
          draft: l.status === 'draft',
        }))}
      />
      <ThemeToggle
        mode={mode}
        onChange={(m) => {
          applyColorMode(m);
          save.mutate({ colorMode: m });
        }}
        labels={{ toLight: t('web.shell.lightMode'), toDark: t('web.shell.darkMode') }}
      />
    </div>
  );
}

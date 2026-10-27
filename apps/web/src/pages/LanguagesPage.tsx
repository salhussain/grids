import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LOCALES } from '@grids/i18n';
import type { LocalizationDto } from '@grids/schema';
import {
  Button,
  ErrorNotice,
  Input,
  PageHeader,
  Listbox,
  Tag,
  cx,
  Flag,
  useToast,
} from '@grids/ui';
import { Check, Languages as LanguagesIcon, Save, Search, Type } from 'lucide-react';
import { useMemo, useState, type ComponentType } from 'react';
import { api } from '../api';
import { catalogEntries, useT } from '../i18n';
import { NoAccess, useCan, useWorkspace } from '../session';
import { SettingsBlock, SettingsLayout, type SettingsSection } from './SettingsNav';
import { catalogs } from '@grids/i18n';

/** Text people see in the workspace and on the sign-in page, which organisations may reword. */
const EDITABLE = [...catalogEntries('web'), ...catalogEntries('auth'), ...catalogEntries('common')];

const flagIcons = new Map<string, ComponentType<{ className?: string }>>();
/** A language's flag as a menu icon. */
function flagIcon(code: string): ComponentType<{ className?: string }> {
  let c = flagIcons.get(code);
  if (!c) {
    c = () => <Flag code={code} />;
    flagIcons.set(code, c);
  }
  return c;
}

function lookup(locale: string, key: string): string {
  const v = key
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      catalogs[locale as keyof typeof catalogs],
    );
  return typeof v === 'string' ? v : '';
}

export function LanguagesPage() {
  const t = useT();
  const can = useCan();
  const ws = useWorkspace();
  if (!can('languages.manage')) return <NoAccess what={t('web.nav.languages')} />;
  return <LanguagesForm key={ws.tenant.id} initial={ws.localization} />;
}

function LanguagesForm({ initial }: { initial: LocalizationDto }) {
  const t = useT();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<LocalizationDto>(initial);
  const [lang, setLang] = useState(initial.languages[0] ?? 'en');
  const [query, setQuery] = useState('');

  const save = useMutation({
    mutationFn: () => api.setLocalization(ws.tenant.id, draft),
    onSuccess: (saved) => {
      setDraft(saved);
      void qc.invalidateQueries({ queryKey: ['workspace', ws.tenant.id] });
      toast(t('web.languages.saved'));
    },
  });

  const toggle = (code: string) => {
    const on = draft.languages.includes(code);
    if (on && draft.languages.length === 1) return; // keep at least one
    const languages = on
      ? draft.languages.filter((c) => c !== code)
      : LOCALES.map((l) => l.code as string).filter(
          (c) => c === code || draft.languages.includes(c),
        );
    const defaultLanguage = languages.includes(draft.defaultLanguage)
      ? draft.defaultLanguage
      : languages[0]!;
    setDraft({ ...draft, languages, defaultLanguage });
    if (!languages.includes(lang)) setLang(defaultLanguage);
  };

  const overrides = draft.overrides[lang] ?? {};
  const setOverride = (key: string, value: string) => {
    const next = { ...overrides, [key]: value };
    if (!value) delete next[key];
    setDraft({ ...draft, overrides: { ...draft.overrides, [lang]: next } });
  };
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EDITABLE.filter(
      ([key, en]) =>
        !q ||
        key.toLowerCase().includes(q) ||
        en.toLowerCase().includes(q) ||
        lookup(lang, key).toLowerCase().includes(q),
    );
  }, [query, lang]);
  const changed = Object.keys(overrides).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const [tab, setTab] = useState<'languages' | 'wording'>('languages');
  const enabled = LOCALES.filter((l) => draft.languages.includes(l.code));
  const sections: SettingsSection<'languages' | 'wording'>[] = [
    { id: 'languages', label: 'Languages', icon: LanguagesIcon, count: draft.languages.length },
    { id: 'wording', label: 'Wording', icon: Type, count: changed || undefined },
  ];
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.languages.title')}
        meta={<span>{t('web.languages.intro')}</span>}
        actions={
          <>
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => (setDraft(initial), setLang(initial.languages[0] ?? 'en'))}
              >
                Discard changes
              </Button>
            )}
            <Button
              icon={Save}
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!dirty}
            >
              {t('web.languages.save')}
            </Button>
          </>
        }
      />
      <ErrorNotice error={save.error} />
      <SettingsLayout<'languages' | 'wording'>
        label="Languages"
        value={tab}
        onChange={setTab}
        sections={sections}
      >
        <div className="max-w-5xl">
          {tab === 'languages' && (
            <SettingsBlock
              bare
              icon={LanguagesIcon}
              title={t('web.languages.enabled')}
              description={`${t('web.languages.enabledHint')} ${t('web.languages.defaultHint')}`}
            >
              <div className="overflow-x-auto border border-zinc-200 bg-snow">
                <table className="w-full min-w-[34rem] table-fixed text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500">
                    <tr>
                      <th scope="col" className="w-16 py-2 ps-4 text-start font-medium">
                        On
                      </th>
                      <th scope="col" className="py-2 text-start font-medium">
                        Language
                      </th>
                      <th scope="col" className="w-36 py-2 text-start font-medium">
                        Reworded
                      </th>
                      <th scope="col" className="w-40 py-2 pe-4">
                        <span className="sr-only">Default language</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {LOCALES.map((l) => {
                      const on = draft.languages.includes(l.code);
                      const custom = Object.keys(draft.overrides[l.code] ?? {}).length;
                      return (
                        <tr
                          key={l.code}
                          className={cx(
                            'border-t border-zinc-100',
                            on ? 'hover:bg-zinc-50' : 'text-zinc-500',
                          )}
                        >
                          <td className="py-2.5 ps-4">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggle(l.code)}
                              aria-label={`Offer ${l.name}`}
                              className="size-4 accent-[var(--brand-600)]"
                            />
                          </td>
                          <td className="py-2.5">
                            <span className="flex items-center gap-3">
                              <Flag code={l.code} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium" lang={l.code}>
                                  {l.nativeName}
                                </span>
                                <span className="block truncate text-xs text-zinc-500">
                                  {l.name}
                                </span>
                              </span>
                              {on && draft.defaultLanguage === l.code && (
                                <span className="inline-flex items-center gap-1 bg-accent-50 px-1.5 py-0.5 text-xs font-medium text-accent-700 ring-1 ring-accent-600/30">
                                  <Check className="size-3" /> {t('web.languages.default')}
                                </span>
                              )}
                              {l.dir === 'rtl' && <Tag>{t('web.languages.rtl')}</Tag>}
                              {l.status === 'draft' && (
                                <span title={t('web.languages.draftHint')}>
                                  <Tag>{t('web.languages.draft')}</Tag>
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 text-zinc-600">
                            {on && custom > 0 ? (
                              `${custom} phrases`
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pe-4 text-end">
                            {on && draft.defaultLanguage !== l.code && (
                              <button
                                type="button"
                                onClick={() => setDraft({ ...draft, defaultLanguage: l.code })}
                                aria-label={`Make ${l.name} the default`}
                                className="text-xs text-zinc-500 underline-offset-2 hover:text-ink hover:underline"
                              >
                                Make default
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SettingsBlock>
          )}
          {tab === 'wording' && (
            <SettingsBlock
              bare
              icon={Type}
              title={t('web.languages.overrides')}
              description={t('web.languages.overridesHint')}
            >
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Listbox
                  label={t('web.languages.overrideLanguage')}
                  value={lang}
                  onChange={setLang}
                  className="sm:w-56"
                  options={enabled.map((l) => ({
                    value: l.code,
                    label: l.nativeName,
                    icon: flagIcon(l.code),
                  }))}
                />
                <div className="sm:w-72">
                  <Input
                    icon={Search}
                    aria-label={t('web.languages.search')}
                    placeholder={t('web.languages.search')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {changed > 0 && <Tag>{t('web.languages.changed', { count: changed })}</Tag>}
              </div>
              <div className="max-h-[620px] overflow-auto border border-zinc-200 bg-snow">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-zinc-50 text-start text-xs text-zinc-500">
                    <tr>
                      <th className="px-4 py-2 text-start font-medium">
                        {t('web.languages.standard')}
                      </th>
                      <th className="w-1/2 px-4 py-2 text-start font-medium">
                        {t('web.languages.yours')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([key]) => {
                      const standard = lookup(lang, key) || lookup('en', key);
                      return (
                        <tr key={key} className="border-t border-zinc-100 align-top">
                          <td className="px-4 py-2.5">
                            <div lang={lang}>{standard}</div>
                            <div className="mt-0.5 font-mono text-[11px] text-zinc-400" dir="ltr">
                              {key}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              aria-label={`${t('web.languages.yours')}: ${key}`}
                              value={overrides[key] ?? ''}
                              placeholder={standard}
                              lang={lang}
                              onChange={(e) => setOverride(key, e.target.value)}
                              className={cx(overrides[key] && 'border-accent-600')}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {!rows.length && (
                      <tr>
                        <td colSpan={2} className="px-4 py-8 text-center text-zinc-500">
                          Nothing matches.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SettingsBlock>
          )}
        </div>
      </SettingsLayout>
    </>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LOCALES } from '@grids/i18n';
import type { LocalizationDto } from '@grids/schema';
import {
  Button,
  ErrorNotice,
  Input,
  PageHeader,
  Panel,
  Select,
  Tag,
  cx,
  useToast,
} from '@grids/ui';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { catalogEntries, useT } from '../i18n';
import { NoAccess, useCan, useWorkspace } from '../session';
import { catalogs } from '@grids/i18n';

/** Text people see in the workspace and on the sign-in page, which organisations may reword. */
const EDITABLE = [...catalogEntries('web'), ...catalogEntries('auth'), ...catalogEntries('common')];

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
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.languages.title')}
        meta={<span>{t('web.languages.intro')}</span>}
      />
      <LanguagesForm key={ws.tenant.id} initial={ws.localization} />
    </>
  );
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

  return (
    <div className="space-y-6">
      <ErrorNotice error={save.error} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={t('web.languages.enabled')}>
          <p className="mb-4 text-sm text-zinc-500">{t('web.languages.enabledHint')}</p>
          <ul className="grid gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-2">
            {LOCALES.map((l) => {
              const on = draft.languages.includes(l.code);
              return (
                <li key={l.code} className="bg-snow">
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(l.code)}
                      className="size-4 accent-[var(--brand-600)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium" lang={l.code}>
                        {l.nativeName}
                      </span>
                      <span className="block text-xs text-zinc-500">{l.name}</span>
                    </span>
                    {l.dir === 'rtl' && <Tag>{t('web.languages.rtl')}</Tag>}
                    {l.status === 'draft' && (
                      <span title={t('web.languages.draftHint')}>
                        <Tag>{t('web.languages.draft')}</Tag>
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title={t('web.languages.default')}>
          <p className="mb-4 text-sm text-zinc-500">{t('web.languages.defaultHint')}</p>
          <Select
            aria-label={t('web.languages.default')}
            value={draft.defaultLanguage}
            onChange={(e) => setDraft({ ...draft, defaultLanguage: e.target.value })}
          >
            {LOCALES.filter((l) => draft.languages.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </Select>
        </Panel>
      </div>

      <Panel
        flush
        title={t('web.languages.overrides')}
        actions={
          changed > 0 ? <Tag>{t('web.languages.changed', { count: changed })}</Tag> : undefined
        }
      >
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-zinc-500">{t('web.languages.overridesHint')}</p>
          <Select
            aria-label={t('web.languages.overrideLanguage')}
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="sm:w-48"
          >
            {LOCALES.filter((l) => draft.languages.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </Select>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              aria-label={t('web.languages.search')}
              placeholder={t('web.languages.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="ps-8"
            />
          </div>
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-start text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t('web.languages.standard')}</th>
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
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-zinc-200 bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          {t('web.languages.save')}
        </Button>
      </div>
    </div>
  );
}

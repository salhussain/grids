import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EMAIL_MESSAGES, type EmailMessageSettings, type EmailSettings } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, PageHeader, Select, Textarea, cx, useToast } from '@grids/ui';
import { ChevronDown, Mail, Plus, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { NoAccess, useCan, useWorkspace } from '../session';
import { SettingsBlock } from './SettingsNav';

const FONT_LABEL = { sans: 'Sans-serif', system: 'System', serif: 'Serif' } as const;
const EMPTY_MESSAGE: EmailMessageSettings = { subjectPrefix: '', intro: '', outro: '' };
const touched = (m: EmailMessageSettings | undefined) => !!m && (!!m.subjectPrefix || !!m.intro || !!m.outro);

/** The emails an organisation sends: who they come from, how they look, and what it adds to each kind. */
export function EmailPage() {
  const t = useT();
  const can = useCan();
  const ws = useWorkspace();
  if (!can('branding.manage')) return <NoAccess what={t('web.nav.email')} />;
  return <EmailForm key={ws.tenant.id} />;
}

function EmailForm() {
  const t = useT();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<EmailSettings>(ws.theme.email);
  const [open, setOpen] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(ws.theme.email);
  const set = (patch: Partial<EmailSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation({
    mutationFn: () => api.setTheme(ws.tenant.id, { ...ws.theme, email: draft }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workspace', ws.tenant.id] });
      toast('Email settings saved');
    },
  });
  const test = useMutation({
    mutationFn: () => api.emailTest(ws.tenant.id, { settings: draft, message: open }),
    onSuccess: (r) => toast(r.sent ? `A test email is on its way to ${r.to}` : 'The test email could not be sent'),
  });

  // The preview follows the draft, a moment after the last change.
  const [settled, setSettled] = useState(draft);
  useEffect(() => {
    const id = setTimeout(() => setSettled(draft), 400);
    return () => clearTimeout(id);
  }, [draft]);
  const preview = useQuery({
    queryKey: ['email-preview', ws.tenant.id, JSON.stringify(settled), open],
    queryFn: () => api.emailPreview(ws.tenant.id, { settings: settled, message: open }),
    placeholderData: (prev) => prev,
    retry: false,
  });

  const groups = useMemo(() => [...new Set(EMAIL_MESSAGES.map((m) => m.group))], []);
  const setMessage = (key: string, patch: Partial<EmailMessageSettings>) =>
    set({ messages: { ...draft.messages, [key]: { ...EMPTY_MESSAGE, ...draft.messages[key], ...patch } } });
  const setLink = (i: number, patch: Partial<EmailSettings['links'][number]>) => set({ links: draft.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.nav.email')}
        meta={<span>How emails from {ws.tenant.name} look and who they appear to come from.</span>}
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(ws.theme.email)}>
                Discard changes
              </Button>
            )}
            <Button variant="secondary" icon={Send} loading={test.isPending} onClick={() => test.mutate()}>
              Send me a test
            </Button>
            <Button icon={Save} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      />
      <ErrorNotice error={save.error ?? test.error} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <div className="min-w-0">
          <SettingsBlock title="Sender" description="Who the emails appear to come from, and where replies go.">
            <Field label="Sender name" intro={`Shown as the name on the email. ${ws.theme.appName || ws.tenant.name} when empty`}>
              <Input value={draft.fromName} maxLength={60} onChange={(e) => set({ fromName: e.target.value })} />
            </Field>
            <Field label="Reply-to address" intro="Where replies go. The platform’s address when empty">
              <Input type="email" value={draft.replyTo} maxLength={200} placeholder="help@example.org" onChange={(e) => set({ replyTo: e.target.value.trim() })} />
            </Field>
          </SettingsBlock>

          <SettingsBlock title="Header" description="The strip at the top of every email.">
            <div role="radiogroup" aria-label="Email header" className="grid max-w-xl grid-cols-3 gap-3">
              {(
                [
                  ['logo', 'Logo', 'Your logo on a thin line'],
                  ['colour', 'Colour bar', 'The name on a coloured bar'],
                  ['none', 'None', 'Straight into the message'],
                ] as const
              ).map(([id, label, note]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={draft.header === id}
                  onClick={() => set({ header: id })}
                  className={cx('border p-2 text-start', draft.header === id ? 'border-accent-600 bg-accent-50' : 'border-zinc-200 hover:border-zinc-400')}
                >
                  <span className="block border border-zinc-200 bg-snow">
                    {id === 'colour' ? <i className="block h-5 bg-accent-600" /> : id === 'logo' ? <i className="block h-5 border-b-[3px] border-accent-600" /> : <i className="block h-1" />}
                    <i className="m-2 block h-1.5 bg-zinc-200" />
                    <i className="m-2 block h-1.5 w-2/3 bg-zinc-200" />
                  </span>
                  <span className="mt-2 block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-zinc-500">{note}</span>
                </button>
              ))}
            </div>
            {draft.header !== 'none' && (
              <Segmented label="Alignment" value={draft.headerAlign} onChange={(headerAlign) => set({ headerAlign })} options={[['left', 'Left'], ['center', 'Centre']]} />
            )}
            <p className="text-xs text-zinc-500">The logo, name and brand colour come from Branding.</p>
          </SettingsBlock>

          <SettingsBlock title="Look" description="Colours, type and shape of the message.">
            <div className="grid gap-5 sm:grid-cols-2">
              <ColourField label="Page colour" hint="Behind the message" value={draft.pageColor} onChange={(pageColor) => set({ pageColor })} />
              <ColourField label="Text colour" value={draft.textColor} onChange={(textColor) => set({ textColor })} />
              <ColourField
                label="Accent colour"
                hint="Links, the header line and bar"
                value={draft.accentColor ?? ws.theme.primaryColor}
                onChange={(accentColor) => set({ accentColor })}
                reset={draft.accentColor ? { label: 'Use the workspace colour', onClick: () => set({ accentColor: null }) } : undefined}
              />
              <Field label="Font">
                <Select aria-label="Font" value={draft.font} onChange={(e) => set({ font: e.target.value as EmailSettings['font'] })}>
                  {Object.entries(FONT_LABEL).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Width" intro="In pixels">
                <Select aria-label="Width" value={String(draft.width)} onChange={(e) => set({ width: Number(e.target.value) })}>
                  {[480, 520, 560, 600, 640, 680, 720].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              </Field>
              <Segmented label="Corners" value={draft.corners} onChange={(corners) => set({ corners })} options={[['square', 'Square'], ['soft', 'Soft']]} />
            </div>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--brand-600)]" checked={draft.card} onChange={(e) => set({ card: e.target.checked })} />
              <span>
                <span className="block text-sm font-medium">Message on a white card</span>
                <span className="block text-xs text-zinc-500">Off puts the words straight on the page colour.</span>
              </span>
            </label>
          </SettingsBlock>

          <SettingsBlock title="Sign-off and footer" description="Closing words after every message, and what sits underneath.">
            <Field label="Sign-off" intro="Such as “Warm regards, The team”">
              <Textarea value={draft.signature} maxLength={400} className="min-h-16" onChange={(e) => set({ signature: e.target.value })} />
            </Field>
            <Field label="Footer" intro="An address, a registration number or a short note">
              <Textarea value={draft.footer} maxLength={300} className="min-h-16" onChange={(e) => set({ footer: e.target.value })} />
            </Field>
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-zinc-700">Links</div>
              <ul className="space-y-2">
                {draft.links.map((l, i) => (
                  <li key={i} className="grid grid-cols-[10rem_1fr_auto] gap-2">
                    <Input aria-label="Link text" placeholder="Help centre" value={l.label} maxLength={40} onChange={(e) => setLink(i, { label: e.target.value })} />
                    <Input aria-label="Link address" placeholder="https://example.org/help" value={l.url} onChange={(e) => setLink(i, { url: e.target.value.trim() })} />
                    <button type="button" aria-label={`Remove ${l.label || 'link'}`} className="p-2 text-zinc-500 hover:text-red-700" onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })}>
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <Button variant="secondary" size="sm" icon={Plus} className="mt-2" disabled={draft.links.length >= 4} onClick={() => set({ links: [...draft.links, { label: '', url: 'https://' }] })}>
                Add a link
              </Button>
            </div>
          </SettingsBlock>

          <SettingsBlock title="Messages" description="Add words to one kind of message, or mark its subject. Pick a message to see it on the right.">
            {groups.map((g) => (
              <div key={g}>
                <div className="mb-1.5 font-mono text-[11px] tracking-[0.1em] text-zinc-500 uppercase">{g}</div>
                <ul className="divide-y divide-zinc-100 border border-zinc-200">
                  {EMAIL_MESSAGES.filter((m) => m.group === g).map((m) => {
                    const on = open === m.key;
                    const cur = draft.messages[m.key] ?? EMPTY_MESSAGE;
                    return (
                      <li key={m.key}>
                        <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : m.key)} className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-zinc-50', on && 'bg-accent-50')}>
                          <Mail className="size-4 shrink-0 text-zinc-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{m.label}</span>
                            <span className="block truncate text-xs text-zinc-500">{m.about}</span>
                          </span>
                          {touched(draft.messages[m.key]) && <span className="bg-accent-50 px-1.5 py-0.5 text-[11px] text-accent-700">Customised</span>}
                          <ChevronDown className={cx('size-4 text-zinc-400 transition-transform', on && 'rotate-180')} />
                        </button>
                        {on && (
                          <div className="space-y-4 border-t border-zinc-100 bg-snow p-4">
                            <Field label="Subject mark" intro="Put before the subject, such as [Acme]">
                              <Input value={cur.subjectPrefix} maxLength={40} onChange={(e) => setMessage(m.key, { subjectPrefix: e.target.value })} />
                            </Field>
                            <Field label="Words before" intro="Shown above the message">
                              <Textarea value={cur.intro} maxLength={600} className="min-h-16" onChange={(e) => setMessage(m.key, { intro: e.target.value })} />
                            </Field>
                            <Field label="Words after" intro="Shown below the message">
                              <Textarea value={cur.outro} maxLength={600} className="min-h-16" onChange={(e) => setMessage(m.key, { outro: e.target.value })} />
                            </Field>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </SettingsBlock>
        </div>

        <aside className="xl:sticky xl:top-20">
          <div className="border border-zinc-200 bg-snow">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
              <span className="text-xs font-medium text-zinc-600">Preview</span>
              <span className="flex-1" />
              <Select aria-label="Message to preview" className="max-w-56" value={open ?? ''} onChange={(e) => setOpen(e.target.value || null)}>
                <option value="">A sample message</option>
                {EMAIL_MESSAGES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500">
              <span className="text-zinc-400">From</span> {draft.fromName || ws.theme.appName || ws.tenant.name}
              {draft.replyTo && <> · <span className="text-zinc-400">Reply to</span> {draft.replyTo}</>}
              <div className="mt-0.5 truncate text-sm font-medium text-ink">{preview.data?.subject ?? ' '}</div>
            </div>
            {preview.error ? (
              <div className="p-4">
                <ErrorNotice error={preview.error} />
              </div>
            ) : (
              <iframe title="Email preview" sandbox="" srcDoc={preview.data?.html ?? ''} className={cx('h-[640px] w-full bg-white transition-opacity', preview.isFetching && 'opacity-60')} />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange(v: T): void; options: readonly (readonly [T, string])[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-zinc-700">{label}</div>
      <div role="radiogroup" aria-label={label} className="inline-flex border border-zinc-300">
        {options.map(([id, name]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={cx('h-9 px-3.5 text-sm', value === id ? 'bg-accent-600 font-medium text-on-accent' : 'bg-snow text-zinc-700 hover:bg-zinc-50')}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColourField({ label, hint, value, onChange, reset }: { label: string; hint?: ReactNode; value: string; onChange(v: string): void; reset?: { label: string; onClick(): void } }) {
  return (
    <Field label={label} intro={hint}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 shrink-0 border border-zinc-300 bg-snow" />
        <Input aria-label={label} value={value} className="font-mono" maxLength={7} onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && onChange(e.target.value)} />
        {reset && (
          <button type="button" className="shrink-0 text-xs text-accent-700 hover:underline" onClick={reset.onClick}>
            {reset.label}
          </button>
        )}
      </div>
    </Field>
  );
}

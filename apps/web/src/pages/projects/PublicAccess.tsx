import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicProblems } from '@grids/forms';
import { LOCALES } from '@grids/i18n';
import { PROJECT_SUBJECT, type FormLinkDto, type FormSettings } from '@grids/schema';
import {
  Button,
  DateTimePicker,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Listbox,
  Switch,
  Textarea,
  confirmDialog,
  cx,
  relTime,
  useToast,
} from '@grids/ui';
import {
  Check,
  Copy,
  Download,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../api';
import type { Draft } from './FormBuilder';
import { useProject } from './context';

/** The two ways to invite: the dialog starts with this choice, and shows the rest once one is picked. */
const INVITE_KINDS = [
  {
    id: 'one' as const,
    title: 'One person',
    text: 'Type their name and email. They get a link of their own',
    icon: UserPlus,
  },
  {
    id: 'many' as const,
    title: 'Several people',
    text: 'Paste a list, or import a CSV file with a name and email on each row',
    icon: Users,
  },
];

const urlOf = (path: string) => `${window.location.origin}/f/${path}`;

/** A setting with its switch at the end of the row. */
function Line({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className={cx('flex items-center justify-between gap-4 py-3', disabled && 'opacity-60')}>
      <div className="min-w-0 text-sm leading-tight">
        <div className="font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{description}</div>
      </div>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** Copies a link and says so for a moment. */
function CopyButton({ text, label = 'Copy link' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* the browser would not let us */
        }
      }}
      className="flex size-8 shrink-0 items-center justify-center border border-zinc-300 bg-snow text-zinc-600 hover:border-zinc-500 hover:text-ink"
    >
      {done ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
    </button>
  );
}

/**
 * What fills in a form through a link, for people without an account: one shared link, and single-use invites.
 * Shown when the form's fill-in permission is the project's Public permission; its options are saved with the
 * form, and the links themselves are made and withdrawn here at once.
 */
export function PublicAccessFields({
  draft,
  setSettings,
  formKey,
  subjectType,
  part,
}: {
  draft: Draft;
  setSettings(patch: Partial<FormSettings>): void;
  formKey: string;
  subjectType: { key: string; name: string } | null;
  /** `settings`: how the link works, and the open link. `invites`: the single-use links, one per person. */
  part: 'settings' | 'invites';
}) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const pa = draft.settings.publicAccess;
  const setPa = (patch: Partial<typeof pa>) => setSettings({ publicAccess: { ...pa, ...patch } });
  const blocked = publicProblems(draft.def);
  // How the open link works is part of "Publicly available"; invitations show only what invitations need.
  const showSettings = part === 'settings';
  const linksOn = pa.enabled || pa.inviteOnly;
  // A form about a place needs to know which place each link is for.
  const needsPlace = !!subjectType && subjectType.key !== PROJECT_SUBJECT;
  const [place, setPlace] = useState<string | null>(null);
  // The language the links open the form in; blank leaves it to each person (their browser's, else the form's own).
  const [language, setLanguage] = useState<string | null>(null);
  const languageOptions = [
    {
      value: '__any',
      label: 'Each person chooses',
      description: 'Their browser’s language, else the form’s own',
    },
    ...LOCALES.map((l) => ({ value: l.code as string, label: l.nativeName, description: l.name })),
  ];
  const places = useQuery({
    queryKey: ['link-places', tenantId, project.key, subjectType?.key],
    queryFn: () => api.entities(tenantId, project.key, { type: subjectType!.key, pageSize: 200 }),
    enabled: needsPlace && linksOn,
  });
  const links = useQuery({
    queryKey: ['form-links', tenantId, project.key, formKey],
    queryFn: () => api.formLinks(tenantId, project.key, formKey),
    enabled: linksOn,
  });
  const put = (next: FormLinkDto[]) =>
    qc.setQueryData(['form-links', tenantId, project.key, formKey], next);
  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.createFormLinks>[3]) =>
      api.createFormLinks(tenantId, project.key, formKey, input),
    onSuccess: put,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeFormLink(tenantId, project.key, formKey, id),
    onSuccess: put,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; input: Parameters<typeof api.updateFormLink>[4] }) =>
      api.updateFormLink(tenantId, project.key, formKey, v.id, v.input),
    onSuccess: put,
  });
  // The invite being edited: how many times it can be used, and its own dates.
  const [editing, setEditing] = useState<FormLinkDto | null>(null);
  const [eUses, setEUses] = useState('1');
  const [eOpens, setEOpens] = useState('');
  const [eCloses, setECloses] = useState('');
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState('');
  // The invite being made: one person or a list, who they are, and any access of their own.
  const [mode, setMode] = useState<'one' | 'many' | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [email2, setEmail2] = useState('');
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [uses, setUses] = useState('1');
  const [mailThem, setMailThem] = useState(true);
  const file = useRef<HTMLInputElement>(null);

  const all = links.data ?? [];
  const shared = all.find((l) => l.kind === 'shared' && !l.revoked);
  const invites = all.filter((l) => l.kind === 'invite');
  const placeId = needsPlace ? place : null;

  const parse = () =>
    lines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((l) => {
        const parts = l.split(',').map((x) => x.trim());
        const email = parts.find((x) => /^\S+@\S+\.\S+$/.test(x)) ?? null;
        const label = parts.filter((x) => x !== email).join(' ') || email || '';
        return { label, email };
      });
  const EMAIL = /^\S+@\S+\.\S+$/;
  const people =
    mode === 'one'
      ? name.trim() || email.trim()
        ? [{ label: name.trim() || email.trim(), email: email.trim() || null }]
        : []
      : mode === 'many'
        ? parse()
        : [];
  const emailsDiffer =
    mode === 'one' && !!email.trim() && email.trim().toLowerCase() !== email2.trim().toLowerCase();
  const badEmail = mode === 'one' && !!email.trim() && !EMAIL.test(email.trim());
  // Someone who already has a live invite is not invited again.
  const heldEmails = new Set(
    invites.filter((l) => !l.revoked && l.email).map((l) => l.email!.toLowerCase()),
  );
  const again = people
    .filter((p) => p.email && heldEmails.has(p.email.toLowerCase()))
    .map((p) => p.email!);
  const usesN = Math.floor(Number(uses));
  const datesWrong = !!opens && !!closes && closes <= opens;
  const canCreate =
    !!mode &&
    people.length > 0 &&
    !emailsDiffer &&
    !badEmail &&
    !datesWrong &&
    usesN >= 1 &&
    usesN <= 1000;
  const reset = () => {
    setMode(null);
    setName('');
    setEmail('');
    setEmail2('');
    setLines('');
    setOpens('');
    setCloses('');
    setUses('1');
  };
  /** A CSV file of people (a name and an email per row; a header row is fine) becomes the list to invite. */
  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const cells = (line: string) =>
      [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)]
        .slice(0, -1)
        .map((m) => m[1]!.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    const rows = (await f.text())
      .replace(/^\ufeff/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map(cells);
    const head = rows[0]?.map((c) => c.toLowerCase()) ?? [];
    const hasHead = head.includes('email');
    const data = hasHead ? rows.slice(1) : rows;
    const ie = hasHead ? head.indexOf('email') : -1;
    const iname = hasHead ? head.indexOf('name') : -1;
    setLines(
      data
        .map((r) => {
          const mail = ie >= 0 ? r[ie] : r.find((c) => EMAIL.test(c));
          const who = iname >= 0 ? r[iname] : r.filter((c) => c !== mail).join(' ');
          return [who, mail].filter(Boolean).join(', ');
        })
        .filter(Boolean)
        .slice(0, 200)
        .join('\n'),
    );
    setMode('many');
  };
  const exportCsv = () => {
    const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [
      ['name', 'email', 'link', 'status'],
      ...invites.map((l) => [
        l.label,
        l.email ?? '',
        urlOf(l.path),
        l.revoked ? 'revoked' : l.uses >= (l.maxUses ?? Infinity) ? 'used' : 'unused',
      ]),
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([`\ufeff${rows.map((r) => r.map(q).join(',')).join('\n')}`], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    a.download = `${formKey}-invites.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      {showSettings && (
        <div className="divide-y divide-zinc-100">
          {showSettings && (
            <>
              <Line
                label="Ask for a name or email"
                description="So the people reading the answers know who sent them"
                checked={pa.askName || pa.verifyEmail}
                onChange={(askName) => setPa({ askName })}
                disabled={pa.verifyEmail}
              />
              <Line
                label="Check their email address"
                description="They give an email address and enter a one-time code we send to it before they can submit. The code works once and expires in 10 minutes"
                checked={pa.verifyEmail}
                onChange={(verifyEmail) => setPa({ verifyEmail })}
              />
              <Line
                label="Check that a person is sending"
                description="A short puzzle the browser solves by itself, to keep bots out. Nothing for people to click"
                checked={pa.captcha}
                onChange={(captcha) => setPa({ captcha })}
              />
              <div className="grid items-start gap-x-8 gap-y-2 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div>
                  <div className="text-[13px] font-medium text-zinc-700">
                    Most sends from one address
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Per hour, across all of this form’s links
                  </p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  aria-label="Most sends from one address per hour"
                  value={pa.perIpPerHour}
                  onChange={(e) =>
                    setPa({
                      perIpPerHour: Math.min(
                        1000,
                        Math.max(1, Math.floor(Number(e.target.value)) || 1),
                      ),
                    })
                  }
                />
              </div>
            </>
          )}
        </div>
      )}
      {showSettings && blocked.length > 0 && (
        <div className="border-s-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900">
          <b>This form cannot be public yet.</b> People without an account cannot answer these:
          <ul className="mt-1 list-disc ps-5">
            {blocked.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {linksOn && (
        <>
          {showSettings && (
            <p className="border-t border-zinc-100 pt-5 text-xs text-zinc-500">
              Answers sent this way follow the form’s workflow like any other submission, and are
              marked as coming from a link. The form’s dates and limits still apply.
            </p>
          )}
          {needsPlace && part === 'settings' && !pa.inviteOnly && (
            <div className="grid items-start gap-x-8 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <div className="text-[13px] font-medium text-zinc-700">
                  Place these links are for
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  This form is about a {subjectType!.name.toLowerCase()}. Pick one and each new link
                  belongs to it, or leave it open and each person chooses the{' '}
                  {subjectType!.name.toLowerCase()} on the form
                </p>
              </div>
              <Listbox
                label="Place"
                searchable
                value={place ?? '__any'}
                placeholder="Each person chooses"
                options={[
                  { value: '__any', label: 'Each person chooses' },
                  ...(places.data?.items ?? []).map((e) => ({
                    value: e.id,
                    label: e.name,
                    description: e.code,
                  })),
                ]}
                onChange={(v) => setPlace(v === '__any' ? null : v)}
              />
            </div>
          )}
          <ErrorNotice error={links.error ?? revoke.error} />

          {part === 'settings' && pa.inviteOnly && (
            <p className="text-xs text-zinc-500">
              The open link is off while the form is by invitation only.
            </p>
          )}
          {part === 'settings' && !pa.inviteOnly && (
            <div className="grid items-start gap-x-8 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <div className="text-[13px] font-medium text-zinc-700">Language</div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  The language the link opens the form in. “Each person chooses” uses their
                  browser’s language, else the form’s own
                </p>
              </div>
              <Listbox
                label="Language of the open link"
                searchable
                value={language ?? '__any'}
                options={languageOptions}
                onChange={(v) => setLanguage(v === '__any' ? null : v)}
              />
            </div>
          )}
          {part === 'settings' && !pa.inviteOnly && (
            <div className="space-y-2 border-t border-zinc-100 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-zinc-700">Open link</div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    One address anyone can open. Making a new one switches the old one off
                  </p>
                </div>
                {shared ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={RefreshCw}
                    loading={create.isPending}
                    onClick={async () => {
                      if (
                        await confirmDialog(
                          'Replace the shared link? The old one will stop working at once.',
                          { confirmLabel: 'Replace', danger: true },
                        )
                      )
                        create.mutate({ kind: 'shared', entityId: placeId, language });
                    }}
                  >
                    New link
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    icon={Link2}
                    loading={create.isPending}
                    onClick={() => create.mutate({ kind: 'shared', entityId: placeId, language })}
                  >
                    Create the link
                  </Button>
                )}
              </div>
              {shared && (
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    aria-label="Shared link"
                    value={urlOf(shared.path)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-8 min-w-0 flex-1 border border-zinc-300 bg-zinc-50 px-3 font-mono text-xs"
                  />
                  <CopyButton text={urlOf(shared.path)} />
                  <button
                    type="button"
                    aria-label="Switch the shared link off"
                    title="Switch off"
                    onClick={async () => {
                      if (
                        await confirmDialog(
                          'Switch the shared link off? Anyone using it will see that it no longer works.',
                          { confirmLabel: 'Switch off', danger: true },
                        )
                      )
                        revoke.mutate(shared.id);
                    }}
                    className="flex size-8 shrink-0 items-center justify-center border border-zinc-300 bg-snow text-zinc-600 hover:border-zinc-500 hover:text-red-700"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
              {shared && (
                <p className="text-xs text-zinc-500">
                  {shared.entity ? `For ${shared.entity.name}. ` : ''}Opened{' '}
                  {shared.uses.toLocaleString()} {shared.uses === 1 ? 'time' : 'times'} to send
                  {shared.lastUsedAt ? `, last ${relTime(shared.lastUsedAt)}` : ''}.
                </p>
              )}
            </div>
          )}

          {part === 'invites' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-zinc-700">Invites</div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    One link per person. Each works once, unless you give it more uses
                  </p>
                </div>
                <div className="flex gap-2">
                  {invites.length > 0 && (
                    <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv}>
                      Export
                    </Button>
                  )}
                  <Button
                    size="sm"
                    icon={UserPlus}
                    onClick={() => (create.reset(), setMode(null), setAdding(true))}
                  >
                    Add an invite
                  </Button>
                </div>
              </div>
              {invites.length === 0 ? (
                <p className="border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">
                  No invites yet.
                </p>
              ) : (
                <div className="overflow-x-auto border border-zinc-200">
                  <table className="w-full text-[13px]">
                    <thead className="bg-zinc-50 text-start text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-start">Person</th>
                        <th className="px-3 py-2 text-start">Status</th>
                        <th className="px-3 py-2 text-end">Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {invites.map((l) => {
                        const used = l.maxUses !== null && l.uses >= l.maxUses;
                        return (
                          <tr key={l.id}>
                            <td className="px-3 py-2">
                              <div className="font-medium">{l.label || l.email || 'Unnamed'}</div>
                              {l.email && l.label && (
                                <div className="text-xs text-zinc-500">{l.email}</div>
                              )}
                              {l.entity && (
                                <div className="text-xs text-zinc-500">{l.entity.name}</div>
                              )}
                              {l.language && (
                                <div className="text-xs text-zinc-500">
                                  {LOCALES.find((x) => x.code === l.language)?.nativeName ??
                                    l.language}
                                </div>
                              )}
                              {(l.opensAt || l.closesAt || (l.maxUses ?? 1) > 1) && (
                                <div className="text-xs text-zinc-500">
                                  {l.opensAt ? `Opens ${l.opensAt.replace('T', ' ')}` : ''}
                                  {l.opensAt && l.closesAt ? ' · ' : ''}
                                  {l.closesAt ? `Closes ${l.closesAt.replace('T', ' ')}` : ''}
                                  {(l.opensAt || l.closesAt) && (l.maxUses ?? 1) > 1 ? ' · ' : ''}
                                  {(l.maxUses ?? 1) > 1 ? `Up to ${l.maxUses} uses` : ''}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={cx(
                                  'inline-flex h-[22px] items-center px-2 text-xs font-medium',
                                  l.revoked
                                    ? 'bg-zinc-100 text-zinc-600'
                                    : used
                                      ? 'bg-emerald-100 text-emerald-900'
                                      : 'bg-amber-100 text-amber-900',
                                )}
                              >
                                {l.revoked ? 'Revoked' : used ? 'Used' : 'Unused'}
                              </span>
                              {used && l.lastUsedAt && (
                                <span className="ms-2 text-xs text-zinc-500">
                                  {relTime(l.lastUsedAt)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                {!l.revoked && (
                                  <button
                                    type="button"
                                    aria-label={`Edit the invite for ${l.label || l.email || 'this person'}`}
                                    title="Edit: more uses, or dates of its own"
                                    onClick={() => {
                                      update.reset();
                                      setEditing(l);
                                      setEUses(String(l.maxUses ?? 1));
                                      setEOpens(l.opensAt ?? '');
                                      setECloses(l.closesAt ?? '');
                                    }}
                                    className="flex size-8 shrink-0 items-center justify-center border border-zinc-300 bg-snow text-zinc-600 hover:border-zinc-500 hover:text-ink"
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                )}
                                {!l.revoked && !used && <CopyButton text={urlOf(l.path)} />}
                                {!l.revoked && !used && (
                                  <button
                                    type="button"
                                    aria-label={`Revoke the link for ${l.label || l.email || 'this person'}`}
                                    title="Revoke"
                                    onClick={() => revoke.mutate(l.id)}
                                    className="flex size-8 shrink-0 items-center justify-center border border-zinc-300 bg-snow text-zinc-600 hover:border-zinc-500 hover:text-red-700"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an invite"
        description="Each person gets a link of their own."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              icon={Plus}
              loading={create.isPending}
              disabled={!canCreate}
              onClick={() =>
                create.mutate(
                  {
                    kind: 'invite',
                    entityId: placeId,
                    language,
                    invites: people,
                    opensAt: opens || null,
                    closesAt: closes || null,
                    maxUses: usesN,
                    sendEmail: mailThem && people.some((p) => p.email),
                  },
                  {
                    onSuccess: () => {
                      toast(`${people.length} invite${people.length === 1 ? '' : 's'} created`);
                      setAdding(false);
                      reset();
                    },
                  },
                )
              }
            >
              Create {people.length > 1 ? `${people.length} links` : 'the link'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <ErrorNotice error={create.error} />
          {mode === null ? (
            <div
              role="radiogroup"
              aria-label="Who is the invite for"
              className="grid gap-3 sm:grid-cols-2"
            >
              {INVITE_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={false}
                  onClick={() => setMode(k.id)}
                  className="flex flex-col items-start gap-2 border border-zinc-300 bg-snow p-4 text-start hover:border-accent-600 hover:bg-accent-50/40"
                >
                  <span className="flex size-9 items-center justify-center bg-accent-50 text-accent-700">
                    <k.icon className="size-5" />
                  </span>
                  <span className="text-sm font-semibold">{k.title}</span>
                  <span className="text-xs text-zinc-500">{k.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              {(() => {
                const k = INVITE_KINDS.find((x) => x.id === mode)!;
                return (
                  <>
                    <span className="flex size-8 shrink-0 items-center justify-center bg-accent-600 text-on-accent">
                      <k.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{k.title}</span>
                      <span className="block text-xs text-zinc-500">{k.text}</span>
                    </span>
                  </>
                );
              })()}
              <button
                type="button"
                className="text-xs font-medium text-accent-700 hover:underline"
                onClick={() => setMode(null)}
              >
                Change
              </button>
            </div>
          )}

          {mode && (
            <>
              {mode === 'one' ? (
                <>
                  <Field label="Name" intro="Who the invite is for">
                    <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field
                    label="Email"
                    intro="Where to send the link"
                    error={
                      badEmail
                        ? 'That is not a valid email address'
                        : again.length
                          ? 'This person has already been invited'
                          : undefined
                    }
                  >
                    <Input
                      type="email"
                      autoComplete="off"
                      value={email}
                      maxLength={200}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Confirm email"
                    intro="Type it again to be sure"
                    error={emailsDiffer ? 'The two addresses are different' : undefined}
                  >
                    <Input
                      type="email"
                      autoComplete="off"
                      value={email2}
                      maxLength={200}
                      onChange={(e) => setEmail2(e.target.value)}
                      onPaste={(e) => e.preventDefault()}
                    />
                  </Field>
                </>
              ) : (
                <Field
                  label="People"
                  intro="One per line: a name, an email, or both separated by a comma. Up to 200"
                >
                  <div className="space-y-2">
                    <Textarea
                      className="min-h-36 font-mono text-xs"
                      value={lines}
                      onChange={(e) => setLines(e.target.value)}
                      placeholder={'Ana Silva, ana@example.org\nben@example.org\nClinic nurse 3'}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Upload}
                      onClick={() => file.current?.click()}
                    >
                      Import a CSV file
                    </Button>
                    <input
                      ref={file}
                      type="file"
                      accept=".csv,.txt,text/csv"
                      hidden
                      onChange={(e) => (void importCsv(e.target.files?.[0]), (e.target.value = ''))}
                    />
                    {again.length > 0 && (
                      <p className="text-xs text-red-700" role="alert">
                        Already invited: {again.join(', ')}. Remove them from the list, or revoke
                        their invite first.
                      </p>
                    )}
                    <p className="text-xs text-zinc-500">
                      A file with a name and an email on each row, with or without a header row
                      (name, email).
                    </p>
                  </div>
                </Field>
              )}

              {needsPlace && (
                <Field
                  label="Place these links are for"
                  intro={`This form is about a ${subjectType!.name.toLowerCase()}. Pick one and each link belongs to it, or leave it open and each person chooses on the form`}
                >
                  <Listbox
                    label="Place"
                    searchable
                    value={place ?? '__any'}
                    options={[
                      { value: '__any', label: 'Each person chooses' },
                      ...(places.data?.items ?? []).map((e) => ({
                        value: e.id,
                        label: e.name,
                        description: e.code,
                      })),
                    ]}
                    onChange={(v) => setPlace(v === '__any' ? null : v)}
                  />
                </Field>
              )}

              <Field
                label="Language"
                intro="The language the form opens in for these people. They can still change it on the page"
              >
                <Listbox
                  label="Language"
                  searchable
                  value={language ?? '__any'}
                  options={languageOptions}
                  onChange={(v) => setLanguage(v === '__any' ? null : v)}
                />
              </Field>

              <div className="space-y-4 border-t border-zinc-100 pt-5">
                <div>
                  <div className="text-[13px] font-medium text-zinc-700">
                    Access of their own (optional)
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Leave empty to follow the form’s dates and limits. Dates are in{' '}
                    {draft.settings.availability.timezone.replace(/_/g, ' ')} time. Fill any of
                    these to let someone in on different terms, for example to test before the form
                    opens: the form’s own dates and total limit then do not apply to these invites.
                  </p>
                </div>
                <div className="space-y-4">
                  <Field label="Opens">
                    <DateTimePicker value={opens} onChange={setOpens} />
                  </Field>
                  <Field
                    label="Closes"
                    error={datesWrong ? 'It must close after it opens' : undefined}
                  >
                    <DateTimePicker value={closes} onChange={setCloses} />
                  </Field>
                </div>
                <div className="grid items-start gap-x-8 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <div>
                    <div className="text-[13px] font-medium text-zinc-700">
                      Times each link can be used
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      1 to 1000. One person sending the form several times, for example while
                      testing
                    </p>
                  </div>
                  <Input
                    aria-label="Times each link can be used"
                    type="number"
                    min={1}
                    max={1000}
                    value={uses}
                    onChange={(e) => setUses(e.target.value)}
                    className="sm:w-40"
                  />
                </div>
              </div>

              <Line
                label="Email the link to them"
                description="Each person gets their link by email. Otherwise copy each link, or export the list"
                checked={mailThem}
                onChange={setMailThem}
              />
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit invite"
        description={
          editing
            ? `${editing.label || editing.email || 'This invite'}${editing.label && editing.email ? `, ${editing.email}` : ''}`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={update.isPending}
              disabled={
                !editing ||
                !(Math.floor(Number(eUses)) >= Math.max(1, editing.uses)) ||
                (!!eOpens && !!eCloses && eCloses <= eOpens)
              }
              onClick={() =>
                editing &&
                update.mutate(
                  {
                    id: editing.id,
                    input: {
                      maxUses: Math.floor(Number(eUses)),
                      opensAt: eOpens || null,
                      closesAt: eCloses || null,
                    },
                  },
                  { onSuccess: () => (toast('Invite updated'), setEditing(null)) },
                )
              }
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-5">
            <ErrorNotice error={update.error} />
            <Field
              label="Times the link can be used"
              intro={`Used ${editing.uses} of ${editing.maxUses ?? 1} so far. Raise it to let this person send the form again`}
              error={
                Math.floor(Number(eUses)) < editing.uses
                  ? `It has already been used ${editing.uses} ${editing.uses === 1 ? 'time' : 'times'}`
                  : undefined
              }
            >
              <Input
                type="number"
                min={Math.max(1, editing.uses)}
                max={1000}
                value={eUses}
                onChange={(e) => setEUses(e.target.value)}
                className="sm:w-40"
              />
            </Field>
            <div className="space-y-4 border-t border-zinc-100 pt-5">
              <p className="text-xs text-zinc-500">
                Dates of its own, in {draft.settings.availability.timezone.replace(/_/g, ' ')} time.
                Leave both empty to follow the form’s dates. Fill either and the form’s own dates
                and total limit no longer apply to this invite.
              </p>
              <Field label="Opens">
                <DateTimePicker value={eOpens} onChange={setEOpens} />
              </Field>
              <Field
                label="Closes"
                error={
                  !!eOpens && !!eCloses && eCloses <= eOpens
                    ? 'It must close after it opens'
                    : undefined
                }
              >
                <DateTimePicker value={eCloses} onChange={setECloses} />
              </Field>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

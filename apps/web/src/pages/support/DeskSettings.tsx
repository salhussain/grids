import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SUPPORT_STAGES,
  type HelpDeskConfig,
  type SupportCannedReply,
  type SupportLabel,
  type SupportSiteCheck,
  type SupportStage,
} from '@grids/schema';
import {
  Button,
  Dialog,
  PageHeader,
  ErrorNotice,
  Field,
  Input,
  Listbox,
  SectionHead,
  Tabs,
  Loading,
  Textarea,
  cx,
  useToast,
} from '@grids/ui';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Copy,
  Ellipsis,
  Eye,
  Globe2,
  ShieldCheck,
  Download,
  KeyRound,
  Lock,
  Pencil,
  CircleDashed,
  MessageSquareText,
  Plus,
  Search,
  Loader2,
  Settings2,
  Tag,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { api } from '../../api';
import { TOPIC_ICONS, anyIcon, loadAllIcons, topicIcon } from '@grids/viz';
import { useConfirm } from '../../confirm';
import { env } from '../../env';
import { useWorkspace } from '../../session';
import { ToggleLine } from '../projects/PanelCard';
import { KIND_TEXT, REPLY_FIELDS, StageDot, stageIcon, useDesk } from './shared';

const keyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 's_$1')
    .slice(0, 40) || 'item';
const freeKey = (name: string, taken: string[]) => {
  const base = keyOf(name);
  let k = base;
  for (let n = 2; taken.includes(k); n++) k = `${base}_${n}`;
  return k;
};
const SWATCHES = [
  '#e5484d',
  '#f5a623',
  '#30a46c',
  '#0091ff',
  '#8e4ec6',
  '#d12771',
  '#007d79',
  '#6b7280',
];

type Edit =
  | { kind: 'stage'; at: number | null; stage: SupportStage }
  | { kind: 'label'; at: number | null; label: SupportLabel }
  | { kind: 'reply'; at: number | null; reply: SupportCannedReply }
  | { kind: 'topic'; at: number | null; name: string; icon: string }
  | { kind: 'site'; at: number | null; name: string; limit: number; secure: boolean };

/** A section's heading (what it is, one line about it, and the button that adds one), the table under it, and any notes below. */
function Section({
  title,
  intro,
  action,
  foot,
  children,
}: {
  title: string;
  intro: ReactNode;
  action?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <SectionHead title={title} description={intro} actions={action} />
      {children}
      {foot && <div className="flex items-center justify-between gap-3">{foot}</div>}
    </div>
  );
}
function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200">
      <table className="w-full table-fixed text-start text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cx(
                  'py-2 text-start font-medium',
                  i === 0 ? 'ps-3' : 'w-auto',
                  head.length === 2 && i === 0 && 'w-56',
                )}
              >
                {h}
              </th>
            ))}
            <th className="w-28" />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function RowTools({
  label,
  onEdit,
  onDelete,
  onUp,
  onDown,
}: {
  label: string;
  onEdit(): void;
  onDelete(): void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const b =
    'p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';
  const confirm = useConfirm();
  return (
    <td className="py-1 pe-2 align-middle">
      {confirm.dialog}
      <span className="flex justify-end">
        {(onUp || onDown) && (
          <>
            <button
              type="button"
              aria-label={`Move ${label} up`}
              disabled={!onUp}
              onClick={onUp}
              className={b}
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Move ${label} down`}
              disabled={!onDown}
              onClick={onDown}
              className={b}
            >
              <ArrowDown className="size-4" />
            </button>
          </>
        )}
        <button type="button" aria-label={`Edit ${label}`} onClick={onEdit} className={b}>
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={async () =>
            (await confirm.ask({
              title: `Remove ${label}?`,
              message: 'This takes it out of the help desk.',
              confirm: 'Remove',
              danger: true,
            })) && onDelete()
          }
          className={cx(b, 'hover:text-red-700')}
        >
          <Trash2 className="size-4" />
        </button>
      </span>
    </td>
  );
}

const NODE_SAMPLE = `// On the website's server, for each page that shows the help window
import { createHmac } from 'node:crypto';
const payload = Buffer.from(JSON.stringify({
  exp: Math.floor(Date.now() / 1000) + 600,   // valid for 10 minutes (an hour at most)
  name: user.name, email: user.email,         // optional: who the visitor is
})).toString('base64url');
const signature = createHmac('sha256', process.env.GRIDS_HELP_SECRET)
  .update(payload)
  .digest('base64url');
const token = payload + '.' + signature;
// <script src="…/embed.js" data-org="…" data-key="…" data-token="\${token}" async></script>`;
const PY_SAMPLE = `# On the website's server, for each page that shows the help window
import base64, hmac, hashlib, json, os, time
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
payload = b64(json.dumps({'exp': int(time.time()) + 600, 'name': user.name, 'email': user.email}).encode())
key = os.environ['GRIDS_HELP_SECRET'].encode()
token = payload + '.' + b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())`;
const PHP_SAMPLE = `<?php // On the website's server, for each page that shows the help window
function b64url($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
$payload = b64url(json_encode(['exp' => time() + 600, 'name' => $user->name, 'email' => $user->email]));
$signature = b64url(hash_hmac('sha256', $payload, getenv('GRIDS_HELP_SECRET'), true));
$token = $payload . '.' . $signature;`;

/** What a look at a website's DNS found, as a heading bar and a table. */
function DnsResult({ dns, lookError }: { dns: SupportSiteCheck | null; lookError: string | null }) {
  if (!dns && !lookError) return null;
  return (
    <div className="border border-zinc-200 bg-snow text-sm" aria-live="polite">
      {lookError ? (
        <p className="border-s-4 border-accent-600 bg-accent-50 px-4 py-3">{lookError}</p>
      ) : dns!.kind === 'local' ? (
        <p className="border-s-4 border-accent-600 bg-accent-50 px-4 py-3">
          <b>{dns!.name}</b> is a local address: it can show the window while you test, but real
          visitors will not reach it.
        </p>
      ) : !dns!.resolves ? (
        <p className="border-s-4 border-red-500 bg-red-50 px-4 py-3">
          <b>{dns!.name}</b> was not found in DNS. Check the spelling, or add it anyway if it is on
          a private network.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 border-s-4 border-accent-600 bg-accent-50 px-4 py-2.5 font-medium">
            <Check className="size-4 text-accent-700" /> {dns!.name} is a real website
          </div>
          <table className="w-full table-fixed text-[13px]">
            <tbody>
              {(
                [
                  ['Points to', dns!.cname.join(', ')],
                  ['Address', dns!.addresses.join(', ')],
                  ['Name servers', dns!.nameservers.join(', ')],
                  ['Email', dns!.mail ? 'Set up to receive email' : 'No email set up'],
                  ...(dns!.wildcard === null
                    ? []
                    : [
                        [
                          'Subdomains',
                          dns!.wildcard
                            ? 'Any subdomain resolves'
                            : 'Only named subdomains resolve',
                        ],
                      ]),
                ] as [string, string][]
              )
                .filter(([, v2]) => v2)
                .map(([k, v2], i) => (
                  <tr key={k} className={cx('align-top', i > 0 && 'border-t border-zinc-100')}>
                    <th
                      scope="row"
                      className="w-32 border-s-4 border-accent-600 bg-zinc-50 px-4 py-2 text-start font-medium text-zinc-500"
                    >
                      {k}
                    </th>
                    <td
                      className={cx(
                        'px-4 py-2 break-all',
                        ['Points to', 'Address', 'Name servers'].includes(k) && 'font-mono text-xs',
                      )}
                    >
                      {v2}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Every icon there is, searchable, in a window of its own. */
function IconModal({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick(v: string): void;
  onClose(): void;
}) {
  const [all, setAll] = useState<Record<string, ComponentType<{ className?: string }>> | null>(
    null,
  );
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    void loadAllIcons().then((m) => live && setAll(m));
    return () => {
      live = false;
    };
  }, []);
  const found = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/\s+/g, '-');
    return all ? Object.keys(all).filter((i) => !n || i.includes(n)) : [];
  }, [all, q]);
  const shown = found.slice(0, 300);
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Choose an icon"
      footer={
        <>
          {value && (
            <Button variant="ghost" className="me-auto" onClick={() => (onPick(''), onClose())}>
              Clear the icon
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          icon={Search}
          autoFocus
          aria-label="Search icons"
          placeholder={all ? `Search ${Object.keys(all).length} icons` : 'Loading the icons…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {!all ? (
          <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" /> Loading the icons…
          </div>
        ) : (
          <>
            <div className="grid max-h-[55vh] grid-cols-8 gap-1 overflow-y-auto sm:grid-cols-12">
              {shown.map((n) => {
                const Ic = all[n]!;
                const on = value === `lucide:${n}`;
                return (
                  <button
                    key={n}
                    type="button"
                    title={n}
                    aria-label={n}
                    aria-pressed={on}
                    onClick={() => (onPick(`lucide:${n}`), onClose())}
                    className={cx(
                      'flex size-10 items-center justify-center border',
                      on
                        ? 'border-accent-600 bg-accent-50 text-accent-700'
                        : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50',
                    )}
                  >
                    <Ic className="size-5" />
                  </button>
                );
              })}
              {!shown.length && (
                <p className="col-span-full py-6 text-center text-sm text-zinc-400">
                  No icon like that.
                </p>
              )}
            </div>
            {found.length > shown.length && (
              <p className="text-xs text-zinc-500">
                Showing {shown.length} of {found.length}: type to narrow them down.
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** An icon for a topic: a short list to pick from, "…" for every icon in a window of its own, and a way to take it off. */
function IconPicker({ value, onChange }: { value: string; onChange(v: string): void }) {
  const [all, setAll] = useState(false);
  const Cur = value.startsWith('lucide:') ? anyIcon(value.slice(7)) : null;
  const cell = (on: boolean) =>
    cx(
      'flex size-9 items-center justify-center border',
      on
        ? 'border-accent-600 bg-accent-50 text-accent-700'
        : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50',
    );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Icon">
        {/* Twenty places, two even rows: a chosen icon from the full set takes the last place of the short list. */}
        {Object.entries(TOPIC_ICONS)
          .slice(0, Cur ? 18 : 19)
          .map(([k, Ic]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={value === k}
              aria-label={k}
              title={k}
              onClick={() => onChange(k)}
              className={cell(value === k)}
            >
              <Ic className="size-4" />
            </button>
          ))}
        {Cur && (
          <button
            type="button"
            role="radio"
            aria-checked
            title={value.slice(7)}
            onClick={() => setAll(true)}
            className={cell(true)}
          >
            <Cur className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setAll(true)}
          className={cell(false)}
          title="Every icon"
          aria-label="Choose from every icon"
        >
          <Ellipsis className="size-4" />
        </button>
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="mx-auto block text-xs text-zinc-500 underline-offset-2 hover:text-ink hover:underline"
        >
          Clear the icon
        </button>
      )}
      {all && <IconModal value={value} onPick={onChange} onClose={() => setAll(false)} />}
    </div>
  );
}

/** A secure website's secret, shown on request, with the code its server needs to sign tokens. */
function SecretPanel({ siteId, host }: { siteId: string; host: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [secret, setSecret] = useState<string | null>(null);
  const [lang, setLang] = useState<'node' | 'python' | 'php'>('node');
  const show = useMutation({
    mutationFn: () => api.embedSecret(ws.tenant.id, siteId),
    onSuccess: (r) => setSecret(r.secret),
    onError: (e) => toast(e instanceof Error ? e.message : 'The secret could not be shown'),
  });
  const renew = useMutation({
    mutationFn: () => api.rotateEmbedSecret(ws.tenant.id, siteId),
    onSuccess: (c) => {
      qc.setQueryData(['support-desk', ws.tenant.id], c);
      setSecret(null);
      toast('New secret made. Show it and give it to the website’s server.');
    },
  });
  const code = lang === 'node' ? NODE_SAMPLE : lang === 'python' ? PY_SAMPLE : PHP_SAMPLE;
  return (
    <div className="space-y-3 border-t border-zinc-100 pt-3">
      {confirm.dialog}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs">
          {secret ?? '••••••••••••••••••••••••••••••••'}
        </code>
        {secret ? (
          <Button
            variant="secondary"
            size="sm"
            icon={Copy}
            onClick={() =>
              void navigator.clipboard?.writeText(secret).then(() => toast('Secret copied'))
            }
          >
            Copy
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={Eye}
            loading={show.isPending}
            onClick={() => show.mutate()}
          >
            Show secret
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={KeyRound}
          loading={renew.isPending}
          onClick={async () =>
            (await confirm.ask({
              title: `New secret for ${host}?`,
              message:
                'Tokens its server signs with the old secret stop working straight away, so the window disappears there until the server uses the new one.',
              confirm: 'Make a new secret',
              danger: true,
            })) && renew.mutate()
          }
        >
          New secret
        </Button>
      </div>
      <div>
        <Tabs
          value={lang}
          onChange={setLang}
          tabs={[
            { id: 'node', label: 'Node.js' },
            { id: 'python', label: 'Python' },
            { id: 'php', label: 'PHP' },
          ]}
        />
        <div className="relative">
          <pre className="max-h-56 overflow-auto border border-zinc-200 bg-zinc-50 p-3 pe-12 font-mono text-[11.5px] leading-relaxed">
            {code}
          </pre>
          <button
            type="button"
            aria-label="Copy the code"
            title="Copy the code"
            onClick={() =>
              void navigator.clipboard?.writeText(code).then(() => toast('Code copied'))
            }
            className="absolute end-2 top-2 p-1.5 text-zinc-500 hover:bg-zinc-200/60 hover:text-ink"
          >
            <Copy className="size-4" />
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Keep the secret on the website’s server only. Add the token to the snippet as{' '}
        <code>data-token</code>; it never goes in the page for everyone to copy.
      </p>
    </div>
  );
}

const siteHost = (n: string) =>
  n
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^\./, '*.')
    .toLowerCase();

/**
 * Adding or changing a website, one step at a time: its name, a look-up of that name in DNS (which then locks the
 * name), and only then the choices that depend on it: standard or secure, and its hourly limit. Everything is kept
 * as soon as it is chosen, so the secret of a secure website is there at once.
 */
function SiteDialog({
  edit,
  f,
  set,
  onClose,
}: {
  edit: Extract<Edit, { kind: 'site' }>;
  f: HelpDeskConfig;
  set(p: Partial<HelpDeskConfig>): void;
  onClose(): void;
}) {
  const ws = useWorkspace();
  const [at, setAt] = useState(edit.at);
  const [name, setName] = useState(edit.name);
  const [locked, setLocked] = useState(edit.at !== null);
  const [dns, setDns] = useState<SupportSiteCheck | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const site = at === null ? null : (f.embedSites[at] ?? null);
  const host = siteHost(name);
  const change = (patch: Partial<HelpDeskConfig['embedSites'][number]>) =>
    at !== null &&
    set({ embedSites: f.embedSites.map((x, k) => (k === at ? { ...x, ...patch } : x)) });
  /** The name is settled: a new website is added, or the changed name is kept, and the name is locked. */
  const settle = () => {
    if (at === null) {
      set({
        embedSites: [
          ...f.embedSites,
          {
            id: '',
            key: '',
            paused: false,
            host,
            hourlyLimit: 30,
            secure: false,
            secretVersion: 1,
          },
        ],
      });
      setAt(f.embedSites.length);
    } else change({ host });
    setLocked(true);
  };
  const look = async () => {
    // A website can be in the list once: say so, instead of adding it a second time (the server would refuse it).
    if (f.embedSites.some((e, k) => e.host === host && k !== at)) {
      setLookError(`${host} is already in the list. Close this window and open it from the table.`);
      return;
    }
    setLooking(true);
    setLookError(null);
    try {
      const r = await api.checkSupportSite(ws.tenant.id, host);
      setDns(r);
      if (r.resolves) settle();
    } catch (e) {
      setLookError(e instanceof Error ? e.message : 'The lookup did not work');
    } finally {
      setLooking(false);
    }
  };
  const tile = (
    secure: boolean,
    Icon: ComponentType<{ className?: string }>,
    title: string,
    text: string,
  ) => {
    const on = !!site && site.secure === secure;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={!locked}
        onClick={() => change({ secure })}
        className={cx(
          'flex flex-col items-center gap-1 border p-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-45',
          on ? 'border-accent-600 bg-accent-50' : 'border-zinc-200 hover:border-zinc-400',
        )}
      >
        <Icon className={cx('size-5', on ? 'text-accent-700' : 'text-zinc-500')} />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-zinc-500">{text}</span>
      </button>
    );
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={at === null ? 'Add a website' : (site?.host ?? 'Website')}
      footer={
        locked ? (
          <Button onClick={onClose}>{edit.at === null ? 'Add' : 'Done'}</Button>
        ) : dns && !dns.resolves ? (
          <Button variant="danger" onClick={settle}>
            Add anyway
          </Button>
        ) : (
          <Button loading={looking} disabled={!host} onClick={() => void look()}>
            Check the website
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <Field
          label="Name"
          hint={
            locked
              ? undefined
              : 'The address of the website, for example www.example.org, or *.example.org for every subdomain'
          }
        >
          <div className="flex gap-2">
            <Input
              autoFocus
              disabled={locked}
              value={name}
              onChange={(e) => (setName(e.target.value), setDns(null), setLookError(null))}
              placeholder="www.example.org"
            />
            {locked && at !== null && (
              <Button variant="secondary" onClick={() => (setLocked(false), setDns(null))}>
                Change
              </Button>
            )}
          </div>
        </Field>
        <DnsResult dns={dns} lookError={lookError} />
        {locked && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-zinc-700">How it is protected</div>
            <div
              role="radiogroup"
              aria-label="How it is protected"
              className="grid gap-3 sm:grid-cols-2"
            >
              {tile(
                false,
                Globe2,
                'Standard',
                'The key in the snippet is enough. Quick to set up, with an hourly limit on requests.',
              )}
              {tile(
                true,
                ShieldCheck,
                'Secure',
                'The website’s own server signs each page view, so a copied snippet is useless. No hourly limit. Needs a little code.',
              )}
            </div>
          </div>
        )}
        {locked &&
          site?.secure &&
          (site.id ? (
            <SecretPanel siteId={site.id} host={site.host} />
          ) : (
            <p className="text-xs text-zinc-500">Making the secret…</p>
          ))}
        {locked && !site?.secure && (
          <Field
            label="Requests per hour"
            hint="How many requests this website may send in an hour. Over that, it is told to try later."
          >
            <Input
              type="number"
              min={1}
              max={1000}
              disabled={!locked}
              value={site?.hourlyLimit ?? 30}
              onChange={(e) =>
                change({ hourlyLimit: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })
              }
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** Adding or changing one stage, label or reply; it joins the help desk's draft, and is saved with it. */
function ItemDialog({
  edit,
  f,
  set,
  onClose,
}: {
  edit: Exclude<Edit, { kind: 'site' }>;
  f: HelpDeskConfig;
  set(p: Partial<HelpDeskConfig>): void;
  onClose(): void;
}) {
  const [v, setV] = useState(edit);
  const [hex, setHex] = useState(edit.kind === 'label' ? edit.label.color : '');
  const pickColor = (c: string) => (
    setHex(c),
    setV((cur) => (cur.kind === 'label' ? { ...cur, label: { ...cur.label, color: c } } : cur))
  );
  const put = <T,>(list: T[], at: number | null, item: T) =>
    at === null ? [...list, item] : list.map((x, k) => (k === at ? item : x));
  const name =
    v.kind === 'stage'
      ? v.stage.label
      : v.kind === 'label'
        ? v.label.label
        : v.kind === 'topic'
          ? v.name
          : v.reply.title;
  const done = async () => {
    const n = name.trim();
    if (!n) return;
    if (v.kind === 'stage')
      set({
        stages: put(f.stages, v.at, {
          ...v.stage,
          label: n,
          key:
            v.stage.key ||
            freeKey(
              n,
              f.stages.map((x) => x.key),
            ),
        }),
      });
    else if (v.kind === 'label')
      set({
        labels: put(f.labels, v.at, {
          ...v.label,
          label: n,
          key:
            v.label.key ||
            freeKey(
              n,
              f.labels.map((x) => x.key),
            ),
        }),
      });
    else if (v.kind === 'topic') {
      const icons = { ...f.categoryIcons };
      const before = v.at === null ? null : f.categories[v.at];
      if (before) delete icons[before];
      if (v.icon) icons[n] = v.icon;
      set({ categories: put(f.categories, v.at, n), categoryIcons: icons });
    } else
      set({
        replies: put(f.replies, v.at, {
          ...v.reply,
          title: n,
          id:
            v.reply.id ||
            freeKey(
              n,
              f.replies.map((x) => x.id),
            ),
        }),
      });
    onClose();
  };
  const noun = v.kind === 'topic' ? 'topic' : v.kind;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${v.at === null ? 'Add a' : 'Edit the'} ${noun}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => void done()}>
            {v.at === null ? 'Add' : 'Done'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => (e.preventDefault(), v.kind !== 'reply' && done())}
      >
        <Field label={v.kind === 'reply' ? 'Title' : 'Name'}>
          <Input
            autoFocus
            value={name}
            maxLength={v.kind === 'stage' ? 40 : v.kind === 'label' ? 30 : 60}
            placeholder={v.kind === 'reply' ? 'e.g. Ask for a screenshot' : undefined}
            onChange={(e) =>
              setV(
                v.kind === 'topic'
                  ? { ...v, name: e.target.value }
                  : v.kind === 'stage'
                    ? { ...v, stage: { ...v.stage, label: e.target.value } }
                    : v.kind === 'label'
                      ? { ...v, label: { ...v.label, label: e.target.value } }
                      : { ...v, reply: { ...v.reply, title: e.target.value } },
              )
            }
          />
        </Field>
        {v.kind === 'stage' && (
          <Field label="Means">
            <Listbox
              label="Means"
              value={v.stage.kind}
              onChange={(kind) =>
                setV({ ...v, stage: { ...v.stage, kind: kind as SupportStage['kind'] } })
              }
              options={(['open', 'active', 'done'] as const).map((k) => ({
                value: k,
                label: KIND_TEXT[k],
                icon: stageIcon(k, v.stage.key),
              }))}
            />
          </Field>
        )}
        {v.kind === 'label' && (
          <Field label="Colour">
            <div>
              <div className="flex gap-2.5" role="radiogroup" aria-label="Colour">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={v.label.color === c}
                    aria-label={c}
                    onClick={() => pickColor(c)}
                    className={cx(
                      'size-6 rounded-full transition-transform hover:scale-110',
                      v.label.color === c && 'ring-2 ring-offset-2 ring-zinc-500',
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <label
                  className="relative size-9 shrink-0 cursor-pointer border border-zinc-300"
                  style={{ background: v.label.color }}
                  title="Pick any colour"
                >
                  <input
                    type="color"
                    aria-label="Pick any colour"
                    value={v.label.color}
                    onChange={(e) => pickColor(e.target.value)}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                </label>
                <Input
                  aria-label="Colour code"
                  className="w-32 font-mono"
                  value={hex}
                  maxLength={7}
                  placeholder="#RRGGBB"
                  onChange={(e) => {
                    const t = `#${e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)}`;
                    setHex(e.target.value ? t : '');
                    if (/^#[0-9a-fA-F]{6}$/.test(t))
                      setV((cur) =>
                        cur.kind === 'label' ? { ...cur, label: { ...cur.label, color: t } } : cur,
                      );
                  }}
                />
                <span className="text-xs text-zinc-500">Or pick any colour, or type its code</span>
              </div>
            </div>
          </Field>
        )}
        {v.kind === 'topic' && (
          <Field label="Icon">
            <IconPicker value={v.icon} onChange={(icon) => setV({ ...v, icon })} />
          </Field>
        )}
        {v.kind === 'reply' && (
          <Field
            label="Reply"
            intro="Click a code to add it. It is replaced with the ticket’s own detail when the reply is used."
          >
            <div>
              <Textarea
                value={v.reply.body}
                maxLength={4000}
                onChange={(e) => setV({ ...v, reply: { ...v.reply, body: e.target.value } })}
                className="min-h-48"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REPLY_FIELDS.map((rf) => (
                  <button
                    key={rf.code}
                    type="button"
                    title={rf.label}
                    onClick={() =>
                      setV({ ...v, reply: { ...v.reply, body: `${v.reply.body}${rf.code}` } })
                    }
                    className="border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11.5px] text-zinc-700 hover:border-accent-600 hover:bg-accent-50"
                  >
                    {rf.code}
                  </button>
                ))}
              </div>
            </div>
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/** The organisation's help desk: whether its pages offer the help window, the stages tickets move through, its labels and ready-made replies. */
export function HelpDeskPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const desk = useDesk(id);
  const page = useConfirm();
  const [tab, setTab] = useState<'general' | 'stages' | 'labels' | 'replies' | 'embed'>('general');
  const usage = useQuery({
    queryKey: ['embed-usage', id],
    queryFn: () => api.embedUsage(id),
    refetchInterval: 20_000,
    enabled: tab === 'embed',
  });
  const [edit, setEdit] = useState<Edit | null>(null);
  const f = desk.data;
  // Every change is kept as soon as it is made: the page shows it at once and the server hears about it a moment later
  // (a short wait lets typing finish first). What the server sends back (ids and keys it made) replaces the page's copy
  // unless something newer has been changed since.
  const latest = useRef<HelpDeskConfig | null>(null);
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [waiting, setWaiting] = useState(false);
  const save = useMutation({
    mutationFn: (x: { config: HelpDeskConfig; version: number }) =>
      api.saveSupportDesk(id, x.config),
    onSuccess: (c, sent) => {
      // Only the newest change may replace the page's copy (it carries the ids and keys the server made).
      if (version.current === sent.version) {
        qc.setQueryData(['support-desk', id], c);
        latest.current = null;
      }
      void qc.invalidateQueries({ queryKey: ['tickets', id] });
    },
    onError: (e) => {
      toast(e instanceof Error ? e.message : 'The change could not be saved');
      latest.current = null;
      void qc.invalidateQueries({ queryKey: ['support-desk', id] });
    },
  });
  const set = (patch: Partial<HelpDeskConfig>) => {
    if (!f) return;
    const cur = latest.current ?? f;
    const next = { ...cur, ...patch };
    latest.current = next;
    const mine = ++version.current;
    qc.setQueryData(['support-desk', id], next);
    setWaiting(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setWaiting(false);
      save.mutate({
        config: { ...next, categories: next.categories.map((c) => c.trim()).filter(Boolean) },
        version: mine,
      });
    }, 400);
  };
  const rotate = useMutation({
    mutationFn: (siteId: string) => api.rotateEmbedKey(id, siteId),
    onSuccess: (c) => {
      qc.setQueryData(['support-desk', id], c);
      toast('New embed key made. Copy the snippet again.');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'The key could not be changed'),
  });
  const stages = f?.stages ?? [];
  const move = (i: number, by: -1 | 1) => {
    const next = [...stages];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ stages: next });
  };
  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Help desk"
        meta="How people ask your organisation for help, and how your team works what they send."
        actions={
          <span
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500"
            aria-live="polite"
          >
            {(waiting || save.isPending) && (
              <>
                <Loader2 className="size-4 animate-spin" /> Saving…
              </>
            )}
          </span>
        }
      />
      {!f ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <ErrorNotice error={save.error} />
          <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
            <nav aria-label="Help desk settings" className="lg:sticky lg:top-20 lg:self-start">
              <div className="flex gap-1 overflow-x-auto pb-2 lg:block lg:overflow-visible lg:pb-0">
                {(
                  [
                    { id: 'general', label: 'General', icon: Settings2 },
                    { id: 'stages', label: 'Stages', icon: CircleDashed, count: stages.length },
                    { id: 'labels', label: 'Labels', icon: Tag, count: f.labels.length },
                    {
                      id: 'replies',
                      label: 'Ready-made replies',
                      icon: MessageSquareText,
                      count: f.replies.length,
                    },
                    {
                      id: 'embed',
                      label: 'Website embed',
                      icon: Code2,
                      count: f.embedSites.length,
                    },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-current={tab === t.id ? 'page' : undefined}
                    onClick={() => setTab(t.id)}
                    className={cx(
                      'flex w-full shrink-0 items-center gap-2.5 border-s-2 px-2 py-1.5 text-start text-sm whitespace-nowrap transition-colors',
                      tab === t.id
                        ? 'border-accent-600 bg-accent-50 font-medium text-ink'
                        : 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-ink',
                    )}
                  >
                    <t.icon className="size-4 shrink-0" />
                    <span className="flex-1">{t.label}</span>
                    {'count' in t && <span className="num text-xs text-zinc-400">{t.count}</span>}
                  </button>
                ))}
              </div>
            </nav>
            <div className="min-h-[28rem] min-w-0 max-w-4xl space-y-4">
              {tab === 'general' && (
                <div className="space-y-4">
                  <SectionHead
                    title="General"
                    description="Whether the help window is on, what people are asked, and how it greets them."
                  />
                  <div className="divide-y divide-zinc-100">
                    <ToggleLine
                      label="Offer help to people on your pages"
                      description="A help button on every public project page and in the portal, for people with or without an account"
                      checked={f.enabled}
                      onChange={(enabled) => set({ enabled })}
                    />
                    <ToggleLine
                      label="Chat"
                      description="People keep talking with your team in the same window, and see replies as they come in"
                      checked={f.chat}
                      onChange={(chat) => set({ chat })}
                    />
                    <ToggleLine
                      label="Check for spam"
                      description="Visitors who are not signed in solve a small automatic puzzle before sending"
                      checked={f.captcha}
                      onChange={(captcha) => set({ captcha })}
                    />
                    <ToggleLine
                      label="Confirm email addresses"
                      description="Visitors who are not signed in get a 6-digit code by email and enter it before they can write to you"
                      checked={f.verifyEmail}
                      onChange={(verifyEmail) => set({ verifyEmail })}
                    />
                    <div className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Mobile number</div>
                        <div className="text-xs text-zinc-500">
                          Ask visitors for a phone number so your team can call them
                        </div>
                      </div>
                      <Listbox
                        compact
                        label="Mobile number"
                        className="w-36 shrink-0"
                        value={f.phone}
                        onChange={(phone) => set({ phone: phone as HelpDeskConfig['phone'] })}
                        options={[
                          { value: 'off', label: 'Do not ask' },
                          { value: 'optional', label: 'Optional' },
                          { value: 'required', label: 'Required' },
                        ]}
                      />
                    </div>
                  </div>
                  <Field label="Welcome message" intro="Shown at the top of the help window">
                    <Textarea
                      value={f.greeting}
                      maxLength={300}
                      onChange={(e) => set({ greeting: e.target.value })}
                      className="min-h-16"
                    />
                  </Field>
                  <Section
                    title="Topics"
                    intro="What people can ask about: they pick one when they write in."
                    action={
                      <Button
                        size="sm"
                        icon={Plus}
                        disabled={f.categories.length >= 12}
                        onClick={() => setEdit({ kind: 'topic', at: null, name: '', icon: '' })}
                      >
                        Add a topic
                      </Button>
                    }
                  >
                    <DataTable head={['Topic']}>
                      {f.categories.map((c, i) => (
                        <tr
                          key={`${c}-${i}`}
                          className="group border-t border-zinc-100 hover:bg-zinc-50"
                        >
                          <td className="py-2 ps-3 font-medium">
                            <span className="flex items-center gap-2.5">
                              {(() => {
                                const Ic = topicIcon(f.categoryIcons, c);
                                return <Ic className="size-4 text-zinc-500" />;
                              })()}
                              {c}
                            </span>
                          </td>
                          <RowTools
                            label={c}
                            onEdit={() =>
                              setEdit({
                                kind: 'topic',
                                at: i,
                                name: c,
                                icon: f.categoryIcons[c] ?? '',
                              })
                            }
                            onDelete={() =>
                              set({
                                categories: f.categories.filter((_, k) => k !== i),
                                categoryIcons: Object.fromEntries(
                                  Object.entries(f.categoryIcons).filter(([n]) => n !== c),
                                ),
                              })
                            }
                          />
                        </tr>
                      ))}
                      {!f.categories.length && (
                        <tr className="border-t border-zinc-100">
                          <td colSpan={2} className="py-4 ps-3 text-zinc-400">
                            No topics: people just write their message.
                          </td>
                        </tr>
                      )}
                    </DataTable>
                  </Section>
                </div>
              )}
              {tab === 'stages' && (
                <Section
                  title="Stages"
                  intro="The steps a ticket moves through, in order. The first is where new requests start; “finished” stages close a ticket."
                  action={
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() =>
                        setEdit({
                          kind: 'stage',
                          at: null,
                          stage: { key: '', label: '', kind: 'active' },
                        })
                      }
                    >
                      Add a stage
                    </Button>
                  }
                  foot={
                    <>
                      <p className="text-xs text-zinc-500">
                        A stage that tickets are still in can’t be removed: move them first.
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => set({ stages: DEFAULT_SUPPORT_STAGES })}
                      >
                        Start again from the usual set
                      </Button>
                    </>
                  }
                >
                  <DataTable head={['Stage', 'Means']}>
                    {stages.map((s, i) => (
                      <tr key={s.key} className="group border-t border-zinc-100 hover:bg-zinc-50">
                        <td className="py-2 ps-3">
                          <span className="flex items-center gap-3">
                            <StageDot kind={s.kind} stageKey={s.key} />
                            <span className="font-medium">{s.label}</span>
                            {i === 0 && <span className="text-xs text-zinc-400">Start</span>}
                          </span>
                        </td>
                        <td className="py-2 text-zinc-500">{KIND_TEXT[s.kind]}</td>
                        <RowTools
                          label={s.label}
                          onEdit={() => setEdit({ kind: 'stage', at: i, stage: s })}
                          onDelete={() => set({ stages: stages.filter((_, k) => k !== i) })}
                          onUp={i > 0 ? () => move(i, -1) : undefined}
                          onDown={i < stages.length - 1 ? () => move(i, 1) : undefined}
                        />
                      </tr>
                    ))}
                  </DataTable>
                </Section>
              )}
              {tab === 'labels' && (
                <Section
                  title="Labels"
                  intro="Tags your team puts on tickets to sort them."
                  action={
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() =>
                        setEdit({
                          kind: 'label',
                          at: null,
                          label: {
                            key: '',
                            label: '',
                            color: SWATCHES[f.labels.length % SWATCHES.length]!,
                          },
                        })
                      }
                    >
                      Add a label
                    </Button>
                  }
                >
                  <DataTable head={['Label']}>
                    {f.labels.map((l, i) => (
                      <tr key={l.key} className="group border-t border-zinc-100 hover:bg-zinc-50">
                        <td className="py-2 ps-3">
                          <span className="flex items-center gap-3">
                            <i className="size-3 rounded-full" style={{ background: l.color }} />
                            <span className="font-medium">{l.label}</span>
                          </span>
                        </td>
                        <RowTools
                          label={l.label}
                          onEdit={() => setEdit({ kind: 'label', at: i, label: l })}
                          onDelete={() => set({ labels: f.labels.filter((_, k) => k !== i) })}
                        />
                      </tr>
                    ))}
                  </DataTable>
                </Section>
              )}
              {tab === 'embed' && (
                <Section
                  title="Website embed"
                  intro="Put the help window on other websites. Each website gets its own key and its own hourly limit, and only that website can show the window with that key."
                  action={
                    <Button
                      size="sm"
                      icon={Plus}
                      disabled={f.embedSites.length >= 20}
                      onClick={() =>
                        setEdit({ kind: 'site', at: null, name: '', limit: 30, secure: false })
                      }
                    >
                      Add a website
                    </Button>
                  }
                >
                  <DataTable head={['Website', 'Key', 'This hour', 'Enabled', 'Secure']}>
                    {f.embedSites.map((e, i) => (
                      <tr
                        key={e.id || `${e.host}-${i}`}
                        className="border-t border-zinc-100 hover:bg-zinc-50"
                      >
                        <td className="py-2 ps-3 font-mono text-[13px]">{e.host}</td>
                        <td className="py-2 font-mono text-xs text-zinc-500">
                          {e.key ? (
                            '••••••••••'
                          ) : (
                            <span className="font-sans">Making the key…</span>
                          )}
                        </td>
                        <td className="py-2 text-zinc-600">
                          {e.secure ? (
                            <span className="text-zinc-400">No limit</span>
                          ) : (
                            (() => {
                              const u = usage.data?.find((x) => x.siteId === e.id);
                              const used = u?.used ?? 0;
                              return (
                                <span
                                  className={cx(
                                    'num',
                                    used >= e.hourlyLimit * 0.8 && 'font-medium text-red-700',
                                  )}
                                  title={u?.refused ? `${u.refused} turned away` : undefined}
                                >
                                  {used} / {e.hourlyLimit}
                                </span>
                              );
                            })()
                          )}
                        </td>
                        <td className="py-2">
                          <input
                            type="checkbox"
                            checked={!e.paused}
                            onChange={() =>
                              set({
                                embedSites: f.embedSites.map((x, k) =>
                                  k === i ? { ...x, paused: !x.paused } : x,
                                ),
                              })
                            }
                            aria-label={`${e.host} is on`}
                            className="size-4 accent-[var(--brand-600)]"
                          />
                        </td>
                        <td className="py-2">
                          {e.secure ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-700">
                              <Lock className="size-3.5" /> Secure
                            </span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </td>
                        <td className="py-1 pe-2 align-middle">
                          <span className="flex justify-end">
                            <button
                              type="button"
                              aria-label={`Copy the snippet for ${e.host}`}
                              disabled={!e.key}
                              title={e.key ? 'Copy the snippet' : 'Save first, to make the key'}
                              onClick={() =>
                                void navigator.clipboard
                                  ?.writeText(
                                    `<script src="${env.apiUrl}/embed.js" data-org="${ws.tenant.slug}" data-key="${e.key}" async></script>`,
                                  )
                                  .then(() => toast(`Snippet for ${e.host} copied`))
                              }
                              className="p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-ink disabled:opacity-30"
                            >
                              <Copy className="size-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Download the snippet for ${e.host}`}
                              disabled={!e.key}
                              title={e.key ? 'Download the snippet' : 'The key is being made'}
                              onClick={() => {
                                const code = `<script src="${env.apiUrl}/embed.js" data-org="${ws.tenant.slug}" data-key="${e.key}" async></script>\n`;
                                const url = URL.createObjectURL(
                                  new Blob([code], { type: 'text/plain;charset=utf-8' }),
                                );
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `help-window-${e.host.replace(/[^a-z0-9.-]/g, '')}.txt`;
                                a.click();
                                setTimeout(() => URL.revokeObjectURL(url), 10_000);
                              }}
                              className="p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-ink disabled:opacity-30"
                            >
                              <Download className="size-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`New key for ${e.host}`}
                              disabled={!e.id}
                              title="Make a new key (the old snippet stops working)"
                              onClick={async () =>
                                (await page.ask({
                                  title: `New key for ${e.host}?`,
                                  message:
                                    'The snippet on that website stops showing the help window until you give it the new one.',
                                  confirm: 'Make a new key',
                                  danger: true,
                                })) && rotate.mutate(e.id)
                              }
                              className="p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-ink disabled:opacity-30"
                            >
                              <KeyRound className="size-4" />
                            </button>
                            {e.secure && (
                              <button
                                type="button"
                                aria-label={`Secret and code for ${e.host}`}
                                title="Secret and code for the server"
                                onClick={() =>
                                  setEdit({
                                    kind: 'site',
                                    at: i,
                                    name: e.host,
                                    limit: e.hourlyLimit,
                                    secure: true,
                                  })
                                }
                                className="p-1.5 text-accent-700 hover:bg-zinc-100"
                              >
                                <Lock className="size-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Edit ${e.host}`}
                              onClick={() =>
                                setEdit({
                                  kind: 'site',
                                  at: i,
                                  name: e.host,
                                  limit: e.hourlyLimit,
                                  secure: e.secure,
                                })
                              }
                              className="p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-ink"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${e.host}`}
                              onClick={async () =>
                                (await page.ask({
                                  title: `Remove ${e.host}?`,
                                  message:
                                    'Its snippet stops showing the help window straight away.',
                                  confirm: 'Remove',
                                  danger: true,
                                })) && set({ embedSites: f.embedSites.filter((_, k) => k !== i) })
                              }
                              className="p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-700"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!f.embedSites.length && (
                      <tr className="border-t border-zinc-100">
                        <td colSpan={5} className="py-4 ps-3 text-zinc-400">
                          No websites yet: the window only shows on your own project pages and the
                          portal.
                        </td>
                      </tr>
                    )}
                  </DataTable>
                  <ToggleLine
                    label="Pause all website embeds"
                    description="The help window disappears from every other website at once; your own pages keep it"
                    checked={f.embedPaused}
                    onChange={(embedPaused) => set({ embedPaused })}
                  />
                </Section>
              )}
              {tab === 'replies' && (
                <Section
                  title="Ready-made replies"
                  intro={
                    <>
                      Replies your team can drop into a message with one click. Write {'{name}'}{' '}
                      where the person’s first name should go.
                    </>
                  }
                  action={
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() =>
                        setEdit({
                          kind: 'reply',
                          at: null,
                          reply: { id: '', title: '', body: 'Hi {name},\n\n' },
                        })
                      }
                    >
                      Add a reply
                    </Button>
                  }
                >
                  <DataTable head={['Reply', 'Text']}>
                    {f.replies.map((r, i) => (
                      <tr key={r.id} className="group border-t border-zinc-100 hover:bg-zinc-50">
                        <td className="w-56 py-2 ps-3 align-top font-medium">{r.title}</td>
                        <td className="max-w-0 py-2 pe-3 align-top text-zinc-500">
                          <span className="line-clamp-2 whitespace-pre-line">{r.body}</span>
                        </td>
                        <RowTools
                          label={r.title}
                          onEdit={() => setEdit({ kind: 'reply', at: i, reply: r })}
                          onDelete={() => set({ replies: f.replies.filter((_, k) => k !== i) })}
                        />
                      </tr>
                    ))}
                  </DataTable>
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
      {page.dialog}
      {edit && f && edit.kind === 'site' && (
        <SiteDialog
          key={`site-${edit.at}`}
          edit={edit}
          f={f}
          set={set}
          onClose={() => setEdit(null)}
        />
      )}
      {edit && f && edit.kind !== 'site' && (
        <ItemDialog
          key={`${edit.kind}-${edit.at}`}
          edit={edit}
          f={f}
          set={set}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

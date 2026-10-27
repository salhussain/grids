import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  Building2,
  Check,
  Eye,
  Globe,
  LogIn,
  Home,
  Network,
  Plus,
  Save as SaveIcon,
  Users,
  X,
  LayoutDashboard,
  BarChart3,
  LifeBuoy,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Theme } from '@grids/schema';
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  VerticalTabs,
  Status,
  Switch,
  Textarea,
  cx,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';
import { applyTheme, brandRange, chartPalette, contrastOn } from '../theme';
import { ImageField } from './projects/fields';

// Colours to start from; the last tile opens the colour window for anything else.
const PRESETS = [
  '#0f62fe',
  '#198038',
  '#8a3ffc',
  '#da1e28',
  '#007d79',
  '#ff832b',
  '#161616',
  '#b28600',
  '#0072c3',
  '#d12771',
  '#525252',
  '#1192e8',
  '#24a148',
  '#6929c4',
  '#a2191f',
  '#005d5d',
  '#ba4e00',
  '#878d96',
  '#8e6a00',
  '#9f1853',
  '#0043ce',
];

const HEX = /^#[0-9a-f]{6}$/i;
/** Any colour: a large picker and the colour code (type it or paste it), with a swatch of what it will look like. */
function ColourDialog({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick(c: string): void;
  onClose(): void;
}) {
  const [hex, setHex] = useState(value);
  const ok = HEX.test(hex);
  const type = (raw: string) => {
    const t = raw.trim().replace(/^#?/, '#').slice(0, 7);
    setHex(t.toLowerCase());
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Pick a colour"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok} onClick={() => (onPick(hex), onClose())}>
            Use this colour
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label
          className="relative block h-40 cursor-pointer border border-zinc-300"
          style={{ background: ok ? hex : value }}
          title="Click to choose a colour"
        >
          <input
            type="color"
            value={ok ? hex : value}
            onChange={(e) => setHex(e.target.value)}
            aria-label="Colour picker"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <span className="absolute inset-x-0 bottom-0 bg-black/45 px-3 py-1.5 text-xs text-white">
            Click to choose a colour
          </span>
        </label>
        <Field
          label="Colour code"
          hint="For example #7ea6f4"
          error={!ok && hex.length > 1 ? 'Use six letters or numbers, like #7ea6f4' : undefined}
        >
          <Input
            value={hex}
            onChange={(e) => type(e.target.value)}
            className="font-mono"
            autoFocus
            spellCheck={false}
            maxLength={7}
          />
        </Field>
      </div>
    </Dialog>
  );
}

type View = 'workspace' | 'signin' | 'tab' | 'charts' | 'help';
/** An on/off setting: what it does on the left, the switch on the right. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 text-sm leading-tight">
        <div className="text-ink">{label}</div>
        {description && <div className="mt-0.5 text-xs text-zinc-500">{description}</div>}
      </div>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function Mark({ draft, name, className }: { draft: Theme; name: string; className?: string }) {
  return draft.logo ? (
    <img src={draft.logo} alt="" className={cx('object-contain', className)} />
  ) : (
    <span
      className={cx(
        'flex items-center justify-center bg-accent-600 font-semibold text-on-accent',
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function SigninView({ draft, name }: { draft: Theme; name: string }) {
  const bg = draft.signin.background;
  return (
    <div
      className={cx(
        'flex min-h-80 items-center justify-center p-6',
        bg === 'dark' ? 'bg-chrome' : bg === 'glow' ? 'bg-accent-100' : 'bg-zinc-100',
      )}
      style={
        bg === 'stripes'
          ? {
              backgroundImage:
                'repeating-linear-gradient(135deg,transparent 0 6px,rgb(0 0 0/0.05) 6px 12px)',
            }
          : undefined
      }
    >
      <div className="w-60 border border-zinc-200 bg-snow p-5 text-center text-xs">
        <Mark draft={draft} name={name} className="mx-auto mb-2 size-9" />
        <div className="text-sm font-semibold">{name}</div>
        {draft.signin.tagline && <div className="text-zinc-500">{draft.signin.tagline}</div>}
        <div className="mt-3 h-7 border border-zinc-300" />
        <div className="mt-2 inline-flex h-7 w-full items-center justify-center bg-accent-600 font-medium text-on-accent">
          Sign in
        </div>
        {(!draft.signin.ownLinks || draft.signin.termsUrl || draft.signin.privacyUrl) && (
          <div className="mt-3 flex justify-center gap-3 text-zinc-500">
            {(!draft.signin.ownLinks || draft.signin.termsUrl) && (
              <span className="underline">Terms</span>
            )}
            {(!draft.signin.ownLinks || draft.signin.privacyUrl) && (
              <span className="underline">Privacy</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabView({ draft, name }: { draft: Theme; name: string }) {
  const icon = draft.favicon ?? draft.logo;
  const side = draft.helpPosition === 'left' ? 'left-3' : 'right-3';
  const credit = [draft.publicPages.footer, 'Powered by Grids'].filter(Boolean).join(' · ');
  return (
    <div className="min-h-80 bg-zinc-200 pt-3">
      <div
        className="mx-3 flex h-3 items-center"
        aria-hidden
        style={draft.toolbarColour ? { background: draft.primaryColor } : undefined}
      />
      <div className="flex flex-wrap gap-2 px-3">
        <div className="inline-flex max-w-full items-center gap-2 bg-snow px-3 py-2 text-xs">
          {icon ? (
            <img src={icon} alt="" className="size-4 object-contain" />
          ) : (
            <span className="size-4 bg-accent-600" />
          )}
          <span className="truncate">{['People', draft.tabTitle || name].join(' · ')}</span>
        </div>
        <div className="inline-flex max-w-full items-center gap-2 bg-chrome px-3 py-2 text-xs text-zinc-200">
          {(draft.faviconDark ?? icon) ? (
            <img src={(draft.faviconDark ?? icon)!} alt="" className="size-4 object-contain" />
          ) : (
            <span className="size-4 bg-accent-600" />
          )}
          <span className="truncate">{['People', draft.tabTitle || name].join(' · ')}</span>
        </div>
      </div>
      <div className="relative mx-3 h-60 bg-snow">
        <div className="space-y-2 p-4">
          <div className="h-2.5 w-1/3 bg-zinc-200" />
          <div className="h-2 w-5/6 bg-zinc-100" />
          <div className="h-2 w-2/3 bg-zinc-100" />
        </div>
        {credit && (
          <div className="absolute inset-x-0 bottom-0 border-t border-zinc-100 px-3 py-1.5 text-center text-[10px] text-zinc-500">
            {credit}
          </div>
        )}
        <div
          className={cx(
            'absolute bottom-10 w-32 border border-zinc-200 bg-snow text-[10px] shadow-lg',
            side,
          )}
        >
          <div className="bg-accent-600 px-2 py-1 font-semibold text-on-accent">Get help</div>
          <div className="space-y-1 p-2">
            <div className="h-1.5 w-5/6 bg-zinc-100" />
            <div className="h-1.5 w-2/3 bg-zinc-100" />
          </div>
        </div>
        <div
          className={cx(
            'absolute bottom-3 flex size-7 items-center justify-center rounded-full bg-accent-600 text-on-accent',
            side,
          )}
        >
          <LifeBuoy className="size-4" />
        </div>
      </div>
    </div>
  );
}

/** The help window people open on public pages, as it looks with these colours. */
function HelpView({ draft, name }: { draft: Theme; name: string }) {
  const left = draft.helpPosition === 'left';
  const credit = [draft.publicPages.footer, 'Powered by Grids'].filter(Boolean).join(' · ');
  return (
    <div className="relative min-h-[26rem] overflow-hidden bg-zinc-200 p-3">
      <div className="h-full min-h-[24rem] space-y-2 bg-snow p-4">
        <div className="h-2.5 w-1/3 bg-zinc-200" />
        <div className="h-2 w-5/6 bg-zinc-100" />
        <div className="h-2 w-2/3 bg-zinc-100" />
        {credit && (
          <div className="absolute inset-x-3 bottom-3 border-t border-zinc-100 bg-snow px-3 py-1.5 text-center text-[10px] text-zinc-500">
            {credit}
          </div>
        )}
      </div>
      <div className={cx('absolute bottom-14 w-72 overflow-hidden rounded-[18px] bg-snow text-xs shadow-2xl', left ? 'start-6' : 'end-6')}>
        <header className="flex items-center gap-2 bg-accent-600 px-4 py-3 text-on-accent">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
            <LifeBuoy className="size-4 shrink-0" /> <span className="truncate">New request · {name}</span>
          </span>
          <X className="size-4 opacity-70" aria-hidden />
        </header>
        <div className="space-y-3 p-4">
          <p className="text-zinc-600">Tell us what you need and we will get back to you.</p>
          <div className="h-8 border border-zinc-300 bg-snow px-2 leading-8 text-zinc-400">What is it about?</div>
          <div className="h-16 border border-zinc-300 bg-snow px-2 pt-1.5 text-zinc-400">Your message</div>
          <span className="inline-flex h-8 items-center bg-accent-600 px-3 font-medium text-on-accent">Send</span>
        </div>
      </div>
      <div className={cx('absolute bottom-6 flex size-8 items-center justify-center rounded-full bg-accent-600 text-on-accent', left ? 'start-6' : 'end-6')}>
        <LifeBuoy className="size-4" />
      </div>
    </div>
  );
}

const STANDARD = [
  '#6929c4',
  '#1192e8',
  '#005d5d',
  '#9f1853',
  '#fa4d56',
  '#198038',
  '#002d9c',
  '#b28600',
];
const PALETTES: { id: string; label: string; note: string; colors?: string[] }[] = [
  { id: 'standard', label: 'Standard', note: 'Clear, accessible colours', colors: STANDARD },
  { id: 'brand', label: 'Brand shades', note: 'Made from your brand colour' },
  {
    id: 'ocean',
    label: 'Ocean',
    note: 'Blues and teals',
    colors: ['#0b3c5d', '#1192e8', '#33b1ff', '#007d79', '#08bdba', '#82cfff'],
  },
  {
    id: 'warm',
    label: 'Warm',
    note: 'Reds, oranges and golds',
    colors: ['#a2191f', '#da1e28', '#ff832b', '#f1c21b', '#ba4e00', '#ff8389'],
  },
  {
    id: 'earth',
    label: 'Earth',
    note: 'Greens and browns',
    colors: ['#198038', '#24a148', '#6fdc8c', '#8e6a00', '#ba4e00', '#525252'],
  },
  { id: 'custom', label: 'Your own', note: 'Pick each colour' },
];
const SAME = (a: string[], b: string[]) =>
  a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i]!.toLowerCase());
/** Which palette tile a theme's chart colours match. */
function paletteId(c: Theme['chartColors']): string {
  if (c.mode !== 'custom') return c.mode;
  return (
    PALETTES.find((p) => p.colors && p.id !== 'standard' && SAME(p.colors, c.colors))?.id ??
    'custom'
  );
}

type NavItem = [React.ComponentType<{ className?: string }>, string];
const WORKSPACE_ITEMS: NavItem[] = [
  [Home, 'Home'],
  [Users, 'People'],
  [Network, 'Structure'],
];
const DASHBOARD_ITEMS: NavItem[] = [
  [Home, 'Home'],
  [LayoutDashboard, 'Dashboards'],
  [Network, 'Structure'],
];

/** The workspace navigation as the sidebar setting would draw it. */
function PreviewSidebar({
  draft,
  name,
  items,
  active,
}: {
  draft: Theme;
  name: string;
  items: NavItem[];
  active: number;
}) {
  return (
    <div
      className={cx(
        'flex w-40 shrink-0 flex-col',
        draft.sidebar === 'dark'
          ? 'chrome bg-chrome text-zinc-300'
          : draft.sidebar === 'light'
            ? 'border-r border-zinc-200 bg-snow text-zinc-700'
            : 'bg-accent-700 text-on-accent',
      )}
    >
      <div className="flex items-center gap-2 border-b border-current/10 p-3">
        {(draft.sidebar === 'dark' && draft.logoDark) || draft.logo ? (
          <img
            src={(draft.sidebar === 'dark' && draft.logoDark) || draft.logo!}
            alt=""
            className="size-6 object-contain"
          />
        ) : (
          <span className="flex size-6 items-center justify-center bg-accent-600 text-xs font-semibold text-on-accent">
            {name.slice(0, 1)}
          </span>
        )}
        <span className="truncate text-xs font-semibold">{name}</span>
      </div>
      {items.map(([Icon, label], i) => (
        <div
          key={label}
          className={cx(
            'flex items-center gap-2 border-s-[3px] px-3 py-1.5 text-xs',
            i === active
              ? draft.sidebar === 'brand'
                ? 'border-on-accent bg-black/20'
                : 'border-accent-500 bg-accent-600/10'
              : 'border-transparent',
          )}
        >
          <Icon className="size-3.5" /> {label}
        </div>
      ))}
    </div>
  );
}

function ChartsView({ draft, name }: { draft: Theme; name: string }) {
  const colours = (chartPalette(draft.chartColors, draft.primaryColor) ?? STANDARD).slice(0, 4);
  const series = [
    { name: 'Confirmed', data: [18, 26, 24, 38, 47, 55, 62] },
    { name: 'Probable', data: [12, 15, 22, 21, 30, 33, 41] },
    { name: 'Suspected', data: [8, 10, 9, 15, 14, 19, 22] },
    { name: 'Ruled out', data: [3, 5, 4, 6, 8, 7, 10] },
  ];
  const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
  const W = 420;
  const H = 180;
  const L = 36;
  const R = 10;
  const T = 8;
  const B = 26;
  const x = (i: number) => L + (i * (W - L - R)) / (weeks.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / 70);
  const kpis: [string, string, string][] = [
    ['Cases this week', '62', '+12%'],
    ['Under review', '41', '−4%'],
    ['Districts reporting', '18', '+2'],
  ];
  return (
    <div className="flex min-h-80">
      <PreviewSidebar draft={draft} name={name} items={DASHBOARD_ITEMS} active={1} />
      <div className="min-w-0 flex-1 space-y-3 p-4">
        <div className="text-sm font-semibold">Surveillance overview</div>
        <div className="grid grid-cols-3 gap-2">
          {kpis.map(([label, value, delta], i) => (
            <div key={label} className="border border-zinc-200 bg-snow p-2">
              <div className="truncate text-[10px] text-zinc-500">{label}</div>
              <div className="num text-base font-semibold">{value}</div>
              <div
                className="text-[10px] font-medium"
                style={{ color: colours[i % colours.length] }}
              >
                {delta}
              </div>
            </div>
          ))}
        </div>
        <div className="border border-zinc-200 bg-snow p-3">
          <div className="text-xs font-semibold">Cases by week</div>
          <div className="text-[10px] text-zinc-500">Reported cases, last 7 weeks</div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-600">
            {series.map((sr, i) => (
              <span key={sr.name} className="inline-flex items-center gap-1">
                <i
                  className="size-2 shrink-0"
                  style={{ background: colours[i % colours.length] }}
                />{' '}
                {sr.name}
              </span>
            ))}
          </div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-1 w-full"
            role="img"
            aria-label="Sample line chart"
          >
            {[0, 20, 40, 60].map((v) => (
              <g key={v}>
                <line
                  x1={L}
                  x2={W - R}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="#e4e4e7"
                  strokeDasharray={v ? '3 3' : undefined}
                />
                <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#71717a">
                  {v}
                </text>
              </g>
            ))}
            {weeks.map((w, i) => (
              <text key={w} x={x(i)} y={H - 12} textAnchor="middle" fontSize="10" fill="#71717a">
                {w}
              </text>
            ))}
            <text x={(L + W - R) / 2} y={H - 1} textAnchor="middle" fontSize="10" fill="#52525b">
              Week of report
            </text>
            <text
              transform={`translate(8 ${(T + H - B) / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize="10"
              fill="#52525b"
            >
              Cases
            </text>
            {series.map((sr, i) => {
              const c = colours[i % colours.length]!;
              return (
                <g key={sr.name}>
                  <polyline
                    fill="none"
                    stroke={c}
                    strokeWidth="2"
                    points={sr.data.map((v, j) => `${x(j)},${y(v)}`).join(' ')}
                  />
                  {sr.data.map((v, j) => (
                    <circle key={j} cx={x(j)} cy={y(v)} r="2.5" fill={c} />
                  ))}
                </g>
              );
            })}
          </svg>
          <div className="border-t border-zinc-100 pt-1.5 text-[10px] text-zinc-500">
            Source: surveillance reports. Counts include cases awaiting review.
          </div>
        </div>
      </div>
    </div>
  );
}

const BACKGROUNDS = [
  ['mist', 'Soft', 'Light grey, calm', 'bg-zinc-100'],
  ['dark', 'Dark', 'Dark, high contrast', 'bg-chrome'],
  ['glow', 'Brand glow', 'A tint of your colour', 'bg-accent-100'],
  [
    'stripes',
    'Stripes',
    'Light with fine lines',
    'bg-zinc-100 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(0_0_0/0.06)_6px_12px)]',
  ],
] as const;

/** One surface as it will look with the draft applied. */
function BrandPreview({
  draft,
  view,
  name,
  tenantName,
}: {
  draft: Theme;
  view: View;
  name: string;
  tenantName: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) applyTheme(draft, ref.current);
  }, [draft, view]);
  return (
    <div
      ref={ref}
      className={cx(
        'min-h-80 overflow-hidden border border-zinc-200 bg-canvas',
        view === 'workspace' && 'flex',
      )}
      aria-label="Branding preview"
    >
      {view === 'workspace' && (
        <>
          <PreviewSidebar draft={draft} name={name} items={WORKSPACE_ITEMS} active={1} />
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
              Your branding applies to everyone in {tenantName}.
            </div>
          </div>
        </>
      )}
      {view === 'signin' && <SigninView draft={draft} name={name} />}
      {view === 'tab' && <TabView draft={draft} name={name} />}
      {view === 'charts' && <ChartsView draft={draft} name={name} />}
      {view === 'help' && <HelpView draft={draft} name={name} />}
    </div>
  );
}

/** A choice of bottom-left or bottom-right, drawn as a corner. */
function SidePick({
  title,
  intro,
  value,
  onChange,
}: {
  title: string;
  intro: string;
  value: 'left' | 'right';
  onChange(v: 'left' | 'right'): void;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[13px] font-medium text-zinc-700">{title}</div>
      <p className="mb-2 text-xs text-zinc-500">{intro}</p>
      <div role="radiogroup" aria-label={title} className="grid grid-cols-2 gap-3">
        {(['left', 'right'] as const).map((side) => (
          <button
            key={side}
            role="radio"
            aria-checked={value === side}
            onClick={() => onChange(side)}
            className={cx(
              'border p-2 text-start',
              value === side
                ? 'border-accent-600 bg-accent-50'
                : 'border-zinc-200 hover:border-zinc-400',
            )}
          >
            <span className="relative block h-14 border border-zinc-200 bg-zinc-50">
              <i
                className={cx(
                  'absolute bottom-1.5 block size-4 bg-accent-600',
                  side === 'left' ? 'left-1.5' : 'right-1.5',
                )}
              />
            </span>
            <span className="mt-2 block text-sm font-medium">Bottom {side}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A titled box of settings, in the organisation's colour: the same as on a project's settings page. */
function BrandCard({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  const color = 'var(--brand-600)';
  return (
    <section
      className="border border-s-[3px] border-zinc-200 bg-snow"
      style={{ borderInlineStartColor: color }}
    >
      <header
        className="border-b px-5 py-3.5"
        style={{
          background: `color-mix(in srgb, ${color} 7%, var(--color-snow))`,
          borderBottomColor: `color-mix(in srgb, ${color} 18%, var(--color-zinc-200))`,
        }}
      >
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-zinc-500">{text}</p>
      </header>
      <div className="min-w-0 space-y-5 p-5">{children}</div>
    </section>
  );
}

export function BrandingPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Theme>(ws.theme);
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

  const [section, setSection] = useState('workspace');
  const [previewing, setPreviewing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chartEdit, setChartEdit] = useState<number | null>(null);
  const setChartColours = (colors: string[]) => set('chartColors', { mode: 'custom', colors });
  const setPalette = (id: string) => {
    const pl = PALETTES.find((x) => x.id === id)!;
    if (id === 'standard' || id === 'brand')
      set('chartColors', { mode: id, colors: draft.chartColors.colors });
    else
      set('chartColors', {
        mode: 'custom',
        colors:
          pl.colors ??
          (draft.chartColors.colors.length ? draft.chartColors.colors : STANDARD.slice(0, 4)),
      });
  };
  const custom = !PRESETS.includes(draft.primaryColor.toLowerCase());
  const dirty = JSON.stringify(draft) !== JSON.stringify(ws.theme);
  const name = draft.appName || ws.tenant.name;
  const ident = (
    <div className="space-y-5">
      <Field label="Workspace name" hint={`Shown instead of “${ws.tenant.name}” when set`}>
        <Input
          icon={Building2}
          value={draft.appName}
          onChange={(e) => set('appName', e.target.value)}
          placeholder={ws.tenant.name}
          maxLength={40}
        />
      </Field>
      <Field label="Welcome message" hint="Shown on everyone’s home page">
        <Textarea
          rows={3}
          value={draft.welcomeMessage}
          onChange={(e) => set('welcomeMessage', e.target.value)}
          maxLength={500}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <ImageField
          label="Logo"
          intro="Shown in the sidebar and on sign-in"
          aspect="wide"
          value={draft.logo}
          maxSize={256}
          onChange={(logo) => set('logo', logo)}
        />
        <ImageField
          label="Dark logo"
          intro="For dark backgrounds; the logo if empty"
          aspect="wide"
          value={draft.logoDark}
          maxSize={256}
          onChange={(v) => set('logoDark', v)}
        />
      </div>
    </div>
  );
  const colourPart = (
    <div className="space-y-5">
      <div>
        <div>
          <div className="mb-0.5 text-[13px] font-medium text-zinc-700">Brand colour</div>
          <p className="mb-2 text-xs text-zinc-500">
            Used for buttons, links and highlights across the workspace.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => set('primaryColor', c)}
                aria-label={`Use ${c}`}
                aria-pressed={draft.primaryColor.toLowerCase() === c}
                className="flex size-9 items-center justify-center"
                style={{ background: c }}
              >
                {draft.primaryColor.toLowerCase() === c && (
                  <Check className="size-4" style={{ color: contrastOn(c) }} />
                )}
              </button>
            ))}
            {/* Any other colour: the tile shows it once chosen, and opens the colour window. */}
            <button
              type="button"
              title="Pick any colour"
              aria-label="Pick any colour"
              onClick={() => setPicking(true)}
              className={cx(
                'flex size-9 items-center justify-center text-zinc-500 hover:text-ink',
                !custom && 'border-2 border-dashed border-zinc-300 bg-zinc-50',
              )}
              style={custom ? { background: draft.primaryColor } : undefined}
            >
              {custom ? (
                <Check className="size-4" style={{ color: contrastOn(draft.primaryColor) }} />
              ) : (
                <Plus className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>
      <div>
        <div className="mb-0.5 text-[13px] font-medium text-zinc-700">Sidebar</div>
        <p className="mb-2 text-xs text-zinc-500">How the navigation panel on the left looks.</p>
        <div role="radiogroup" aria-label="Sidebar style" className="grid grid-cols-3 gap-3">
          {(['dark', 'light', 'brand'] as const).map((st) => (
            <button
              key={st}
              role="radio"
              aria-checked={draft.sidebar === st}
              onClick={() => set('sidebar', st)}
              className={cx(
                'border p-2 text-start transition-colors',
                draft.sidebar === st
                  ? 'border-accent-600 bg-accent-50'
                  : 'border-zinc-200 hover:border-zinc-400',
              )}
            >
              <span className="flex h-16 border border-zinc-200 bg-zinc-50">
                <span
                  className={cx(
                    'flex w-1/3 flex-col gap-1.5 p-2',
                    st === 'dark'
                      ? 'bg-chrome'
                      : st === 'light'
                        ? 'border-r border-zinc-200 bg-snow'
                        : 'bg-accent-700',
                  )}
                >
                  {[0, 1, 2].map((i) => (
                    <i
                      key={i}
                      className={cx(
                        'h-1.5',
                        st === 'light' ? 'bg-zinc-300' : 'bg-white/40',
                        i === 1 && 'w-2/3',
                      )}
                    />
                  ))}
                </span>
                <span className="flex-1 space-y-1.5 p-2">
                  <i className="block h-1.5 w-1/2 bg-zinc-300" />
                  <i className="block h-5 bg-snow" />
                </span>
              </span>
              <span className="mt-2 block text-sm font-medium">
                {st === 'brand' ? 'Brand colour' : st === 'dark' ? 'Dark' : 'Light'}
              </span>
              <span className="block text-xs text-zinc-500">
                {st === 'brand'
                  ? 'Filled with your colour'
                  : st === 'dark'
                    ? 'Dark panel, light text'
                    : 'White panel, soft lines'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  const chartsPart = (
    <div id="charts" className="scroll-mt-24 space-y-3">
      <div className="text-[13px] font-medium text-zinc-700">Charts</div>
      <p className="mb-2 text-xs text-zinc-500">
        Colours used for chart series on dashboards. Pick a set or build your own.
      </p>
      <div
        role="radiogroup"
        aria-label="Chart palette"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {PALETTES.map((pl) => {
          const on = paletteId(draft.chartColors) === pl.id;
          const colours =
            pl.colors ??
            (pl.id === 'brand' ? brandRange(draft.primaryColor) : draft.chartColors.colors);
          return (
            <button
              key={pl.id}
              role="radio"
              aria-checked={on}
              onClick={() => setPalette(pl.id)}
              className={cx(
                'flex flex-col justify-start border p-2 text-start',
                on ? 'border-accent-600 bg-accent-50' : 'border-zinc-200 hover:border-zinc-400',
              )}
            >
              <span className="flex h-6">
                {(colours.length ? colours : ['#d4d4d8']).slice(0, 8).map((c, i) => (
                  <i key={i} className="block flex-1" style={{ background: c }} />
                ))}
              </span>
              <span className="mt-2 block text-sm font-medium">{pl.label}</span>
              <span className="block text-xs text-zinc-500">{pl.note}</span>
            </button>
          );
        })}
      </div>
      {draft.chartColors.mode === 'custom' && (
        <div>
          <div className="mb-1 text-xs text-zinc-500">
            Your colours, in the order series use them. Click one to change it; the × clears it.
            With none, the standard set is used.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: 8 }, (_, i) => draft.chartColors.colors[i]).map((c, i) =>
              c ? (
                <span key={i} className="group relative">
                  <button
                    type="button"
                    aria-label={`Change colour ${i + 1}`}
                    onClick={() => setChartEdit(i)}
                    className="block size-9"
                    style={{ background: c }}
                  />
                  <button
                    type="button"
                    aria-label={`Clear colour ${i + 1}`}
                    onClick={() =>
                      setChartColours(draft.chartColors.colors.filter((_, j) => j !== i))
                    }
                    className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center bg-ink text-white group-focus-within:flex group-hover:flex"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ) : (
                <button
                  key={i}
                  type="button"
                  aria-label={`Add colour ${i + 1}`}
                  onClick={() => setChartEdit(-1)}
                  className="flex size-9 items-center justify-center border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 hover:text-ink"
                >
                  <Plus className="size-4" />
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
  const signinPart = (
    <div className="space-y-5">
      <div>
        <div className="mb-0.5 text-[13px] font-medium text-zinc-700">Background</div>
        <p className="mb-2 text-xs text-zinc-500">Behind the sign-in card.</p>
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          role="radiogroup"
          aria-label="Sign-in background"
        >
          {BACKGROUNDS.map(([id, label, note, cls]) => (
            <button
              key={id}
              role="radio"
              aria-checked={draft.signin.background === id}
              onClick={() => set('signin', { ...draft.signin, background: id })}
              className={cx(
                'border p-2 text-start',
                draft.signin.background === id
                  ? 'border-accent-600 bg-accent-50'
                  : 'border-zinc-200 hover:border-zinc-400',
              )}
            >
              <span className={cx('flex h-20 items-center justify-center', cls)}>
                <span className="w-12 space-y-1 border border-zinc-200 bg-snow p-1.5">
                  <i className="mx-auto block size-2.5 bg-accent-600" />
                  <i className="block h-1 bg-zinc-200" />
                  <i className="block h-2 bg-accent-600" />
                </span>
              </span>
              <span className="mt-2 block text-sm font-medium">{label}</span>
              <span className="block text-xs text-zinc-500">{note}</span>
            </button>
          ))}
        </div>
      </div>
      <Field label="Line under the name" hint="For example “Ministry of Health”">
        <Input
          value={draft.signin.tagline}
          maxLength={80}
          onChange={(e) => set('signin', { ...draft.signin, tagline: e.target.value })}
        />
      </Field>
      <div className="space-y-4">
        <ToggleRow
          label="Use my own terms and privacy links"
          description="Off: the sign-in page links to the platform's terms and privacy pages."
          checked={draft.signin.ownLinks}
          onChange={(v) => set('signin', { ...draft.signin, ownLinks: v })}
        />
        {draft.signin.ownLinks && (
          <>
            <Field label="Terms link" hint="Where “Terms” opens. Leave empty to hide it.">
              <Input
                icon={FileText}
                placeholder="https://example.org/terms"
                value={draft.signin.termsUrl}
                onChange={(e) =>
                  set('signin', { ...draft.signin, termsUrl: e.target.value.trim() })
                }
              />
            </Field>
            <Field label="Privacy link" hint="Where “Privacy” opens. Leave empty to hide it.">
              <Input
                icon={ShieldCheck}
                placeholder="https://example.org/privacy"
                value={draft.signin.privacyUrl}
                onChange={(e) =>
                  set('signin', { ...draft.signin, privacyUrl: e.target.value.trim() })
                }
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
  const tabPart = (
    <div className="space-y-5">
      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <ImageField
            label="Tab icon"
            intro="For light browsers; the logo if empty"
            aspect="wide"
            value={draft.favicon}
            maxSize={128}
            onChange={(v) => set('favicon', v)}
          />
          <ImageField
            label="Tab icon, dark"
            intro="For dark browsers; the light icon if empty"
            aspect="wide"
            value={draft.faviconDark}
            maxSize={128}
            onChange={(v) => set('faviconDark', v)}
          />
        </div>
        <div className="space-y-5">
          <Field label="Tab title" hint="Shown after the page name; the workspace name when empty">
            <Input
              value={draft.tabTitle}
              maxLength={40}
              onChange={(e) => set('tabTitle', e.target.value)}
              placeholder={draft.appName || ws.tenant.name}
            />
          </Field>
          <ToggleRow
            label="Colour the toolbar"
            description="On phones, the browser's top bar uses your brand colour."
            checked={draft.toolbarColour}
            onChange={(v) => set('toolbarColour', v)}
          />
        </div>
      </div>
      <SidePick
        title="Help button on the platform"
        intro="Which corner it sits in inside the workspace."
        value={draft.platformHelpPosition ?? draft.helpPosition}
        onChange={(v) => set('platformHelpPosition', v)}
      />
      <SidePick
        title="Help button on the front end"
        intro="Which corner it sits in on pages anyone can open, the portal and embedded windows."
        value={draft.helpPosition}
        onChange={(v) => set('helpPosition', v)}
      />
    </div>
  );
  const publicPart = (
    <div className="space-y-8">
      <div className="space-y-5">
        <ToggleRow
          label="Show “Powered by Grids”"
          description="Always shown in the corner of pages anyone can open."
          checked
          disabled
          onChange={() => undefined}
        />
        <Field label="Footer text" hint="Shown on pages anyone can open">
          <Input
            value={draft.publicPages.footer}
            maxLength={200}
            onChange={(e) => set('publicPages', { ...draft.publicPages, footer: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
  // Every section is open: its fields on the left, how it looks beside them.
  const sections: {
    id: string;
    title: string;
    about: string;
    icon: LucideIcon;
    views: View[];
    body: React.ReactNode;
    /** Several boxes in one section, instead of one around the body. */
    cards?: { title: string; about: string; body: React.ReactNode }[];
  }[] = [
    {
      id: 'workspace',
      title: 'Workspace',
      about: 'Name, logos and welcome message.',
      icon: Building2,
      views: ['workspace'],
      body: ident,
    },
    {
      id: 'colour',
      title: 'Colour and charts',
      about: 'Used for buttons, links, highlights, the sidebar and chart series.',
      icon: BarChart3,
      views: ['charts'],
      body: null,
      cards: [
        {
          title: 'Colour',
          about: 'Used for buttons, links, highlights and the sidebar.',
          body: colourPart,
        },
        { title: 'Charts', about: 'The colours of chart series.', body: chartsPart },
      ],
    },
    {
      id: 'signin',
      title: 'Sign-in page',
      about: 'What people see before they sign in.',
      icon: LogIn,
      views: ['signin'],
      body: signinPart,
    },
    {
      id: 'tab',
      title: 'Browser and help',
      about: 'The browser tab, the phone toolbar, and the help button.',
      icon: AppWindow,
      views: ['tab'],
      body: tabPart,
    },
    {
      id: 'public',
      title: 'Public pages',
      about: 'Pages anyone can open: the credit and footer at the bottom.',
      icon: Globe,
      views: ['tab'],
      body: publicPart,
    },
  ];
  const layoutC = (
    <VerticalTabs
      label="Branding"
      value={section}
      onChange={setSection}
      tabs={sections.map((x) => ({ id: x.id, label: x.title, icon: x.icon }))}
    >
      {sections
        .filter((s) => s.id === section)
        .map((s) => (
          <section key={s.id} id={s.id} className="max-w-4xl space-y-6">
            {(s.cards ?? [{ title: s.title, about: s.about, body: s.body }]).map((c) => (
              <BrandCard key={c.title} title={c.title} text={c.about}>
                {c.body}
              </BrandCard>
            ))}
          </section>
        ))}
    </VerticalTabs>
  );
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.nav.branding')}
        meta={<span>Make the workspace look like {ws.tenant.name}.</span>}
        actions={
          <>
            <Button variant="secondary" icon={Eye} onClick={() => setPreviewing(true)}>
              Preview
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(ws.theme)}>
                Discard changes
              </Button>
            )}
            <Button
              icon={SaveIcon}
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!dirty}
            >
              Save
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
      {layoutC}
      {chartEdit !== null && (
        <ColourDialog
          value={chartEdit >= 0 ? (draft.chartColors.colors[chartEdit] ?? '#0f62fe') : '#0f62fe'}
          onPick={(c) => {
            const cur = [...draft.chartColors.colors];
            if (chartEdit >= 0) cur[chartEdit] = c;
            else cur.push(c);
            setChartColours(cur);
          }}
          onClose={() => setChartEdit(null)}
        />
      )}
      {previewing && (
        <Dialog
          open
          wide="full"
          onClose={() => setPreviewing(false)}
          title="Preview"
          description="How your branding looks across the workspace, with your changes before they are saved."
        >
          <div className="space-y-6">
            {(
              [
                ['workspace', 'Workspace'],
                ['charts', 'Charts'],
                ['signin', 'Sign-in page'],
                ['tab', 'Browser and help button'],
                ['help', 'Help window on public pages'],
              ] as const
            ).map(([v, title]) => (
              <section key={v}>
                <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                <BrandPreview draft={draft} view={v} name={name} tenantName={ws.tenant.name} />
              </section>
            ))}
          </div>
        </Dialog>
      )}
      {picking && (
        <ColourDialog
          value={draft.primaryColor}
          onPick={(c) => set('primaryColor', c)}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

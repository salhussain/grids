import { CalendarDays, CircleDot, History, Search, ShieldOff, UsersRound, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_SESSION_POLICY, SessionPolicy, type ActiveSessionDto, type PastSessionDto } from '@grids/schema';
import { Button, Empty, ErrorNotice, Input, Panel, SectionHead, Table, Td } from './components';
import { FilterMenu, type FilterCategory, type FilterValue } from './filterMenu';
import { confirmDialog } from './confirm';

const toDraft = (p: SessionPolicy) => ({
  idle: String(p.idleTimeoutMinutes),
  warning: String(p.warningSeconds),
  max: String(p.maxSessionHours),
});

function Line({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-zinc-500">{hint}</div>
      </div>
      {children}
    </div>
  );
}

/** An organisation's idle timeout, warning and longest session. Shared by the platform console and the workspace. */
export function SessionPolicyPanel({
  value: saved,
  saving,
  disabled,
  error,
  onSave,
}: {
  value?: SessionPolicy;
  saving?: boolean;
  disabled?: boolean;
  error?: unknown;
  onSave(policy: SessionPolicy): void;
}) {
  // Until the server has it (an older API), the defaults stand in.
  const value = saved ?? DEFAULT_SESSION_POLICY;
  const [draft, setDraft] = useState(toDraft(value));
  // A save (or a change from elsewhere) brings the saved values back in.
  useEffect(
    () => setDraft(toDraft(value)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.idleTimeoutMinutes, value.warningSeconds, value.maxSessionHours],
  );
  const parsed = SessionPolicy.safeParse({
    idleTimeoutMinutes: Number(draft.idle),
    warningSeconds: Number(draft.warning),
    maxSessionHours: Number(draft.max),
  });
  const problem = !parsed.success
    ? parsed.error.issues[0]?.path[0] === 'idleTimeoutMinutes'
      ? 'Idle timeout: 1 to 480 minutes'
      : parsed.error.issues[0]?.path[0] === 'warningSeconds'
        ? 'Warning: 15 to 300 seconds'
        : 'Longest session: 1 to 12 hours'
    : parsed.data.warningSeconds >= parsed.data.idleTimeoutMinutes * 60
      ? 'The warning must be shorter than the idle timeout'
      : null;
  const changed =
    parsed.success &&
    (parsed.data.idleTimeoutMinutes !== value.idleTimeoutMinutes ||
      parsed.data.warningSeconds !== value.warningSeconds ||
      parsed.data.maxSessionHours !== value.maxSessionHours);
  const input = (
    key: keyof typeof draft,
    min: number,
    max: number,
    unit: string,
    label: string,
  ) => (
    <span className="flex items-center gap-2 text-sm text-zinc-500">
      <Input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        className="w-24"
        value={draft[key]}
        disabled={disabled}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
      <span className="w-14">{unit}</span>
    </span>
  );
  return (
    <div>
      <SectionHead
        title="Session limits"
        description="How long people in this organisation stay signed in. They can always sign in again."
      />
      <div className="divide-y divide-zinc-100">
        <Line label="Idle timeout" hint="Signed out after this long without activity (1–480)">
          {input('idle', 1, 480, 'minutes', 'Idle timeout in minutes')}
        </Line>
        <Line label="Warning" hint="A countdown shows this long before that (15–300)">
          {input('warning', 15, 300, 'seconds', 'Warning in seconds')}
        </Line>
        <Line label="Longest session" hint="Signed in again after this, however active (1–12)">
          {input('max', 1, 12, 'hours', 'Longest session in hours')}
        </Line>
      </div>
      <div className="mt-4 space-y-4">
        {problem && changed !== undefined && <p className="text-xs text-red-700">{problem}</p>}
        <ErrorNotice error={error} />
        <div className="flex items-center gap-2">
          <Button
            disabled={disabled || !!problem || !changed}
            loading={saving}
            onClick={() => parsed.success && onSave(parsed.data)}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => setDraft(toDraft(DEFAULT_SESSION_POLICY))}
          >
            Reset to defaults
          </Button>
        </div>
      </div>
    </div>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '–');

/** How far back each "period" choice reaches. */
const WINDOWS: { value: string; label: string; ms: number }[] = [
  { value: '1h', label: 'Last hour', ms: 3_600_000 },
  { value: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
  { value: '90d', label: 'Last 90 days', ms: 90 * 86_400_000 },
];

/** A search box and a Filter button with its chips, as in the support inbox. Period takes one range at a time. */
function useListFilters(categories: FilterCategory[]) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const set = (next: FilterValue) => {
    const was = filters.period ?? [];
    const now = next.period ?? [];
    setFilters({ ...next, period: now.length > 1 ? now.filter((x) => !was.includes(x)) : now });
  };
  const since = (() => {
    const w = WINDOWS.find((x) => x.value === filters.period?.[0]);
    return w ? Date.now() - w.ms : null;
  })();
  const active = !!q || Object.values(filters).some((v) => v.length);
  const bar = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Input icon={Search} className="w-64" aria-label="Search" placeholder="Search person or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <FilterMenu categories={categories} value={filters} onChange={set} />
      {active && (
        <button type="button" onClick={() => (setQ(''), setFilters({}))} className="inline-flex h-9 items-center gap-1 text-xs text-zinc-500 hover:text-ink">
          <X className="size-3.5" /> Clear
        </button>
      )}
    </div>
  );
  return { q: q.trim().toLowerCase(), filters, since, active, bar };
}

/** Who is signed in to the organisation right now, with a way to sign one out. */
export function ActiveSessionsList({
  sessions,
  loading,
  revoking,
  disabled,
  error,
  onRevoke,
}: {
  sessions: ActiveSessionDto[];
  loading?: boolean;
  revoking?: boolean;
  disabled?: boolean;
  error?: unknown;
  onRevoke(id: string): void;
}) {
  const people = [...new Map(sessions.map((s) => [s.email, s.name ?? s.email])).entries()];
  const f = useListFilters([
    { id: 'person', label: 'Person', icon: CircleDot, options: people.map(([email, name]) => ({ value: email, label: name })) },
    { id: 'period', label: 'Signed in', icon: CalendarDays, options: WINDOWS.map((w) => ({ value: w.value, label: w.label })) },
  ]);
  const shown = sessions.filter(
    (s) =>
      (!f.filters.person?.length || f.filters.person.includes(s.email)) &&
      (f.since === null || (s.signedInAt !== null && new Date(s.signedInAt).getTime() >= f.since)) &&
      (!f.q || `${s.name ?? ''} ${s.email}`.toLowerCase().includes(f.q)),
  );
  return (
    <>
      <SectionHead
        title="Active sessions"
        description="Everyone signed in to this organisation right now. Signing someone out ends their session within minutes."
      />
      <ErrorNotice error={error} />
      {f.bar}
      <Panel flush>
        <Table head={['Person', 'Signed in', 'Expires', '']} empty={loading ? 'Loading…' : <Empty icon={UsersRound} title={f.active ? 'Nothing matches' : 'Nobody is signed in'}>{f.active ? 'Try different filters.' : 'People appear here while they are signed in.'}</Empty>}>
          {shown.map((s) => {
            const name = s.name ?? s.email;
            return (
              <tr key={s.id} className="border-t border-zinc-100">
                <Td>
                  <div className="font-medium">{name}</div>
                  {s.name && <div className="text-xs text-zinc-500">{s.email}</div>}
                </Td>
                <Td className="text-zinc-500">{when(s.signedInAt)}</Td>
                <Td className="text-zinc-500">{when(s.expiresAt)}</Td>
                <Td>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      aria-label={`Sign ${name} out`}
                      title="Sign out"
                      disabled={disabled || revoking}
                      className="p-1.5 text-zinc-500 hover:text-[#7a1f24] disabled:opacity-40"
                      onClick={async () =>
                        (await confirmDialog(`Sign ${name} out of this session?`, { confirmLabel: 'Sign out', danger: true })) && onRevoke(s.id)
                      }
                    >
                      <ShieldOff className="size-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}

/** Sign-ins that are over, and attempts that failed, for the last 90 days. */
export function PastSessionsList({ sessions, loading, error }: { sessions: PastSessionDto[]; loading?: boolean; error?: unknown }) {
  const people = [...new Map(sessions.map((s) => [s.email, s.name ?? s.email])).entries()];
  const f = useListFilters([
    {
      id: 'result',
      label: 'Result',
      icon: CircleDot,
      options: [
        { value: 'ok', label: 'Signed in' },
        { value: 'failed', label: 'Failed attempt' },
      ],
    },
    { id: 'person', label: 'Person', icon: CircleDot, options: people.map(([email, name]) => ({ value: email, label: name })) },
    { id: 'period', label: 'When', icon: CalendarDays, options: WINDOWS.map((w) => ({ value: w.value, label: w.label })) },
  ]);
  const shown = sessions.filter(
    (s) =>
      (!f.filters.result?.length || f.filters.result.includes(s.success ? 'ok' : 'failed')) &&
      (!f.filters.person?.length || f.filters.person.includes(s.email)) &&
      (f.since === null || new Date(s.at).getTime() >= f.since) &&
      (!f.q || `${s.name ?? ''} ${s.email}`.toLowerCase().includes(f.q)),
  );
  return (
    <>
      <SectionHead title="Past sessions" description="Sign-ins that have ended, and attempts that failed, over the last 90 days." />
      <ErrorNotice error={error} />
      {f.bar}
      <Panel flush>
        <Table head={['Person', 'When', 'Address', 'Result']} empty={loading ? 'Loading…' : <Empty icon={History} title={f.active ? 'Nothing matches' : 'No past sessions yet'}>{f.active ? 'Try different filters.' : 'Sign-ins that have ended, and failed attempts, appear here.'}</Empty>}>
          {shown.map((s) => (
            <tr key={s.id} className="border-t border-zinc-100">
              <Td>
                <div className="font-medium">{s.name ?? s.email}</div>
                {s.name && <div className="text-xs text-zinc-500">{s.email}</div>}
              </Td>
              <Td className="text-zinc-500">{when(s.at)}</Td>
              <Td className="font-mono text-xs text-zinc-500">{s.ip ?? '–'}</Td>
              <Td>
                <span
                  className={
                    s.success
                      ? 'inline-flex border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-xs font-medium text-zinc-600'
                      : 'inline-flex border border-red-300 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800'
                  }
                >
                  {s.success ? 'Ended' : 'Failed'}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

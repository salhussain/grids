import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  type InvoiceDto,
  type OrgBillingDto,
  type OrgPlanDto,
} from '@grids/schema';
import {
  Button,
  Dialog,
  Empty,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  PageHeader,
  Pagination,
  Panel,
  SectionHead,
  Textarea,
  VerticalTabs,
  confirmDialog,
  countryName,
  cx,
  useToast,
  usePagination,
} from '@grids/ui';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Mail,
  CalendarClock,
  ClipboardList,
  Plug,
  Users,
  Check,
  Clock,
  FileDown,
  Database,
  FolderKanban,
  Gauge,
  HardDrive,
  Inbox,
  Layers,
  MessageSquarePlus,
  Printer,
  Receipt,
  ReceiptText,
  Send,
  Timer,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';
import { saveBlob } from './projects/DocumentsPanel';
import { api } from '../api';
import { useI18n, useT } from '../i18n';
import { invoiceRoute } from '../router';
import { NoAccess, useCan, useWorkspace } from '../session';

/** Locale-aware money and dates (the platform stores minor units). */
function useFormat() {
  const { locale } = useI18n();
  return {
    money: (minor: number, currency: string) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100),
    date: (iso: string | null | undefined) =>
      iso
        ? new Intl.DateTimeFormat(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }).format(new Date(iso))
        : '—',
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
  };
}

const TONE: Record<string, string> = {
  active: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  trialing: 'border-accent-100 bg-accent-50 text-accent-800',
  past_due: 'border-red-300 bg-red-50 text-red-800',
  pending_payment: 'border-amber-300 bg-amber-50 text-amber-800',
  cancelled: 'border-zinc-300 bg-zinc-50 text-zinc-600',
  paid: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  open: 'border-amber-300 bg-amber-50 text-amber-800',
  void: 'border-zinc-300 bg-zinc-50 text-zinc-600',
  overdue: 'border-red-300 bg-red-50 text-red-800',
};
const Badge = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={cx('inline-flex border px-1.5 py-0.5 text-xs font-medium', TONE[tone])}>
    {children}
  </span>
);

/** The deep maroon used for the project's archive box: the same look for anything that is blocked or taken away. */
const DANGER = {
  '--a': '#7a1f24',
  background: 'color-mix(in srgb, var(--a) 7%, var(--color-snow))',
  borderColor: 'color-mix(in srgb, var(--a) 22%, var(--color-zinc-200))',
  borderInlineStartColor: 'var(--a)',
} as React.CSSProperties;

type Tab = 'subscription' | 'plans' | 'history' | 'usage';

export function BillingPage() {
  const t = useT();
  const can = useCan();
  const ws = useWorkspace();
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const [tab, setTab] = useState<Tab>(search.tab ?? 'subscription');
  useEffect(() => {
    if (search.tab) setTab(search.tab);
  }, [search.tab]);
  const [requesting, setRequesting] = useState<false | 'plan' | 'details'>(false);
  const billing = useQuery({
    queryKey: ['billing', ws.tenant.id],
    queryFn: () => api.billing(ws.tenant.id),
    enabled: can('billing.view'),
  });
  if (!can('billing.view')) return <NoAccess what={t('web.nav.billing')} />;
  // An API that has not been restarted since the update does not send the newer fields: fill them in.
  const b: OrgBillingDto | undefined = billing.data && {
    ...billing.data,
    access: billing.data.access ?? { state: 'ok', endsAt: null, daysLeft: null },
    billTo: billing.data.billTo ?? {
      name: ws.tenant.name,
      legalName: null,
      taxId: null,
      registrationNumber: null,
      line1: null,
      line2: null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
    },
  };
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.billing.title')}
        meta={<span>{t('web.billing.intro')}</span>}
      />
      <ErrorNotice error={billing.error} />
      {billing.isPending ? (
        <Loading />
      ) : b ? (
        <div className="space-y-6">
          <Notices b={b} onRequest={() => setRequesting('plan')} />
          <VerticalTabs<Tab>
            label="Billing"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'history', label: 'Billing and invoices', icon: Receipt },
              { id: 'plans', label: 'Plans', icon: Layers },
              { id: 'subscription', label: 'Subscription', icon: CalendarClock },
              { id: 'usage', label: 'Usage and limits', icon: Gauge },
            ]}
          >
            {tab === 'subscription' && (
              <SubscriptionTab b={b} onRequest={() => setRequesting('plan')} />
            )}
            {tab === 'plans' && (
              <PlanComparison tenantId={ws.tenant.id} onRequest={() => setRequesting('plan')} />
            )}
            {tab === 'history' && <HistoryTab b={b} onRequest={() => setRequesting('details')} />}
            {tab === 'usage' && <UsageTab b={b} onRequest={() => setRequesting('plan')} />}
          </VerticalTabs>
        </div>
      ) : null}
      {requesting && (
        <PlanRequestDialog kind={requesting} b={b ?? null} onClose={() => setRequesting(false)} />
      )}
    </>
  );
}

/** What needs attention first: a subscription running out, a bill that is late, a limit that is used up. */
function Notices({ b, onRequest }: { b: OrgBillingDto; onRequest(): void }) {
  const t = useT();
  const f = useFormat();
  const full = b.usage.filter((u) => u.limit !== null && u.used !== null && u.used >= u.limit);
  const items: {
    tone: 'bad' | 'warn';
    icon: typeof AlertTriangle;
    text: React.ReactNode;
    action?: React.ReactNode;
  }[] = [];
  if (b.access.state === 'expiring' && b.access.endsAt)
    items.push({
      tone: 'warn',
      icon: Clock,
      text: `Your subscription ends on ${f.date(b.access.endsAt)} (${b.access.daysLeft} ${b.access.daysLeft === 1 ? 'day' : 'days'} left). Pay the renewal invoice to keep everything running; after that date nobody can sign in.`,
    });
  if (b.outstanding.overdue > 0)
    items.push({
      tone: 'bad',
      icon: AlertTriangle,
      text: `${b.outstanding.overdue} ${b.outstanding.overdue === 1 ? 'invoice is' : 'invoices are'} overdue (${f.money(b.outstanding.amount, b.outstanding.currency)} outstanding).`,
    });
  if (full.length)
    items.push({
      tone: 'bad',
      icon: Gauge,
      text: `Plan limit reached: ${full.map((u) => t(`web.billing.limitNames.${u.key}`)).join(', ')}. No more can be added until the plan is changed.`,
      action: (
        <Button size="sm" variant="secondary" icon={MessageSquarePlus} onClick={onRequest}>
          Request a change
        </Button>
      ),
    });
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.map((n, i) => (
        <div
          key={i}
          role="alert"
          className={cx(
            'flex items-center gap-3 px-4 py-3 text-sm',
            n.tone === 'bad'
              ? 'border border-s-[3px] text-ink'
              : 'border-s-4 border-amber-500 bg-amber-50 text-amber-900',
          )}
          style={n.tone === 'bad' ? DANGER : undefined}
        >
          <n.icon
            className={cx('size-5 shrink-0', n.tone === 'bad' && 'text-[var(--a)]')}
            aria-hidden
          />
          <span className="min-w-0 flex-1">{n.text}</span>
          {n.action}
        </div>
      ))}
    </div>
  );
}

/** What each feature gives an organisation, shown under its name. */
const FEATURE_ABOUT: Record<(typeof FEATURE_KEYS)[number], string> = {
  help_desk: 'A support desk for your own people, with tickets and a website widget',
  payments: 'Take payments on forms and see them in one place',
  authentication: 'Let your own tools sign people in with their account',
  custom_branding: 'Your logo, colours and welcome message across the workspace',
  custom_domain: 'Use your own web address, such as data.yourorg.org',
  sso: 'Sign in with your own identity provider',
  api_access: 'Read and write your data from other systems',
  dhis2: 'Exchange data with DHIS2',
  priority_support: 'Faster replies from the Grids team',
  audit_export: 'Download the full activity log',
  dedicated_db: 'Your data in its own database',
  custom_code: 'Add your own code to data pipelines',
};

/** The plan, and above all when it runs out. */
function SubscriptionTab({ b, onRequest }: { b: OrgBillingDto; onRequest(): void }) {
  const t = useT();
  const f = useFormat();
  const sub = b.subscription;
  if (!sub)
    return (
      <>
        <SectionHead title="Subscription" description="Your plan and when it renews." />
        <Empty icon={Layers} title={t('web.billing.noPlan')}>
          {t('web.billing.noPlanText')}
        </Empty>
      </>
    );
  const trial = sub.status === 'trialing';
  const endsAt = trial ? sub.trialEndsAt : sub.currentPeriodEnd;
  const start = sub.currentPeriodStart ? new Date(sub.currentPeriodStart).getTime() : null;
  const end = endsAt ? new Date(endsAt).getTime() : null;
  const pct =
    start && end && end > start
      ? Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100))
      : 0;
  const label = trial
    ? 'Trial ends'
    : sub.cancelAtPeriodEnd
      ? 'Ends on'
      : b.access.daysLeft === null && sub.amount === 0
        ? 'Free plan'
        : 'Renews on';
  const urgent = b.access.state === 'expiring';
  return (
    <>
      <SectionHead
        title="Subscription"
        description="Your plan and when it renews. Changing plan is done by the Grids team, so that your projects and data stay safe."
        actions={
          <Button size="sm" variant="secondary" icon={MessageSquarePlus} onClick={onRequest}>
            Request a plan change
          </Button>
        }
      />
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-semibold tracking-tight">{sub.planName}</span>
              <Badge tone={sub.status}>{t(`web.billing.status.${sub.status}`)}</Badge>
            </div>
            {b.plan?.description && (
              <p className="mt-1 max-w-md text-sm text-zinc-500">{b.plan.description}</p>
            )}
          </div>
          <div className="text-end">
            <div className="num text-2xl font-semibold tracking-tight">
              {f.money(sub.amount, sub.currency)}
            </div>
            <div className="text-xs text-zinc-500">
              {sub.interval === 'yearly' ? t('web.billing.perYear') : t('web.billing.perMonth')}
              {sub.discountPct > 0 && (
                <span className="text-emerald-700">
                  {' '}
                  · {t('web.billing.discount', { pct: sub.discountPct })}
                </span>
              )}
            </div>
          </div>
        </div>
        {endsAt && (
          <div className="mt-6 border-t border-zinc-200 pt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                  {label}
                </div>
                <div
                  className={cx(
                    'mt-1 text-2xl font-semibold tracking-tight',
                    urgent && 'text-accent-700',
                  )}
                >
                  {f.date(endsAt)}
                </div>
              </div>
              {b.access.daysLeft !== null && (
                <div
                  className={cx(
                    'text-sm',
                    urgent ? 'font-medium text-accent-700' : 'text-zinc-500',
                  )}
                >
                  {b.access.daysLeft} {b.access.daysLeft === 1 ? 'day' : 'days'} left
                </div>
              )}
            </div>
            {sub.currentPeriodStart && (
              <>
                <div
                  className="mt-3 h-2 bg-zinc-100"
                  role="meter"
                  aria-label="Time used in this period"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                >
                  <div className={cx('h-full', 'bg-accent-600')} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-zinc-500">
                  <span>{f.date(sub.currentPeriodStart)}</span>
                  <span>{f.date(endsAt)}</span>
                </div>
              </>
            )}
          </div>
        )}
        {b.upcoming && (
          <div className="mt-6 border-t border-zinc-200 pt-4">
            <div className="mb-2 text-xs font-medium tracking-wide text-zinc-500">
              {t('web.billing.upcoming')} · {f.date(b.upcoming.date)}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {b.upcoming.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1 pe-4 text-zinc-600">{l.description}</td>
                    <td className="num py-1 text-end">
                      {signed(f.money, l.amount, b.upcoming!.currency)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-200 font-semibold">
                  <td className="pt-2">{t('web.billing.total')}</td>
                  <td className="num pt-2 text-end">
                    {f.money(b.upcoming.total, b.upcoming.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <CancelBox b={b} />
    </>
  );
}

/** Every plan side by side, with the organisation's own highlighted. */
function PlanComparison({ tenantId, onRequest }: { tenantId: string; onRequest(): void }) {
  const t = useT();
  const f = useFormat();
  const plans = useQuery({
    queryKey: ['billing-plans', tenantId],
    queryFn: () => api.billingPlans(tenantId),
  });
  const list: OrgPlanDto[] = plans.data ?? [];
  if (plans.isError) return <ErrorNotice error={plans.error} />;
  if (plans.isPending) return <Loading />;
  if (!list.length) return null;
  const col = (p: OrgPlanDto, extra?: string) =>
    cx('px-4 py-3 text-center', p.current && 'bg-accent-50', extra);
  return (
    <>
      <SectionHead
        title="Compare plans"
        description="What each plan includes. Changing plan is done by the Grids team."
        actions={
          <Button size="sm" variant="secondary" icon={MessageSquarePlus} onClick={onRequest}>
            Request a plan change
          </Button>
        }
      />
      <Panel flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="w-1/3 px-5 py-4 text-start font-medium text-zinc-500" scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                {list.map((p) => (
                  <th
                    key={p.id}
                    scope="col"
                    className={cx(
                      'px-4 py-4 text-center align-top font-normal',
                      p.current && 'border-t-2 border-t-accent-600 bg-accent-50',
                    )}
                  >
                    <span className="flex items-center justify-center gap-2 text-base font-semibold">
                      {p.name}
                      {p.current && (
                        <span className="bg-accent-600 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white uppercase">
                          Current
                        </span>
                      )}
                    </span>
                    <span className="num mt-1 block text-lg font-semibold tracking-tight">
                      {f.money(p.priceMonthly * 12, p.currency)}
                      <span className="text-xs font-normal text-zinc-500"> / year</span>
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                      {f.money(p.priceMonthly, p.currency)} monthly
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              <tr className="bg-zinc-50 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                <th className="px-5 py-2 text-start font-medium" scope="rowgroup">
                  Limits
                </th>
                {list.map((p) => (
                  <td key={p.id} className={cx('py-2', p.current && 'bg-accent-50')} />
                ))}
              </tr>
              {LIMIT_KEYS.map((k) => (
                <tr key={k}>
                  <th className="px-5 py-3 text-start font-normal text-zinc-700" scope="row">
                    {t(`web.billing.limitNames.${k}`)}
                  </th>
                  {list.map((p) => {
                    const v = p.limits[k];
                    return (
                      <td key={p.id} className={cx(col(p), 'num', p.current && 'font-medium')}>
                        {v === null || v === undefined ? 'Unlimited' : f.number(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-zinc-50 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                <th className="px-5 py-2 text-start font-medium" scope="rowgroup">
                  Features
                </th>
                {list.map((p) => (
                  <td key={p.id} className={cx('py-2', p.current && 'bg-accent-50')} />
                ))}
              </tr>
              {FEATURE_KEYS.map((k) => (
                <tr key={k}>
                  <th className="px-5 py-3 text-start font-normal" scope="row">
                    <span className="block font-medium">{t(`web.billing.featureNames.${k}`)}</span>
                    <span className="block text-xs text-zinc-500">{FEATURE_ABOUT[k]}</span>
                  </th>
                  {list.map((p) => {
                    const on = p.features.includes(k);
                    return (
                      <td key={p.id} className={col(p)}>
                        {on ? (
                          <Check className="mx-auto size-5 text-accent-600" aria-label="Included" />
                        ) : (
                          <X className="mx-auto size-5 text-zinc-300" aria-label="Not included" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/** Ending the subscription when the current period does, or taking that back. Nothing stops early. */
function CancelBox({ b }: { b: OrgBillingDto }) {
  const f = useFormat();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const sub = b.subscription!;
  const set = useMutation({
    mutationFn: (cancel: boolean) => api.setCancellation(ws.tenant.id, cancel),
    onSuccess: (res, cancel) => {
      qc.setQueryData(['billing', ws.tenant.id], res);
      void qc.invalidateQueries({ queryKey: ['workspace', ws.tenant.id] });
      toast(cancel ? 'Cancellation scheduled' : 'Subscription will continue');
    },
  });
  const end = sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd;
  if (!can('billing.manage') || (sub.amount === 0 && !sub.cancelAtPeriodEnd)) return null;
  const cancelling = sub.cancelAtPeriodEnd;
  const tone = cancelling ? '#a16207' : '#7a1f24';
  return (
    <>
      <ErrorNotice error={set.error} />
      <section
        className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-s-[3px] px-5 py-4"
        style={
          {
            '--a': tone,
            background: 'color-mix(in srgb, var(--a) 7%, var(--color-snow))',
            borderColor: 'color-mix(in srgb, var(--a) 22%, var(--color-zinc-200))',
            borderInlineStartColor: tone,
          } as React.CSSProperties
        }
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {cancelling ? 'Subscription will end' : 'Cancel subscription'}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {cancelling
              ? `It won't renew. Everything keeps working until ${f.date(end)}, then nobody can sign in. You can change your mind until then.`
              : `Stops it renewing. Everything keeps working until ${f.date(end)}, then nobody can sign in until it is renewed.`}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={cancelling ? Undo2 : XCircle}
          loading={set.isPending}
          className="border-[var(--a)]! text-[var(--a)]! hover:bg-[var(--a)]! hover:text-white!"
          onClick={async () => {
            if (
              cancelling ||
              (await confirmDialog(
                `Cancel the subscription? It will end on ${f.date(end)}. After that nobody in your organisation can sign in until it is renewed.`,
                { confirmLabel: 'Cancel subscription', danger: true },
              ))
            )
              set.mutate(!cancelling);
          }}
        >
          {cancelling ? 'Keep my subscription' : 'Cancel subscription'}
        </Button>
      </section>
    </>
  );
}

function invoiceTone(i: InvoiceDto) {
  return i.status === 'open' && i.overdue ? 'overdue' : i.status;
}

/** The columns of the billing history, laid out as the support inbox lays out its rows. */
const COLS =
  'grid grid-cols-[6.5rem_repeat(3,minmax(0,1fr))_6.5rem_7rem_auto] items-center gap-x-3 ps-4 pe-6';

/** Every invoice, and the receipt for each one that was paid, as PDFs. */
function HistoryTab({ b, onRequest }: { b: OrgBillingDto; onRequest(): void }) {
  const t = useT();
  const f = useFormat();
  const ws = useWorkspace();
  const toast = useToast();
  const [pg, setPg] = usePagination([], 10);
  const invoices = useQuery({
    queryKey: ['invoices', ws.tenant.id, pg],
    queryFn: () => api.invoices(ws.tenant.id, pg),
    placeholderData: (prev) => prev,
  });
  const pdf = (i: InvoiceDto, kind: 'invoice' | 'receipt') =>
    api
      .invoicePdf(ws.tenant.id, i.id, kind)
      .then((blob) =>
        saveBlob(blob, `${kind === 'receipt' ? 'Receipt' : 'Invoice'}-${i.number}.pdf`),
      )
      .catch((e: Error) => toast(e.message));
  const icon = 'p-1.5 text-zinc-500 hover:text-ink';
  return (
    <>
      <DetailsTab b={b} onRequest={onRequest} />
      <div className="pt-4" />
      <SectionHead
        title="Billing history"
        description="Every invoice, and a receipt for each one that has been paid."
      />
      <ErrorNotice error={invoices.error} />
      <div className="border border-zinc-200 bg-snow">
        {invoices.isPending ? (
          <Loading />
        ) : (
          <>
            <div
              className={cx(
                COLS,
                'border-b border-zinc-200 bg-zinc-50 py-1.5 text-xs font-medium text-zinc-500',
              )}
            >
              <span>{t('web.billing.number')}</span>
              <span>{t('web.billing.issued')}</span>
              <span>{t('web.billing.due')}</span>
              <span>Paid</span>
              <span>{t('web.billing.state')}</span>
              <span className="text-end">{t('web.billing.total')}</span>
              <span className="w-16" />
            </div>
            {!invoices.data?.items.length && (
              <EmptyState icon={Receipt} title={t('web.billing.noInvoices')}>
                Invoices and receipts appear here once your organisation has been billed.
              </EmptyState>
            )}
            <ul>
              {invoices.data?.items.map((i) => (
                <li key={i.id} className="border-b border-zinc-100 last:border-b-0">
                  <div className={cx(COLS, 'py-2 text-sm hover:bg-zinc-50')}>
                    <Link
                      to={invoiceRoute.to}
                      params={{ tenantId: ws.tenant.id, invoiceId: i.id }}
                      className="font-mono text-xs text-accent-700 tabular-nums hover:underline"
                    >
                      {i.number}
                    </Link>
                    <span className="text-zinc-600">{f.date(i.issuedAt)}</span>
                    <span className="text-zinc-600">{f.date(i.dueAt)}</span>
                    <span className="text-zinc-600">{f.date(i.paidAt)}</span>
                    <span>
                      <Badge tone={invoiceTone(i)}>
                        {invoiceTone(i) === 'overdue'
                          ? t('web.billing.overdueTag')
                          : t(`web.billing.${i.status}`)}
                      </Badge>
                    </span>
                    <span className="num text-end font-medium">{f.money(i.total, i.currency)}</span>
                    <span className="flex w-16 justify-end gap-1">
                      <button
                        type="button"
                        className={icon}
                        title="Download invoice (PDF)"
                        aria-label={`Download invoice ${i.number}`}
                        onClick={() => void pdf(i, 'invoice')}
                      >
                        <FileDown className="size-4" />
                      </button>
                      {i.status === 'paid' && (
                        <button
                          type="button"
                          className={icon}
                          title="Download receipt (PDF)"
                          aria-label={`Download receipt for ${i.number}`}
                          onClick={() => void pdf(i, 'receipt')}
                        >
                          <ReceiptText className="size-4" />
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {invoices.data && <Pagination {...pg} total={invoices.data.total} onChange={setPg} />}
          </>
        )}
      </div>
    </>
  );
}

/** What the plan allows, and how much of it is used. */
/** An icon and a line of explanation for each thing a plan limits. */
const LIMIT_INFO: Record<string, { icon: typeof Gauge; about: string }> = {
  projects: {
    icon: FolderKanban,
    about: 'Workspaces for a programme, with its own data, forms and dashboards',
  },
  users: { icon: Users, about: 'People who can sign in to this organisation' },
  forms: { icon: ClipboardList, about: 'Forms people fill in to collect data' },
  submissions_per_month: { icon: Inbox, about: 'Form responses received this month' },
  storage_gb: { icon: HardDrive, about: 'Files and attachments stored' },
  api_calls_per_month: { icon: Plug, about: 'Requests from other systems this month' },
  rows_ingested_per_month: {
    icon: Database,
    about: 'Rows loaded from connected sources this month',
  },
  run_minutes_per_month: { icon: Timer, about: 'Time used running data pipelines this month' },
};

function UsageTab({ b, onRequest }: { b: OrgBillingDto; onRequest(): void }) {
  const t = useT();
  const f = useFormat();
  return (
    <>
      <SectionHead
        title="Usage and limits"
        description="What your plan allows. When a limit is reached nothing more can be added until the plan is changed."
        actions={
          <Button size="sm" variant="secondary" icon={MessageSquarePlus} onClick={onRequest}>
            Request a plan change
          </Button>
        }
      />
      <Panel>
        <ul className="space-y-5">
          {b.usage.map((u) => {
            const pct = u.used !== null && u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0;
            const reached = u.limit !== null && u.used !== null && u.used >= u.limit;
            const info = LIMIT_INFO[u.key];
            const Icon = info?.icon ?? Gauge;
            return (
              <li key={u.key} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">
                      {t(`web.billing.limitNames.${u.key}`)}
                      {reached && (
                        <span className="ms-2 text-xs font-medium text-accent-600">
                          Limit reached
                        </span>
                      )}
                      {info && (
                        <span className="block text-xs font-normal text-zinc-500">
                          {info.about}
                        </span>
                      )}
                    </span>
                    <span className="num text-xs text-zinc-500">
                      {u.used === null
                        ? t('web.billing.notMetered')
                        : u.limit === null
                          ? `${f.number(u.used)} · ${t('web.billing.unlimited')}`
                          : t('web.billing.usedOf', {
                              used: f.number(u.used),
                              limit: f.number(u.limit),
                            })}
                    </span>
                  </div>
                  {u.limit !== null && u.used !== null && (
                    <div
                      className="mt-1.5 h-1.5 bg-zinc-100"
                      role="meter"
                      aria-label={t(`web.billing.limitNames.${u.key}`)}
                      aria-valuemin={0}
                      aria-valuemax={u.limit}
                      aria-valuenow={u.used}
                    >
                      <div className={cx('h-full', 'bg-accent-600')} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}

/** One line of a details table: what it is, and what it says. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 border-b border-zinc-100 px-5 py-2.5 text-sm last:border-b-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-ink">{children ?? <span className="text-zinc-400">—</span>}</dd>
    </div>
  );
}

/** Who invoices go to, and where. */
function DetailsTab({ b, onRequest }: { b: OrgBillingDto; onRequest(): void }) {
  const a = b.billTo;
  const can = useCan();
  const f = useFormat();
  const sub = b.subscription;
  const place = [a.city, a.region, a.postalCode].filter(Boolean).join(' ');
  const hasAddress = !!(a.line1 || a.line2 || place || a.country);
  return (
    <>
      <SectionHead
        title="Billing details"
        description="Who invoices and receipts are addressed to, set when your organisation was registered."
        actions={
          can('support.create') && (
            <Button size="sm" variant="secondary" icon={MessageSquarePlus} onClick={onRequest}>
              Request a change
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border border-zinc-200 bg-snow">
          <header className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-5 py-2.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            <Building2 className="size-4" aria-hidden /> Billed to
          </header>
          <dl>
            <Detail label="Organisation">
              <span className="font-medium">{a.legalName || a.name}</span>
              {a.legalName && a.legalName !== a.name && (
                <span className="block text-xs text-zinc-500">Trading as {a.name}</span>
              )}
            </Detail>
            <Detail label="Address">
              {hasAddress ? (
                <address className="not-italic">
                  {a.line1 && <span className="block">{a.line1}</span>}
                  {a.line2 && <span className="block">{a.line2}</span>}
                  {place && <span className="block">{place}</span>}
                  {a.country && <span className="block">{countryName(a.country)}</span>}
                </address>
              ) : null}
            </Detail>
            <Detail label="Tax ID">{a.taxId}</Detail>
            <Detail label="Registration no.">{a.registrationNumber}</Detail>
          </dl>
        </section>
        <section className="border border-zinc-200 bg-snow">
          <header className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-5 py-2.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            <Mail className="size-4" aria-hidden /> Billing contact
          </header>
          <dl>
            <Detail label="Name">{b.billingContact?.name}</Detail>
            <Detail label="Email">
              {b.billingContact ? (
                <>
                  <span dir="ltr" className="break-all">
                    {b.billingContact.email}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Invoices, receipts and payment reminders are sent here
                  </span>
                </>
              ) : null}
            </Detail>
            <Detail label="Plan">
              {sub ? (
                <>
                  <span className="font-medium">{sub.planName}</span>
                  <span className="block text-xs text-zinc-500">
                    Billed {sub.interval} · {f.money(sub.amount, sub.currency)} per{' '}
                    {sub.interval === 'yearly' ? 'year' : 'month'}
                  </span>
                </>
              ) : null}
            </Detail>
            <Detail label="Currency">{sub?.currency}</Detail>
            <Detail label="Next invoice">
              {b.upcoming
                ? `${f.date(b.upcoming.date)} · ${f.money(b.upcoming.total, b.upcoming.currency)}`
                : null}
            </Detail>
          </dl>
        </section>
      </div>
    </>
  );
}

/** Plans are changed by the Grids team (a change can touch projects and data): this sends them the request. */
function PlanRequestDialog({
  b,
  kind,
  onClose,
}: {
  b: OrgBillingDto | null;
  kind: 'plan' | 'details';
  onClose(): void;
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const can = useCan();
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.createTicket(ws.tenant.id, {
        subject:
          kind === 'plan'
            ? `Plan change request: ${ws.tenant.name}`
            : `Billing details change request: ${ws.tenant.name}`,
        category: 'account',
        priority: 'normal',
        body: `${body.trim()}\n\nCurrent plan: ${b?.subscription?.planName ?? 'none'}`,
        audience: 'platform',
        page: window.location.pathname,
      }),
    onSuccess: () => {
      toast('Request sent to the Grids team');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === 'plan' ? 'Request a plan change' : 'Request a change to your billing details'}
      footer={
        <>
          <Button variant="secondary" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={Send}
            loading={send.isPending}
            disabled={!body.trim() || !can('support.create')}
            onClick={() => send.mutate()}
          >
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNotice error={send.error} />
        <p className="text-sm text-zinc-600">
          {kind === 'plan'
            ? 'Plans are changed by the Grids team, because moving up or down can affect the projects and data you already have. Tell them what you need and they will reply.'
            : 'The Grids team keeps your billing address and contact. Tell them what should change and they will update it.'}
        </p>
        <Field label={kind === 'plan' ? 'What do you need?' : 'What should change?'}>
          <Textarea
            rows={4}
            value={body}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              kind === 'plan'
                ? 'For example: more projects, or more submissions each month'
                : 'For example: new billing address, or send invoices to accounts@…'
            }
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Printable invoice: the browser's "Save as PDF" produces the document. */
export function InvoicePage() {
  const t = useT();
  const f = useFormat();
  const ws = useWorkspace();
  const can = useCan();
  const toast = useToast();
  const { invoiceId } = invoiceRoute.useParams();
  const invoice = useQuery({
    queryKey: ['invoice', ws.tenant.id, invoiceId],
    queryFn: () => api.invoice(ws.tenant.id, invoiceId),
    enabled: can('billing.view'),
  });
  const billing = useQuery({
    queryKey: ['billing', ws.tenant.id],
    queryFn: () => api.billing(ws.tenant.id),
    enabled: can('billing.view'),
  });
  if (!can('billing.view')) return <NoAccess what={t('web.nav.billing')} />;
  if (invoice.isPending) return <Loading />;
  if (invoice.isError) return <ErrorNotice error={invoice.error} />;
  const i = invoice.data;
  const download = (kind: 'invoice' | 'receipt') =>
    api
      .invoicePdf(ws.tenant.id, i.id, kind)
      .then((blob) =>
        saveBlob(blob, `${kind === 'receipt' ? 'Receipt' : 'Invoice'}-${i.number}.pdf`),
      )
      .catch((e: Error) => toast(e.message));
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link
          to="/o/$tenantId/billing"
          params={{ tenantId: ws.tenant.id }}
          className="inline-flex items-center gap-1.5 text-sm text-accent-700 hover:underline"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t('web.billing.title')}
        </Link>
        <div className="flex gap-2">
          <Button variant="secondary" icon={FileDown} onClick={() => void download('invoice')}>
            Invoice PDF
          </Button>
          {i.status === 'paid' && (
            <Button variant="secondary" icon={ReceiptText} onClick={() => void download('receipt')}>
              Receipt PDF
            </Button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3.5 text-sm hover:border-zinc-600"
          >
            <Printer className="size-4" /> {t('web.billing.print')}
          </button>
        </div>
      </div>
      <article className="border border-zinc-200 bg-snow p-8 sm:p-12 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-200 pb-8">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center bg-ink text-canvas">
                <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
                  <path
                    d="M6 6h8v8H6zM18 6h8v8h-8zM6 18h8v8H6zM18 18h8v8h-8z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="font-semibold tracking-tight">Grids</span>
            </div>
            <p className="mt-3 text-xs text-zinc-500">{t('web.billing.from')}: Grids Platform</p>
          </div>
          <div className="text-end">
            <div className="text-xs tracking-[0.16em] text-zinc-500 uppercase">
              {t('web.billing.invoice')}
            </div>
            <div className="mt-1 font-mono text-xl font-semibold">{i.number}</div>
            <div className="mt-2">
              <Badge tone={invoiceTone(i)}>
                {invoiceTone(i) === 'overdue'
                  ? t('web.billing.overdueTag')
                  : t(`web.billing.${i.status}`)}
              </Badge>
            </div>
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-6 py-8 text-sm sm:grid-cols-4">
          <div className="col-span-2">
            <dt className="text-xs text-zinc-500">{t('web.billing.billTo')}</dt>
            <dd className="mt-1 font-medium">{billing.data?.billTo.legalName || i.tenantName}</dd>
            {billing.data && (
              <dd className="mt-0.5 text-zinc-600">
                {[
                  billing.data.billTo.line1,
                  billing.data.billTo.line2,
                  [
                    billing.data.billTo.city,
                    billing.data.billTo.region,
                    billing.data.billTo.postalCode,
                  ]
                    .filter(Boolean)
                    .join(' '),
                  billing.data.billTo.country,
                  billing.data.billTo.taxId ? `Tax ID: ${billing.data.billTo.taxId}` : null,
                ]
                  .filter(Boolean)
                  .map((l) => (
                    <div key={l}>{l}</div>
                  ))}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t('web.billing.issued')}</dt>
            <dd className="mt-1">{f.date(i.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t('web.billing.due')}</dt>
            <dd className="mt-1">{f.date(i.dueAt)}</dd>
          </div>
          {i.periodStart && (
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500">{t('web.billing.period')}</dt>
              <dd className="mt-1">
                {f.date(i.periodStart)} – {f.date(i.periodEnd)}
              </dd>
            </div>
          )}
        </dl>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-xs text-zinc-500">
              <th className="py-2 text-start font-medium">{t('web.billing.description')}</th>
              <th className="py-2 text-end font-medium">{t('web.billing.qty')}</th>
              <th className="py-2 text-end font-medium">{t('web.billing.unitPrice')}</th>
              <th className="py-2 text-end font-medium">{t('web.billing.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {i.lines.map((l, n) => (
              <tr key={n} className="border-b border-zinc-100">
                <td className="py-3 pe-4">{l.description}</td>
                <td className="num py-3 text-end">{l.quantity}</td>
                <td className="num py-3 text-end">{signed(f.money, l.unitAmount, i.currency)}</td>
                <td className="num py-3 text-end">{signed(f.money, l.amount, i.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 ms-auto w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">{t('web.billing.subtotal')}</span>
            <span className="num">{f.money(i.subtotal, i.currency)}</span>
          </div>
          {i.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">{t('web.billing.discountLine')}</span>
              <span className="num">−{f.money(i.discount, i.currency)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-zinc-300 pt-2 text-base font-semibold">
            <span>{t('web.billing.total')}</span>
            <span className="num">{f.money(i.total, i.currency)}</span>
          </div>
          {i.paidAt && (
            <p className="pt-2 text-end text-xs text-emerald-700">
              {t('web.billing.paidOn', { date: f.date(i.paidAt) })}
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

const signed = (fmt: (m: number, c: string) => string, minor: number, currency: string) =>
  minor < 0 ? `−${fmt(-minor, currency)}` : fmt(minor, currency);

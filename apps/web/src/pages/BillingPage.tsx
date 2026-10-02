import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { InvoiceDto, OrgBillingDto } from '@grids/schema';
import {
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Pagination,
  Panel,
  Stat,
  Table,
  Td,
  cx,
  usePagination,
} from '@grids/ui';
import { ArrowLeft, Check, Printer, Receipt } from 'lucide-react';
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
        ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
            new Date(iso),
          )
        : '—',
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
  };
}

const TONE: Record<string, string> = {
  active: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  trialing: 'border-sky-300 bg-sky-50 text-sky-900',
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

export function BillingPage() {
  const t = useT();
  const can = useCan();
  if (!can('billing.view')) return <NoAccess what={t('web.nav.billing')} />;
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.billing.title')}
        meta={<span>{t('web.billing.intro')}</span>}
      />
      <BillingOverview />
    </>
  );
}

function BillingOverview() {
  const t = useT();
  const f = useFormat();
  const ws = useWorkspace();
  const billing = useQuery({
    queryKey: ['billing', ws.tenant.id],
    queryFn: () => api.billing(ws.tenant.id),
  });
  if (billing.isPending) return <Loading />;
  if (billing.isError) return <ErrorNotice error={billing.error} />;
  const b = billing.data;
  const sub = b.subscription;
  const o = b.outstanding;

  return (
    <div className="space-y-6">
      <div className="stat-strip grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200 lg:grid-cols-3 [&>*]:border-0">
        <Stat
          label={t('web.billing.plan')}
          value={sub ? sub.planName : t('web.billing.noPlan')}
          sub={
            sub ? (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={sub.status}>{t(`web.billing.status.${sub.status}`)}</Badge>
                {t(`web.billing.interval.${sub.interval}`)}
              </span>
            ) : (
              t('web.billing.noPlanText')
            )
          }
        />
        <Stat
          label={t('web.billing.upcoming')}
          value={b.upcoming ? f.money(b.upcoming.total, b.upcoming.currency) : '—'}
          sub={b.upcoming ? f.date(b.upcoming.date) : t('web.billing.noUpcoming')}
        />
        <Stat
          label={t('web.billing.outstanding')}
          value={f.money(o.amount, o.currency)}
          tone={o.overdue ? 'bad' : o.count ? 'warn' : undefined}
          sub={
            o.count
              ? `${t('web.billing.openInvoices', { count: o.count })}${o.overdue ? ` · ${t('web.billing.overdue', { count: o.overdue })}` : ''}`
              : t('web.billing.allPaid')
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {sub && <SubscriptionPanel billing={b} />}
          <InvoicesPanel />
        </div>
        <div className="space-y-6">
          <UsagePanel billing={b} />
          {b.plan && b.plan.features.length > 0 && (
            <Panel title={t('web.billing.features')}>
              <ul className="space-y-2 text-sm">
                {b.plan.features.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-emerald-600" />
                    {t(`web.billing.featureNames.${k}`)}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title={t('web.billing.contact')}>
            {b.billingContact ? (
              <p className="text-sm">
                <span className="font-medium">{b.billingContact.name}</span>
                <br />
                <span className="text-zinc-500" dir="ltr">
                  {b.billingContact.email}
                </span>
              </p>
            ) : (
              <p className="text-sm text-zinc-500">—</p>
            )}
            <p className="mt-4 border-t border-zinc-200 pt-4 text-xs text-zinc-500">
              {t('web.billing.changePlan')}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SubscriptionPanel({ billing }: { billing: OrgBillingDto }) {
  const t = useT();
  const f = useFormat();
  const sub = billing.subscription!;
  const when =
    sub.status === 'trialing' && sub.trialEndsAt
      ? t('web.billing.trialEnds', { date: f.date(sub.trialEndsAt) })
      : sub.cancelAtPeriodEnd && sub.currentPeriodEnd
        ? t('web.billing.ends', { date: f.date(sub.currentPeriodEnd) })
        : sub.currentPeriodEnd
          ? t('web.billing.renews', { date: f.date(sub.currentPeriodEnd) })
          : null;
  return (
    <Panel title={t('web.billing.plan')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xl font-semibold tracking-tight">{sub.planName}</div>
          {billing.plan?.description && (
            <p className="mt-1 max-w-md text-sm text-zinc-500">{billing.plan.description}</p>
          )}
          {when && <p className="mt-2 text-sm">{when}</p>}
        </div>
        <div className="text-end">
          <div className="num text-2xl font-semibold tracking-tight">
            {f.money(sub.amount, sub.currency)}
          </div>
          <div className="text-xs text-zinc-500">
            {sub.interval === 'yearly' ? t('web.billing.perYear') : t('web.billing.perMonth')}
            {sub.discountPct > 0 && (
              <>
                {' · '}
                <span className="text-emerald-700">
                  {t('web.billing.discount', { pct: sub.discountPct })}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      {billing.upcoming && (
        <div className="mt-5 border-t border-zinc-200 pt-4">
          <div className="mb-2 text-xs font-medium tracking-wide text-zinc-500">
            {t('web.billing.upcoming')} · {f.date(billing.upcoming.date)}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {billing.upcoming.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pe-4 text-zinc-600">{l.description}</td>
                  <td className="num py-1 text-end">
                    {signed(f.money, l.amount, billing.upcoming!.currency)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-zinc-200 font-semibold">
                <td className="pt-2">{t('web.billing.total')}</td>
                <td className="num pt-2 text-end">
                  {f.money(billing.upcoming.total, billing.upcoming.currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function UsagePanel({ billing }: { billing: OrgBillingDto }) {
  const t = useT();
  const f = useFormat();
  return (
    <Panel title={t('web.billing.usage')}>
      <ul className="space-y-4">
        {billing.usage.map((u) => {
          const pct = u.used !== null && u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0;
          return (
            <li key={u.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{t(`web.billing.limitNames.${u.key}`)}</span>
                <span className="num text-xs text-zinc-500">
                  {u.used === null
                    ? t('web.billing.notMetered')
                    : u.limit === null
                      ? `${f.number(u.used)} · ${t('web.billing.unlimited')}`
                      : t('web.billing.usedOf', { used: f.number(u.used), limit: f.number(u.limit) })}
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
                  <div
                    className={cx(
                      'h-full',
                      pct >= 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-accent-600',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function invoiceTone(i: InvoiceDto) {
  return i.status === 'open' && i.overdue ? 'overdue' : i.status;
}

function InvoicesPanel() {
  const t = useT();
  const f = useFormat();
  const ws = useWorkspace();
  const [pg, setPg] = usePagination([], 10);
  const invoices = useQuery({
    queryKey: ['invoices', ws.tenant.id, pg],
    queryFn: () => api.invoices(ws.tenant.id, pg),
    placeholderData: (prev) => prev,
  });
  return (
    <Panel flush title={t('web.billing.invoices')}>
      <ErrorNotice error={invoices.error} />
      {invoices.data && invoices.data.total === 0 ? (
        <Empty icon={Receipt} title={t('web.billing.noInvoices')} />
      ) : (
        <>
          <Table
            head={[
              t('web.billing.number'),
              t('web.billing.issued'),
              t('web.billing.due'),
              t('web.billing.state'),
              <span key="t" className="block text-end">
                {t('web.billing.total')}
              </span>,
            ]}
          >
            {invoices.data?.items.map((i) => (
              <tr key={i.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                <Td>
                  <Link
                    to={invoiceRoute.to}
                    params={{ tenantId: ws.tenant.id, invoiceId: i.id }}
                    className="font-mono text-accent-700 hover:underline"
                  >
                    {i.number}
                  </Link>
                </Td>
                <Td>{f.date(i.issuedAt)}</Td>
                <Td>{f.date(i.dueAt)}</Td>
                <Td>
                  <Badge tone={invoiceTone(i)}>
                    {invoiceTone(i) === 'overdue'
                      ? t('web.billing.overdueTag')
                      : t(`web.billing.${i.status}`)}
                  </Badge>
                </Td>
                <Td className="num text-end">{f.money(i.total, i.currency)}</Td>
              </tr>
            ))}
          </Table>
          {invoices.data && <Pagination {...pg} total={invoices.data.total} onChange={setPg} />}
        </>
      )}
    </Panel>
  );
}

/** Printable invoice: the browser's "Save as PDF" produces the document. */
export function InvoicePage() {
  const t = useT();
  const f = useFormat();
  const ws = useWorkspace();
  const can = useCan();
  const { invoiceId } = invoiceRoute.useParams();
  const invoice = useQuery({
    queryKey: ['invoice', ws.tenant.id, invoiceId],
    queryFn: () => api.invoice(ws.tenant.id, invoiceId),
    enabled: can('billing.view'),
  });
  if (!can('billing.view')) return <NoAccess what={t('web.nav.billing')} />;
  if (invoice.isPending) return <Loading />;
  if (invoice.isError) return <ErrorNotice error={invoice.error} />;
  const i = invoice.data;
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
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3.5 text-sm hover:border-zinc-600"
        >
          <Printer className="size-4" /> {t('web.billing.print')}
        </button>
      </div>
      <article className="border border-zinc-200 bg-snow p-8 sm:p-12 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-200 pb-8">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center bg-ink text-canvas">
                <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
                  <path d="M6 6h8v8H6zM18 6h8v8h-8zM6 18h8v8H6zM18 18h8v8h-8z" fill="currentColor" />
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
            <dd className="mt-1 font-medium">{i.tenantName}</dd>
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

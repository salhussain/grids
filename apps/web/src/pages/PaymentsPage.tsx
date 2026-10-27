import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PAY_METHODS,
  PAY_METHOD_INFO,
  PAYMENT_SERVICE,
  type MerchantDto,
  type MethodDto,
  type PayMethod,
  type PaymentDto,
} from '@grids/schema';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Listbox,
  Loading,
  PageHeader,
  SectionHead,
  Switch,
  VerticalTabs,
  confirmDialog,
  cx,
  useToast,
} from '@grids/ui';
import {
  CreditCard,
  ListChecks,
  Pencil,
  Plus,
  Save,
  Store,
  Trash2,
  X,
  Zap,
  ZapOff,
  Download,
  Search,
  CalendarDays,
  CircleDot,
  FileText,
  Wallet,
  CalendarClock,
  Landmark,
  Smartphone,
} from 'lucide-react';
import { saveBlob } from './projects/DocumentsPanel';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { ImageField } from './projects/fields';
import { PAY_PRESETS } from './paymentBrands';
import { FilterMenu, type FilterCategory, type FilterValue } from './support/FilterMenu';

type Tab = 'merchants' | 'methods' | 'payments';

const STATUS: Record<PaymentDto['status'], string> = {
  succeeded: 'border-accent-300 bg-accent-50 text-accent-800',
  pending: 'border-amber-300 bg-amber-50 text-amber-800',
  failed: 'border-red-300 bg-red-50 text-red-800',
  cancelled: 'border-zinc-300 bg-zinc-50 text-zinc-600',
};

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
const day = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : '—';
const NO_FILTER = { q: '', filters: {} as FilterValue };

/** One icon for each way of paying (the brand names, such as M-PAiSA or Afterpay, are only mentioned in the help text). */
export const METHOD_ICON: Record<PayMethod, typeof CreditCard> = {
  card: CreditCard,
  wallet: Smartphone,
  bank: Landmark,
  instalments: CalendarClock,
};

/** A way of paying's mark: its logo, or the icon for its kind. */
function MethodMark({
  m,
  className = 'size-5',
}: {
  m: Pick<MethodDto, 'kind' | 'logo' | 'name'>;
  className?: string;
}) {
  if (m.logo) return <img src={m.logo} alt="" className={cx(className, 'object-contain')} />;
  const Icon = METHOD_ICON[m.kind];
  return <Icon className={className} aria-hidden />;
}

const iso10 = (d: Date) => d.toISOString().slice(0, 10);
/** The date range a period filter stands for (days counted back from today, or whole calendar months). */
const PERIODS: { value: string; label: string; range(): { from: string; to: string } }[] = [
  {
    value: 'today',
    label: 'Today',
    range: () => ({ from: iso10(new Date()), to: iso10(new Date()) }),
  },
  {
    value: '7d',
    label: 'Last 7 days',
    range: () => ({ from: iso10(new Date(Date.now() - 6 * 86_400_000)), to: iso10(new Date()) }),
  },
  {
    value: '30d',
    label: 'Last 30 days',
    range: () => ({ from: iso10(new Date(Date.now() - 29 * 86_400_000)), to: iso10(new Date()) }),
  },
  {
    value: 'month',
    label: 'This month',
    range: () => {
      const n = new Date();
      return {
        from: iso10(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))),
        to: iso10(n),
      };
    },
  },
  {
    value: 'lastmonth',
    label: 'Last month',
    range: () => {
      const n = new Date();
      return {
        from: iso10(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))),
        to: iso10(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0))),
      };
    },
  },
  {
    value: '90d',
    label: 'Last 90 days',
    range: () => ({ from: iso10(new Date(Date.now() - 89 * 86_400_000)), to: iso10(new Date()) }),
  },
];
const COLS =
  'grid grid-cols-[1.25rem_10.5rem_minmax(0,1.6fr)_minmax(0,1fr)_6.5rem_5rem_6.5rem_7rem] items-center gap-x-3 ps-4 pe-6';

const MCOLS =
  'grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_6rem_6rem_5rem] items-center gap-x-3 ps-4 pe-6';

/** Payments the organisation takes from its own users through forms: the merchants added to GridPay, and what has been paid. */
export function PaymentsPage() {
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const [tab, setTab] = useState<Tab>('merchants');
  const [editing, setEditing] = useState<MerchantDto | 'new' | null>(null);
  const data = useQuery({
    queryKey: ['payments', id],
    queryFn: () => api.payments(id),
    enabled: can('payments.manage'),
  });
  const remove = useMutation({
    mutationFn: (m: MerchantDto) => api.removeMerchant(id, m.id),
    onSuccess: (res) => {
      qc.setQueryData(['payments', id], res);
      toast('Merchant removed');
    },
  });
  const [f, setF] = useState(NO_FILTER);
  const [exporting, setExporting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [receipting, setReceipting] = useState(false);
  const [editingMethod, setEditingMethod] = useState<MethodDto | 'new' | null>(null);
  const removeMethod = useMutation({
    mutationFn: (k: MethodDto) => api.removeMethod(id, k.key),
    onSuccess: (res) => {
      qc.setQueryData(['payments', id], res);
      toast('Way to pay removed');
    },
  });
  const setMethods = useMutation({
    mutationFn: ({ m, methods }: { m: MerchantDto; methods: string[] }) =>
      api.changeMerchant(id, m.id, {
        name: m.name,
        merchantRef: m.merchantRef,
        mode: m.mode,
        enabled: m.enabled,
        methods,
      }),
    onSuccess: (res) => {
      qc.setQueryData(['payments', id], res);
      toast('Ways to pay saved');
    },
  });
  if (!can('payments.manage')) return <NoAccess what="payments" />;
  // An API that has not been restarted since the update sends the older shape: treat what is missing as empty.
  const d = data.data && {
    ...data.data,
    merchants: data.data.merchants ?? [],
    methods: data.data.methods ?? [],
    items: data.data.items ?? [],
  };
  const fee = d?.fee;
  const forms = [...new Set((d?.items ?? []).map((p) => `${p.project}/${p.form}`))].sort();
  const categories: FilterCategory[] = [
    {
      id: 'status',
      label: 'Status',
      icon: CircleDot,
      options: [
        { value: 'succeeded', label: 'Succeeded' },
        { value: 'pending', label: 'Pending' },
        { value: 'failed', label: 'Failed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    {
      id: 'form',
      label: 'Form',
      icon: FileText,
      options: forms.map((k) => ({ value: k, label: k })),
    },
    {
      id: 'method',
      label: 'Way to pay',
      icon: Wallet,
      options: (d?.methods ?? []).map((k) => ({ value: k.key, label: k.name })),
    },
    {
      id: 'period',
      label: 'Period',
      icon: CalendarDays,
      options: PERIODS.map((p) => ({ value: p.value, label: p.label })),
    },
  ];
  // A period is one range: picking another replaces it.
  const setFilters = (next: FilterValue) => {
    const was = f.filters.period ?? [];
    const now = next.period ?? [];
    setF({
      ...f,
      filters: { ...next, period: now.length > 1 ? now.filter((x) => !was.includes(x)) : now },
    });
  };
  const range = PERIODS.find((p) => p.value === f.filters.period?.[0])?.range();
  const pick = (k: string) => f.filters[k] ?? [];
  const filtered = !!f.q || Object.values(f.filters).some((v) => v.length);
  const shown = (d?.items ?? []).filter((p) => {
    const when = (p.paidAt ?? p.createdAt).slice(0, 10);
    const q = f.q.trim().toLowerCase();
    return (
      (!pick('status').length || pick('status').includes(p.status)) &&
      (!pick('form').length || pick('form').includes(`${p.project}/${p.form}`)) &&
      (!pick('method').length || (p.method !== null && pick('method').includes(p.method))) &&
      (!range || (when >= range.from && when <= range.to)) &&
      (!q || [p.description, p.payerEmail ?? '', p.form].some((x) => x.toLowerCase().includes(q)))
    );
  });
  const totals = Object.entries(
    shown
      .filter((p) => p.status === 'succeeded')
      .reduce<Record<string, number>>(
        (n, p) => ({ ...n, [p.currency]: (n[p.currency] ?? 0) + p.amount }),
        {},
      ),
  ).map(([c, v]) => money(v, c));
  const download = async () => {
    setExporting(true);
    try {
      const list = (k: string) => (f.filters[k] ?? []).join(',');
      const blob = await api.exportPayments(id, {
        ...(f.q && { q: f.q }),
        ...(list('status') && { status: list('status') }),
        ...(list('form') && { form: list('form') }),
        ...(list('method') && { method: list('method') }),
        ...(range && { from: range.from, to: range.to }),
      });
      saveBlob(blob, `payments-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The file could not be made');
    } finally {
      setExporting(false);
    }
  };
  // Only payments that went through have a receipt.
  const eligible = shown.filter((p) => p.status === 'succeeded');
  const allPicked = eligible.length > 0 && eligible.every((p) => picked.has(p.id));
  const toggle = (pid: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  const receipt = async (p: PaymentDto) => {
    try {
      saveBlob(await api.paymentReceipt(id, p.id), `receipt-${p.receiptNo ?? p.id}.pdf`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The receipt could not be made');
    }
  };
  const receipts = async () => {
    setReceipting(true);
    try {
      const r = await api.paymentReceipts(id, [...picked]);
      saveBlob(r.blob, `receipts-${new Date().toISOString().slice(0, 10)}.zip`);
      toast(`${r.count} ${r.count === 1 ? 'receipt' : 'receipts'} downloaded${r.skipped ? `; ${r.skipped} skipped (not paid)` : ''}`);
      setPicked(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The receipts could not be made');
    } finally {
      setReceipting(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Payments"
        meta={
          <span>
            Take payments on your forms with {PAYMENT_SERVICE}, and see what has been paid.
          </span>
        }
      />
      <ErrorNotice error={data.error ?? remove.error} />
      {data.isPending ? (
        <Loading />
      ) : (
        <VerticalTabs<Tab>
          label="Payments"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'merchants', label: 'Merchants', icon: Store, count: d?.merchants.length },
            { id: 'methods', label: 'Payment methods', icon: Wallet },
            { id: 'payments', label: 'Payments', icon: ListChecks, count: d?.items.length },
          ]}
        >
          {tab === 'merchants' && (
            <>
              <SectionHead
                title="Merchants"
                description={`The accounts payments are paid out to. The money goes from the person paying straight to the merchant; Grids never holds it.`}
                actions={
                  <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
                    Add merchant
                  </Button>
                }
              />
              <div className="border border-zinc-200 bg-snow">
                <div
                  className={cx(
                    MCOLS,
                    'border-b border-zinc-200 bg-zinc-50 py-1.5 text-xs font-medium text-zinc-500',
                  )}
                >
                  <span>Name</span>
                  <span>Merchant ID</span>
                  <span>Ways to pay</span>
                  <span>Mode</span>
                  <span>Status</span>
                  <span className="w-12" />
                </div>
                {!d?.merchants.length && (
                  <EmptyState icon={Store} title="No merchants yet">
                    Add a merchant to start taking payments on your forms.
                  </EmptyState>
                )}
                <ul>
                  {d?.merchants.map((m) => (
                    <li key={m.id} className="border-b border-zinc-100 last:border-b-0">
                      <div className={cx(MCOLS, 'py-2.5 text-sm hover:bg-zinc-50')}>
                        <span className="flex min-w-0 items-center gap-2 font-medium">
                          {m.logo ? (
                            <img src={m.logo} alt="" className="size-6 shrink-0 object-contain" />
                          ) : (
                            <Store className="size-5 shrink-0 text-zinc-400" aria-hidden />
                          )}
                          <span className="truncate">{m.name}</span>
                        </span>
                        <span className="truncate font-mono text-xs text-zinc-600">
                          {m.merchantRef || '—'}
                        </span>
                        <span className="flex items-center gap-1.5 text-zinc-600">
                          {m.methods.map((k) => {
                            const way = d?.methods.find((x) => x.key === k);
                            return way ? (
                              <span key={k} title={way.name}>
                                <MethodMark m={way} className="size-4" />
                              </span>
                            ) : null;
                          })}
                        </span>
                        <span>
                          <span
                            className={cx(
                              'inline-flex border px-1.5 py-0.5 text-xs font-medium',
                              m.mode === 'live' ? STATUS.succeeded : STATUS.pending,
                            )}
                          >
                            {m.mode === 'live' ? 'Live' : 'Test'}
                          </span>
                        </span>
                        <span>
                          <span
                            title={m.enabled ? 'On' : 'Off'}
                            aria-label={m.enabled ? 'On' : 'Off'}
                            role="img"
                          >
                            {m.enabled ? (
                              <Zap className="size-5 text-accent-600" />
                            ) : (
                              <ZapOff className="size-5 text-zinc-400" />
                            )}
                          </span>
                        </span>
                        <span className="flex w-12 justify-end gap-0.5">
                          <button
                            type="button"
                            aria-label={`Edit ${m.name}`}
                            title="Edit"
                            className="p-1.5 text-zinc-500 hover:text-ink"
                            onClick={() => setEditing(m)}
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${m.name}`}
                            title="Remove"
                            className="p-1.5 text-zinc-500 hover:text-[#7a1f24]"
                            onClick={async () =>
                              (await confirmDialog(
                                `Remove ${m.name}? Forms that use it stop taking payments.`,
                                { confirmLabel: 'Remove', danger: true },
                              )) && remove.mutate(m)
                            }
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-6 text-xs text-zinc-500">
                {fee && (fee.percent > 0 || fee.fixed > 0)
                  ? `Your plan charges ${[fee.percent > 0 ? `${fee.percent}%` : null, fee.fixed > 0 ? money(fee.fixed, d?.unbilled[0]?.currency ?? 'USD') : null].filter(Boolean).join(' + ')} on each payment taken through your forms, billed on its own invoice each month, one for each currency.`
                  : 'Your plan has no fee on payments taken through your forms.'}
                {d &&
                  d.unbilled.length > 0 &&
                  ` Not yet invoiced: ${d.unbilled.map((u) => `${money(u.amount, u.currency)} on ${u.count} ${u.count === 1 ? 'payment' : 'payments'}`).join(', ')}.`}
              </p>
            </>
          )}
          {tab === 'methods' && (
            <>
              <SectionHead
                title="Payment methods"
                description="The ways people can pay. Add the ones you want to offer, then switch them on for the merchants that should take them; a merchant with one way goes straight to it, with several the person picks."
                actions={
                  <Button size="sm" icon={Plus} onClick={() => setEditingMethod('new')}>
                    Add payment method
                  </Button>
                }
              />
              <SuggestedMethods existing={d?.methods.map((m) => m.name.toLowerCase()) ?? []} />
              <div className="overflow-x-auto border border-zinc-200 bg-snow">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                      <th className="py-1.5 ps-4 text-start font-medium">Way to pay</th>
                      {d?.merchants.map((m) => (
                        <th key={m.id} className="px-3 py-1.5 text-center font-medium">
                          <span className="flex items-center justify-center gap-1.5">
                            {m.logo && (
                              <img src={m.logo} alt="" className="size-4 object-contain" />
                            )}
                            {m.name}
                          </span>
                        </th>
                      ))}
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {d?.methods.map((k) => (
                      <tr key={k.key} className="border-b border-zinc-100 last:border-b-0">
                        <td className="py-3 ps-4 pe-3">
                          <span className="flex items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
                              <MethodMark m={k} />
                            </span>
                            <span>
                              <span className="block font-medium">{k.name}</span>
                              <span className="block text-xs text-zinc-500">
                                {k.about}
                                {(k.surchargePercent > 0 || k.surchargeFixed > 0) &&
                                  ` · Surcharge ${[k.surchargePercent > 0 ? `${k.surchargePercent}%` : null, k.surchargeFixed > 0 ? (k.surchargeFixed / 100).toFixed(2) : null].filter(Boolean).join(' + ')}`}
                              </span>
                            </span>
                          </span>
                        </td>
                        {d.merchants.map((m) => (
                          <td key={m.id} className="px-3 py-3 text-center">
                            <span className="inline-flex">
                              <Switch
                                label={`${k.name} for ${m.name}`}
                                checked={m.methods.includes(k.key)}
                                disabled={
                                  setMethods.isPending ||
                                  (m.methods.includes(k.key) && m.methods.length === 1)
                                }
                                onChange={(on) =>
                                  setMethods.mutate({
                                    m,
                                    methods: on
                                      ? [...m.methods, k.key]
                                      : m.methods.filter((x) => x !== k.key),
                                  })
                                }
                              />
                            </span>
                          </td>
                        ))}
                        <td className="pe-3">
                          <span className="flex justify-end gap-0.5">
                            <button
                              type="button"
                              aria-label={`Edit ${k.name}`}
                              title="Edit"
                              className="p-1.5 text-zinc-500 hover:text-ink"
                              onClick={() => setEditingMethod(k)}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${k.name}`}
                              title="Remove"
                              className="p-1.5 text-zinc-500 hover:text-[#7a1f24] disabled:opacity-40"
                              disabled={d.methods.length === 1}
                              onClick={async () =>
                                (await confirmDialog(
                                  `Remove ${k.name}? Merchants stop offering it.`,
                                  { confirmLabel: 'Remove', danger: true },
                                )) && removeMethod.mutate(k)
                              }
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!d?.merchants.length && (
                  <EmptyState icon={Store} title="No merchants yet">
                    Add a merchant first, then choose its ways to pay here.
                  </EmptyState>
                )}
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                A merchant always keeps at least one way to pay. Which brands take real money
                depends on the payment processor that is connected; until then every way is a test.
              </p>
            </>
          )}
          {tab === 'payments' && (
            <>
              <SectionHead
                title="Payments"
                description="What people have paid through your forms."
                actions={
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Download}
                    loading={exporting}
                    onClick={() => void download()}
                  >
                    Download CSV
                  </Button>
                }
              />
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input
                  icon={Search}
                  className="w-56"
                  aria-label="Search payments"
                  placeholder="Search form or payer"
                  value={f.q}
                  onChange={(e) => setF({ ...f, q: e.target.value })}
                />
                <FilterMenu categories={categories} value={f.filters} onChange={setFilters} />
                {filtered && (
                  <button
                    type="button"
                    onClick={() => setF(NO_FILTER)}
                    className="inline-flex h-9 items-center gap-1 text-xs text-zinc-500 hover:text-ink"
                  >
                    <X className="size-3.5" /> Clear
                  </button>
                )}
                <span className="ms-auto text-xs text-zinc-500">
                  {shown.length} {shown.length === 1 ? 'payment' : 'payments'}
                  {shown.length > 0 && totals.length > 0 && ` · ${totals.join(' · ')} paid`}
                </span>
              </div>
              {picked.size > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-3 border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm">
                  <span>
                    {picked.size} selected
                  </span>
                  <Button size="sm" icon={Download} loading={receipting} onClick={() => void receipts()}>
                    Download receipts (ZIP)
                  </Button>
                  <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-zinc-500 hover:text-ink">
                    Clear selection
                  </button>
                </div>
              )}
              <div className="border border-zinc-200 bg-snow">
                <div
                  className={cx(
                    COLS,
                    'border-b border-zinc-200 bg-zinc-50 py-1.5 text-xs font-medium text-zinc-500',
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label="Select all paid payments"
                    disabled={!eligible.length}
                    checked={allPicked}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(eligible.map((p) => p.id)))}
                    className="size-4 accent-accent-600"
                  />
                  <span>Date</span>
                  <span>Form</span>
                  <span>Payer</span>
                  <span>Status</span>
                  <span className="text-end">Fee</span>
                  <span className="text-end">Amount</span>
                  <span className="text-end">Receipt</span>
                </div>
                {!shown.length && (
                  <EmptyState
                    icon={CreditCard}
                    title={filtered ? 'Nothing matches' : 'No payments yet'}
                  >
                    {filtered
                      ? 'Try different filters.'
                      : 'Payments appear here once someone pays for a form.'}
                  </EmptyState>
                )}
                <ul>
                  {shown.map((p) => (
                    <li key={p.id} className="border-b border-zinc-100 last:border-b-0">
                      <div className={cx(COLS, 'py-2.5 text-sm hover:bg-zinc-50')}>
                        <input
                          type="checkbox"
                          aria-label={`Select payment ${p.receiptNo ?? p.id}`}
                          disabled={p.status !== 'succeeded'}
                          checked={picked.has(p.id)}
                          onChange={() => toggle(p.id)}
                          className="size-4 accent-accent-600 disabled:opacity-30"
                        />
                        <span className="text-xs whitespace-nowrap text-zinc-600">
                          {day(p.paidAt ?? p.createdAt)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {p.description || p.form}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-zinc-500">
                            {p.project}/{p.form}
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-zinc-600">
                            {p.payerEmail ?? '—'}
                          </span>
                          {p.method && (
                            <span className="block text-[11px] text-zinc-400">
                              {d?.methods.find((x) => x.key === p.method)?.name ?? p.method}
                            </span>
                          )}
                        </span>
                        <span>
                          <span
                            className={cx(
                              'inline-flex border px-1.5 py-0.5 text-xs font-medium capitalize',
                              STATUS[p.status],
                            )}
                          >
                            {p.status}
                          </span>
                        </span>
                        <span className="num text-end text-xs text-zinc-500">
                          {p.fee > 0 ? money(p.fee, p.currency) : '—'}
                        </span>
                        <span className="num text-end font-medium">
                          {money(p.amount, p.currency)}
                        </span>
                        <span className="flex items-center justify-end gap-1">
                          {p.status === 'succeeded' ? (
                            <>
                              <span className="num text-[11px] text-zinc-500">{p.receiptNo}</span>
                              <button
                                type="button"
                                aria-label={`Download receipt ${p.receiptNo ?? ''}`}
                                title="Download receipt (PDF)"
                                className="p-1.5 text-zinc-500 hover:text-ink"
                                onClick={() => void receipt(p)}
                              >
                                <Download className="size-4" />
                              </button>
                            </>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </VerticalTabs>
      )}
      {editing && (
        <MerchantDialog
          merchant={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {editingMethod && (
        <MethodDialog
          method={editingMethod === 'new' ? null : editingMethod}
          onClose={() => setEditingMethod(null)}
        />
      )}
    </>
  );
}

/** One-click chips for well-known ways to pay that are not in the list yet. */
function SuggestedMethods({ existing }: { existing: string[] }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const add = useMutation({
    mutationFn: (p: (typeof PAY_PRESETS)[number]) =>
      api.addMethod(id, {
        name: p.name,
        kind: p.kind,
        logo: p.logo,
        surchargePercent: 0,
        surchargeFixed: 0,
        instalments: p.instalments ?? 4,
      }),
    onSuccess: (res, p) => {
      qc.setQueryData(['payments', id], res);
      toast(`${p.name} added`);
    },
  });
  const missing = PAY_PRESETS.filter((p) => !existing.includes(p.name.toLowerCase()));
  if (!missing.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-500">Add with one click</span>
      {missing.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={add.isPending}
          onClick={() => add.mutate(p)}
          className="flex items-center gap-2 border border-zinc-200 bg-snow px-2.5 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60"
        >
          <img src={p.logo} alt="" className="size-5 object-contain" />
          {p.name}
          <Plus className="size-3.5 text-zinc-400" />
        </button>
      ))}
      <ErrorNotice error={add.error} />
    </div>
  );
}

/** Adds a way of paying to the organisation's list, or changes one. */
function MethodDialog({ method, onClose }: { method: MethodDto | null; onClose(): void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const [name, setName] = useState(method?.name ?? '');
  const [kind, setKind] = useState<PayMethod>(method?.kind ?? 'wallet');
  const [logo, setLogo] = useState<string | null>(method?.logo ?? null);
  const [percent, setPercent] = useState(method ? String(method.surchargePercent) : '');
  const [fixed, setFixed] = useState(
    method && method.surchargeFixed ? (method.surchargeFixed / 100).toFixed(2) : '',
  );
  const [n, setN] = useState(String(method?.instalments ?? 4));
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name,
        kind,
        logo,
        surchargePercent: Number(percent) || 0,
        surchargeFixed: Math.round((Number(fixed) || 0) * 100),
        instalments: Math.min(12, Math.max(2, Math.round(Number(n)) || 4)),
      };
      return method ? api.changeMethod(id, method.key, input) : api.addMethod(id, input);
    },
    onSuccess: (res) => {
      qc.setQueryData(['payments', id], res);
      toast(method ? 'Way to pay saved' : 'Way to pay added');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={method ? 'Edit payment method' : 'Add payment method'}
      footer={
        <>
          <Button variant="secondary" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={Save}
            loading={save.isPending}
            disabled={name.trim().length < 2}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        {!method && (
          <Field label="Quick add" intro="Fill in a well-known way to pay">
            <div className="flex flex-wrap gap-2">
              {PAY_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setName(p.name);
                    setKind(p.kind);
                    setLogo(p.logo);
                    if (p.instalments) setN(String(p.instalments));
                  }}
                  className={cx(
                    'flex items-center gap-2 border px-2.5 py-1.5 text-sm hover:bg-zinc-50',
                    name === p.name ? 'border-accent-600 bg-accent-50' : 'border-zinc-200',
                  )}
                >
                  <img src={p.logo} alt="" className="size-5 object-contain" />
                  {p.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Name" intro="What people see, e.g. M-PAiSA or Afterpay">
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="How it works" intro="The screen people use to pay">
          <Listbox
            label="How it works"
            value={kind}
            onChange={(v) => setKind(v as PayMethod)}
            options={PAY_METHODS.map((k) => ({
              value: k,
              label: `${PAY_METHOD_INFO[k].name}: ${PAY_METHOD_INFO[k].about}`,
              icon: METHOD_ICON[k],
            }))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Surcharge (%)" intro="Added to the amount when people pay this way">
            <Input
              type="number"
              min={0}
              max={20}
              step="0.1"
              placeholder="0"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
          <Field label="Surcharge (fixed)" intro="Added on top, in the form's currency">
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={fixed}
              onChange={(e) => setFixed(e.target.value)}
            />
          </Field>
        </div>
        {kind === 'instalments' && (
          <Field label="Number of instalments" intro="2 to 12, two weeks apart">
            <Input
              type="number"
              min={2}
              max={12}
              value={n}
              onChange={(e) => setN(e.target.value)}
            />
          </Field>
        )}
        <ImageField
          label="Logo"
          intro="Shown beside the name; the icon for how it works is used without one"
          aspect="wide"
          value={logo}
          maxSize={128}
          onChange={(v) => setLogo(v)}
        />
      </div>
    </Dialog>
  );
}

/** Adds a merchant to GridPay, or changes one. */
function MerchantDialog({ merchant, onClose }: { merchant: MerchantDto | null; onClose(): void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const [name, setName] = useState(merchant?.name ?? '');
  const [ref, setRef] = useState(merchant?.merchantRef ?? '');
  const [key, setKey] = useState('');
  const [mode, setMode] = useState<'test' | 'live'>(merchant?.mode ?? 'test');
  const [enabled, setEnabled] = useState(merchant?.enabled ?? true);
  const [logo, setLogo] = useState<string | null>(merchant?.logo ?? null);
  const save = useMutation({
    mutationFn: () => {
      const input = { name, merchantRef: ref, apiKey: key, mode, enabled, logo };
      return merchant ? api.changeMerchant(id, merchant.id, input) : api.addMerchant(id, input);
    },
    onSuccess: (res) => {
      qc.setQueryData(['payments', id], res);
      toast(merchant ? 'Merchant saved' : 'Merchant added');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={merchant ? 'Edit merchant' : 'Add merchant'}
      footer={
        <>
          <Button variant="secondary" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={Save}
            loading={save.isPending}
            disabled={name.trim().length < 2}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <Field label="Name" intro="How you recognise it, e.g. Licensing office">
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ImageField
          label="Logo"
          intro="Shown on the payment page"
          aspect="wide"
          value={logo}
          maxSize={256}
          onChange={(v) => setLogo(v)}
        />
        <Field label="Mode" intro="Test takes pretend payments; no real money moves">
          <Listbox
            label="Mode"
            value={mode}
            onChange={(v) => setMode(v as 'test' | 'live')}
            options={[
              { value: 'test', label: 'Test' },
              { value: 'live', label: 'Live' },
            ]}
          />
        </Field>
        <Field
          label="Merchant ID"
          intro={mode === 'live' ? 'From your merchant account' : 'Needed for live payments'}
        >
          <Input value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field
          label="API key"
          intro={mode === 'live' ? 'Kept encrypted, never shown again' : 'Needed for live payments'}
        >
          <Input
            type="password"
            autoComplete="off"
            placeholder={merchant?.hasKey ? '•••••• (saved)' : ''}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            <span className="block font-medium">Take payments</span>
            <span className="block text-xs text-zinc-500">
              Forms can only ask for a fee while a merchant is on
            </span>
          </span>
          <Switch label="Take payments" checked={enabled} onChange={setEnabled} />
        </label>
      </div>
    </Dialog>
  );
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, FilePlus2 } from 'lucide-react';
import { useState } from 'react';
import type { InvoiceDto, TenantDetail } from '@grids/schema';
import { api } from '../../api';
import {
  Button,
  Empty,
  ErrorNotice,
  KeyValues,
  Mono,
  Panel,
  Select,
  Status,
  Switch,
  Table,
  Td,
  useToast,
} from '@grids/ui';
import { Pagination, usePagination } from '@grids/ui';
import { useCan } from '../../session';
import { date, humanize, money } from '@grids/ui';
import { InvoiceDialog } from '../dialogs';

export function BillingTab({ t, onSubscribe }: { t: TenantDetail; onSubscribe: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<InvoiceDto | null>(null);
  const [page, setPage] = usePagination([], 10);
  const invoiceQuery = { tenantId: t.id, ...page };
  const invoices = useQuery({
    queryKey: ['invoices', invoiceQuery],
    queryFn: () => api.invoices(invoiceQuery),
    placeholderData: keepPreviousData,
  });
  const can = useCan();
  const plans = useQuery({
    queryKey: ['plan-options'],
    queryFn: api.planOptions,
    enabled: can('billing.subscriptions'),
  });
  const s = t.subscription;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['tenant', t.id] }),
      qc.invalidateQueries({ queryKey: ['invoices'] }),
    ]);
  };
  const change = useMutation({
    mutationFn: (input: Parameters<typeof api.changeSubscription>[1]) =>
      api.changeSubscription(t.id, input),
    onSuccess: async () => {
      await refresh();
      toast('Subscription updated; applies from the next invoice');
    },
  });
  const renew = useMutation({
    mutationFn: () => api.issueRenewal(t.id),
    onSuccess: async (inv) => {
      await refresh();
      toast(`${inv.number} issued`);
    },
  });

  return (
    <div className="space-y-6">
      {!s ? (
        <Panel>
          <Empty
            icon={CreditCard}
            title="No subscription"
            action={
              t.status !== 'cancelled' &&
              can('billing.subscriptions') && (
                <Button onClick={onSubscribe}>Set up subscription</Button>
              )
            }
          >
            This organisation isn’t on a plan yet.
          </Empty>
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel
            className="xl:col-span-2"
            title={
              <span className="flex items-center gap-3">
                Subscription <Status value={s.status} />
              </span>
            }
            actions={
              can('billing.invoices') && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={FilePlus2}
                  loading={renew.isPending}
                  onClick={() => renew.mutate()}
                  disabled={s.status === 'pending_payment'}
                >
                  Issue next invoice
                </Button>
              )
            }
          >
            <div className="mb-5 flex flex-wrap items-baseline gap-x-3">
              <span className="num text-3xl font-semibold tracking-tight">
                {money(s.amount, s.currency)}
              </span>
              <span className="text-sm text-zinc-500">
                per {s.interval === 'yearly' ? 'year' : 'month'}
                {s.discountPct > 0 && ` · ${s.discountPct}% off ${money(s.unitPrice, s.currency)}`}
              </span>
            </div>
            <KeyValues
              items={[
                ['Plan', s.planName],
                ['Billing cycle', humanize(s.interval)],
                ['MRR contribution', money(s.mrr, s.currency)],
                [
                  'Current period',
                  s.currentPeriodStart
                    ? `${date(s.currentPeriodStart)} – ${date(s.currentPeriodEnd)}`
                    : 'Starts when paid',
                ],
                ['Trial ends', s.trialEndsAt ? date(s.trialEndsAt) : null],
                ['Customer since', date(s.createdAt)],
              ]}
            />
            <ErrorNotice error={change.error ?? renew.error} />
          </Panel>
          {can('billing.subscriptions') && (
            <Panel title="Change subscription" description="Takes effect from the next invoice">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-zinc-600">Plan</span>
                  <Select
                    aria-label="Plan"
                    value={s.planId}
                    disabled={change.isPending}
                    onChange={(e) => change.mutate({ planId: e.target.value })}
                  >
                    {plans.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {money(p.priceMonthly, p.currency)}/mo
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-zinc-600">
                    Billing cycle
                  </span>
                  <Select
                    aria-label="Billing cycle"
                    value={s.interval}
                    disabled={change.isPending}
                    onChange={(e) =>
                      change.mutate({ interval: e.target.value as 'monthly' | 'yearly' })
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly (discounted)</option>
                  </Select>
                </label>
                <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-4">
                  <div>
                    <div className="text-sm font-medium">Cancel at period end</div>
                    <div className="text-xs text-zinc-500">
                      No further invoices after {date(s.currentPeriodEnd)}
                    </div>
                  </div>
                  <Switch
                    label="Cancel at period end"
                    checked={s.cancelAtPeriodEnd}
                    disabled={change.isPending}
                    onChange={(v) => change.mutate({ cancelAtPeriodEnd: v })}
                  />
                </div>
              </div>
            </Panel>
          )}
        </div>
      )}

      <Panel title="Invoices" flush>
        <Table
          head={['Invoice', 'Status', 'Period', 'Issued', 'Due', 'Total', '']}
          empty="No invoices yet."
        >
          {invoices.data?.items.map((inv) => (
            <tr
              key={inv.id}
              className="cursor-pointer hover:bg-zinc-50"
              onClick={() => setSelected(inv)}
            >
              <Td>
                <Mono>{inv.number}</Mono>
              </Td>
              <Td>
                <Status value={inv.overdue ? 'overdue' : inv.status} />
              </Td>
              <Td className="whitespace-nowrap text-zinc-600">
                {inv.periodStart ? `${date(inv.periodStart)} – ${date(inv.periodEnd)}` : '—'}
              </Td>
              <Td className="whitespace-nowrap text-zinc-600">{date(inv.issuedAt)}</Td>
              <Td className="whitespace-nowrap text-zinc-600">{date(inv.dueAt)}</Td>
              <Td className="num text-right font-medium">{money(inv.total, inv.currency)}</Td>
              <Td className="text-right">
                {inv.status === 'open' && (
                  <span className="text-xs font-medium text-accent-700">Record payment →</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {invoices.data && (
          <Pagination
            {...page}
            total={invoices.data.total}
            onChange={setPage}
            sizes={[10, 25, 50]}
          />
        )}
      </Panel>
      <InvoiceDialog invoice={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

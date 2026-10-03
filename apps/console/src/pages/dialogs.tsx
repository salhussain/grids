import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PAYMENT_METHODS, yearlyPrice, type InvoiceDto, type PlanDto } from '@grids/schema';
import { api } from '../api';
import { useCan } from '../session';
import { TenantPicker } from './shared';
import {
  Button,
  Checkbox,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  KeyValues,
  Select,
  Status,
  Textarea,
  cx,
  useToast,
} from '@grids/ui';
import { date, humanize, money } from '@grids/ui';

const invalidateBilling = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all(
    [
      ['tenant'],
      ['tenants'],
      ['invoices'],
      ['subscriptions'],
      ['billing-overview'],
      ['overview'],
      ['plans'],
    ].map((queryKey) => qc.invalidateQueries({ queryKey })),
  );

// ---------------------------------------------------------------- subscribe

export function SubscribeDialog({
  tenantId,
  tenantName,
  open,
  onClose,
}: {
  tenantId: string;
  tenantName: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const plans = useQuery({ queryKey: ['plan-options'], queryFn: api.planOptions, enabled: open });
  const [planId, setPlanId] = useState('team');
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('yearly');
  const [trial, setTrial] = useState(false);
  const [extra, setExtra] = useState('0');
  const plan = plans.data?.find((p) => p.id === planId);
  const extraPct = Math.min(100, Math.max(0, Number(extra) || 0));

  const subscribe = useMutation({
    mutationFn: () =>
      api.subscribe(tenantId, {
        planId,
        interval,
        trial: trial && !!plan?.trialDays,
        extraDiscountPct: extraPct,
      }),
    onSuccess: async (s) => {
      await invalidateBilling(qc);
      toast(
        s.status === 'pending_payment'
          ? 'Subscription created, first invoice issued'
          : `Subscription ${s.status}, workspace provisioned`,
      );
      onClose();
    },
  });

  const price = plan ? quote(plan, interval, extraPct) : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Set up subscription"
      description={`Step 2 of 4: choose ${tenantName}’s plan and billing cycle.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => subscribe.mutate()} loading={subscribe.isPending} disabled={!plan}>
            {price?.amount === 0
              ? 'Activate free plan'
              : trial && plan?.trialDays
                ? `Start ${plan.trialDays}-day trial`
                : 'Create subscription & issue invoice'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div
          role="radiogroup"
          aria-label="Billing cycle"
          className="inline-flex border border-zinc-300"
        >
          {(['monthly', 'yearly'] as const).map((i) => (
            <button
              key={i}
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={cx(
                'px-4 py-2 text-sm',
                interval === i ? 'bg-ink text-canvas' : 'bg-snow text-zinc-700 hover:bg-zinc-100',
              )}
            >
              {humanize(i)}
              {i === 'yearly' && (
                <span
                  className={cx(
                    'ml-2 text-xs',
                    interval === i ? 'text-emerald-300' : 'text-emerald-700',
                  )}
                >
                  save up to {Math.max(0, ...(plans.data ?? []).map((p) => p.yearlyDiscountPct))}%
                </span>
              )}
            </button>
          ))}
        </div>

        <div
          role="radiogroup"
          aria-label="Plan"
          className="grid gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-2"
        >
          {plans.data?.map((p) => {
            const q = quote(p, interval, 0);
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={planId === p.id}
                onClick={() => setPlanId(p.id)}
                className={cx(
                  'flex flex-col items-start bg-snow p-4 text-left outline-offset-[-2px] hover:bg-zinc-50',
                  planId === p.id && 'outline-2 outline-accent-600',
                )}
              >
                <div className="flex w-full items-baseline justify-between">
                  <span className="font-semibold">{p.name}</span>
                  {planId === p.id && (
                    <span className="text-xs font-medium text-accent-700">Selected</span>
                  )}
                </div>
                <div className="mt-1">
                  <span className="num text-xl font-semibold">
                    {money(
                      interval === 'yearly' ? Math.round(q.amount / 12) : q.amount,
                      p.currency,
                    )}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {' '}
                    / month{interval === 'yearly' && q.amount > 0 ? ', billed yearly' : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{p.description}</p>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Negotiated discount (%)" hint="Applied on top of the yearly discount">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox
              label={
                plan?.trialDays
                  ? `Start with a ${plan.trialDays}-day free trial`
                  : 'No trial on this plan'
              }
              description="Provisions immediately; the first invoice is issued when the trial ends."
              checked={trial && !!plan?.trialDays}
              disabled={!plan?.trialDays}
              onChange={(e) => setTrial(e.target.checked)}
            />
          </div>
        </div>

        {price && plan && (
          <div className="border border-zinc-200 bg-zinc-50 p-4">
            <KeyValues
              items={[
                [
                  'List price',
                  `${money(price.unitPrice, plan.currency)} / ${interval === 'yearly' ? 'year' : 'month'}`,
                ],
                [
                  'Discount',
                  price.discountPct
                    ? `${price.discountPct}% (−${money(price.unitPrice - price.amount, plan.currency)})`
                    : 'None',
                ],
                [
                  'Customer pays',
                  <b key="p" className="num">
                    {money(price.amount, plan.currency)} /{' '}
                    {interval === 'yearly' ? 'year' : 'month'}
                  </b>,
                ],
                [
                  'First invoice',
                  price.amount === 0
                    ? 'None (free)'
                    : trial && plan.trialDays
                      ? `After trial (${plan.trialDays} days)`
                      : 'Now, due in 14 days',
                ],
              ]}
            />
          </div>
        )}
        <ErrorNotice error={subscribe.error} />
      </div>
    </Dialog>
  );
}

/** Client-side mirror of the server's pricing (display only; the server is authoritative). */
export function quote(p: PlanDto, interval: 'monthly' | 'yearly', extraPct: number) {
  const unitPrice = interval === 'yearly' ? p.priceMonthly * 12 : p.priceMonthly;
  const yearly = interval === 'yearly' ? p.yearlyDiscountPct : 0;
  const discountPct = Math.round((1 - (1 - yearly / 100) * (1 - extraPct / 100)) * 10000) / 100;
  const amount =
    interval === 'yearly' && extraPct === 0
      ? yearlyPrice(p.priceMonthly, yearly)
      : Math.round(unitPrice * (1 - discountPct / 100));
  return { unitPrice, discountPct, amount };
}

// ---------------------------------------------------------------- invoices

export function InvoiceDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceDto | null;
  onClose: () => void;
}) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));

  const pay = useMutation({
    mutationFn: () =>
      api.recordPayment(invoice!.id, {
        method,
        reference: reference || undefined,
        paidAt: new Date(`${paidAt}T12:00:00Z`).toISOString(),
      }),
    onSuccess: async (inv) => {
      await invalidateBilling(qc);
      toast(`Payment recorded for ${inv.number}`);
      setPaying(false);
      onClose();
    },
  });
  const voidIt = useMutation({
    mutationFn: () => api.voidInvoice(invoice!.id),
    onSuccess: async (inv) => {
      await invalidateBilling(qc);
      toast(`${inv.number} voided`);
      onClose();
    },
  });

  const inv = invoice;
  return (
    <Dialog
      open={!!inv}
      onClose={() => {
        setPaying(false);
        onClose();
      }}
      wide
      title={
        inv ? (
          <span className="flex items-center gap-3">
            <span className="font-mono">{inv.number}</span>
            <Status value={inv.overdue ? 'overdue' : inv.status} />
          </span>
        ) : (
          ''
        )
      }
      description={inv?.tenantName}
      footer={
        inv?.status === 'open' &&
        (paying ? (
          <>
            <Button variant="ghost" onClick={() => setPaying(false)}>
              Back
            </Button>
            <Button onClick={() => pay.mutate()} loading={pay.isPending}>
              Confirm payment of {money(inv.total, inv.currency)}
            </Button>
          </>
        ) : (
          <>
            {can('billing.invoices') && (
              <Button
                variant="danger"
                onClick={() => confirm(`Void ${inv.number}?`) && voidIt.mutate()}
                loading={voidIt.isPending}
              >
                Void
              </Button>
            )}
            {can('billing.payments') && (
              <Button onClick={() => setPaying(true)}>Record payment</Button>
            )}
          </>
        ))
      }
    >
      {inv && (
        <div className="space-y-5">
          <KeyValues
            items={[
              ['Issued', date(inv.issuedAt)],
              [
                'Due',
                <span key="d" className={inv.overdue ? 'font-medium text-red-700' : ''}>
                  {date(inv.dueAt)}
                </span>,
              ],
              [
                'Period',
                inv.periodStart ? `${date(inv.periodStart)} – ${date(inv.periodEnd)}` : '—',
              ],
              [
                'Paid',
                inv.paidAt
                  ? `${date(inv.paidAt)} · ${humanize(inv.paymentMethod ?? '')}${inv.paymentReference ? ` · ${inv.paymentReference}` : ''}`
                  : '—',
              ],
            ]}
          />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-xs text-zinc-500">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-zinc-100">
                  <td className="py-2.5 pr-4">{l.description}</td>
                  <td className="num py-2.5 text-right">{money(l.amount, inv.currency)}</td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 text-right font-semibold">Total</td>
                <td className="num pt-3 text-right text-lg font-semibold">
                  {money(inv.total, inv.currency)}
                </td>
              </tr>
            </tbody>
          </table>
          {paying && (
            <div className="grid gap-4 border-t border-zinc-200 pt-5 sm:grid-cols-3">
              <Field label="Method">
                <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {humanize(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference">
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Bank ref / receipt no."
                />
              </Field>
              <Field label="Paid on">
                <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </Field>
            </div>
          )}
          <ErrorNotice error={pay.error ?? voidIt.error} />
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- tickets

export function NewTicketDialog({
  open,
  onClose,
  tenantId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
  onCreated?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    tenantId: tenantId ?? '',
    subject: '',
    category: 'question',
    priority: 'normal',
    body: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const create = useMutation({
    mutationFn: () => api.createTicket({ ...form, tenantId: tenantId ?? form.tenantId } as never),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ['tickets'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      toast(`Ticket #${t.number} opened`);
      onClose();
      onCreated?.(t.id);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New ticket"
      description="Open a ticket on behalf of an organisation (e.g. after a phone call)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Open ticket
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!tenantId && (
          <div>
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-zinc-600">
              Organisation *
            </span>
            <TenantPicker
              value={form.tenantId}
              onChange={(id) => set('tenantId', id)}
              emptyLabel="Select…"
            />
          </div>
        )}
        <Field label="Subject" required>
          <Input value={form.subject} onChange={(e) => set('subject', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {['question', 'bug', 'billing', 'feature_request', 'account', 'other'].map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {['low', 'normal', 'high', 'urgent'].map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description" required>
          <Textarea value={form.body} onChange={(e) => set('body', e.target.value)} rows={5} />
        </Field>
        <ErrorNotice error={create.error} />
      </div>
    </Dialog>
  );
}

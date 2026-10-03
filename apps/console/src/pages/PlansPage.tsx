import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  CURRENCIES,
  FEATURE_KEYS,
  LIMIT_KEYS,
  type LimitKey,
  type PlanDto,
  type UsageItem,
} from '@grids/schema';
import { api } from '../api';
import {
  Button,
  Checkbox,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Mono,
  PageHeader,
  Select,
  Status,
  Textarea,
  cx,
  useToast,
} from '@grids/ui';
import { NoAccess, useCan } from '../session';
import { featureLabel, money } from '@grids/ui';

export const LIMIT_LABELS: Record<LimitKey, string> = {
  projects: 'Projects',
  users: 'Users',
  forms: 'Forms / surveys',
  submissions_per_month: 'Submissions / month',
  storage_gb: 'Storage (GB)',
  api_calls_per_month: 'API calls / month',
  rows_ingested_per_month: 'Rows ingested / month',
  run_minutes_per_month: 'Job minutes / month',
};
const fmtLimit = (n: number | null | undefined) =>
  n === null || n === undefined ? 'Unlimited' : n.toLocaleString();

export function PlansPage() {
  const can = useCan();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<PlanDto | 'new' | null>(null);
  const plans = useQuery({
    queryKey: ['plans', { showArchived }],
    queryFn: () => api.plans(showArchived),
    enabled: can('plans.view'),
  });
  if (!can('plans.view')) return <NoAccess what="plans & pricing" />;

  return (
    <>
      <PageHeader
        eyebrow="Revenue"
        title="Plans & pricing"
        meta={
          <span>
            Price changes apply to new subscriptions. Existing customers keep their price.
          </span>
        }
        actions={
          <>
            <Checkbox
              label="Show archived"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {can('plans.manage') && (
              <Button icon={Plus} onClick={() => setEditing('new')}>
                New plan
              </Button>
            )}
          </>
        }
      />
      {plans.isPending ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto border border-zinc-200 bg-snow">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-zinc-300">
                <th className="w-56 bg-zinc-50 px-5 py-4 text-left text-xs font-medium text-zinc-500" />
                {plans.data?.map((p) => (
                  <th
                    key={p.id}
                    className="border-l border-zinc-200 px-5 py-4 text-left align-top font-normal"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-base font-semibold text-ink">{p.name}</div>
                        <Mono className="text-xs text-zinc-500">{p.id}</Mono>
                      </div>
                      {can('plans.manage') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                    <div className="mt-3">
                      <span className="num text-2xl font-semibold text-ink">
                        {money(p.priceMonthly, p.currency)}
                      </span>
                      <span className="text-xs text-zinc-500"> / month</span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-600">
                      {p.priceMonthly ? (
                        <>
                          {money(p.priceYearly, p.currency)} / year
                          {p.yearlyDiscountPct > 0 && (
                            <span className="text-emerald-700"> (−{p.yearlyDiscountPct}%)</span>
                          )}
                        </>
                      ) : (
                        'Free forever'
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.isArchived && <Status value="archived" tone="neutral" />}
                      {!p.isPublic && <Status value="private" tone="warn" />}
                      {p.trialDays > 0 && <Status value={`${p.trialDays}-day trial`} tone="info" />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row
                label="Subscribers"
                plans={plans.data}
                render={(p) => <span className="num font-medium">{p.subscriberCount}</span>}
              />
              <Row
                label="Description"
                plans={plans.data}
                render={(p) => (
                  <span className="text-xs text-zinc-600">{p.description || '—'}</span>
                )}
              />
              <tr>
                <td
                  colSpan={99}
                  className="bg-zinc-50 px-5 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
                >
                  Limits
                </td>
              </tr>
              {LIMIT_KEYS.map((k) => (
                <Row
                  key={k}
                  label={LIMIT_LABELS[k]}
                  plans={plans.data}
                  render={(p) => (
                    <span
                      className={cx('num', p.limits[k] === null && 'font-medium text-emerald-800')}
                    >
                      {fmtLimit(p.limits[k])}
                    </span>
                  )}
                />
              ))}
              <tr>
                <td
                  colSpan={99}
                  className="bg-zinc-50 px-5 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
                >
                  Features
                </td>
              </tr>
              {FEATURE_KEYS.map((f) => (
                <Row
                  key={f}
                  label={featureLabel(f)}
                  plans={plans.data}
                  render={(p) =>
                    p.features.includes(f) ? (
                      <span className="font-medium text-ink">✓</span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PlanEditor plan={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function Row({
  label,
  plans,
  render,
}: {
  label: string;
  plans?: PlanDto[];
  render: (p: PlanDto) => React.ReactNode;
}) {
  return (
    <tr className="border-b border-zinc-100">
      <td className="bg-zinc-50 px-5 py-2.5 text-zinc-600">{label}</td>
      {plans?.map((p) => (
        <td key={p.id} className="border-l border-zinc-200 px-5 py-2.5">
          {render(p)}
        </td>
      ))}
    </tr>
  );
}

type Draft = {
  id: string;
  name: string;
  description: string;
  currency: string;
  price: string;
  yearlyDiscountPct: string;
  trialDays: string;
  limits: Record<LimitKey, string>;
  features: string[];
  isPublic: boolean;
  isArchived: boolean;
  sortOrder: string;
};

const toDraft = (p: PlanDto | null): Draft => ({
  id: p?.id ?? '',
  name: p?.name ?? '',
  description: p?.description ?? '',
  currency: p?.currency ?? 'USD',
  price: p ? (p.priceMonthly / 100).toFixed(2) : '0.00',
  yearlyDiscountPct: String(p?.yearlyDiscountPct ?? 15),
  trialDays: String(p?.trialDays ?? 14),
  limits: Object.fromEntries(
    LIMIT_KEYS.map((k) => [k, p ? (p.limits[k] === null ? '' : String(p.limits[k])) : '']),
  ) as Record<LimitKey, string>,
  features: p?.features ?? [],
  isPublic: p?.isPublic ?? true,
  isArchived: p?.isArchived ?? false,
  sortOrder: String(p?.sortOrder ?? 10),
});

function PlanEditor({ plan, onClose }: { plan: PlanDto | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = plan === 'new';
  const [d, setD] = useState<Draft>(() => toDraft(null));
  const [loadedFor, setLoadedFor] = useState<unknown>(null);
  if (plan !== loadedFor) {
    setLoadedFor(plan);
    setD(toDraft(plan === 'new' ? null : plan));
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: d.name,
        description: d.description,
        currency: d.currency as (typeof CURRENCIES)[number],
        priceMonthly: Math.round(Number(d.price) * 100),
        yearlyDiscountPct: Number(d.yearlyDiscountPct),
        trialDays: Number(d.trialDays),
        limits: Object.fromEntries(
          LIMIT_KEYS.map((k) => [k, d.limits[k] === '' ? null : Number(d.limits[k])]),
        ) as Record<LimitKey, number | null>,
        features: d.features as (typeof FEATURE_KEYS)[number][],
        isPublic: d.isPublic,
        isArchived: d.isArchived,
        sortOrder: Number(d.sortOrder),
      };
      return isNew
        ? api.createPlan({ ...input, id: d.id })
        : api.updatePlan((plan as PlanDto).id, input);
    },
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ['plans'] });
      toast(`${p.name} saved`);
      onClose();
    },
  });
  const yearly = Math.round(Number(d.price) * 100 * 12 * (1 - Number(d.yearlyDiscountPct) / 100));

  return (
    <Dialog
      open={plan !== null}
      onClose={onClose}
      wide
      title={isNew ? 'New plan' : `Edit ${(plan as PlanDto | null)?.name ?? ''}`}
      description="Leave a limit blank for unlimited."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save plan
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Plan ID" required hint="Lowercase, used in APIs">
            <Input
              value={d.id}
              onChange={(e) => set('id', e.target.value)}
              disabled={!isNew}
              className="font-mono"
              placeholder="starter"
            />
          </Field>
          <Field label="Name" required>
            <Input value={d.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Display order">
            <Input
              type="number"
              value={d.sortOrder}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </Field>
          <Field label="Description" className="sm:col-span-3">
            <Textarea
              rows={2}
              value={d.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        </div>
        <div>
          <h3 className="mb-3 border-b border-zinc-200 pb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
            Pricing
          </h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Currency">
              <Select value={d.currency} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Monthly price">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={d.price}
                onChange={(e) => set('price', e.target.value)}
              />
            </Field>
            <Field label="Yearly discount %" hint={`${money(yearly, d.currency)} / year`}>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={d.yearlyDiscountPct}
                onChange={(e) => set('yearlyDiscountPct', e.target.value)}
              />
            </Field>
            <Field label="Free trial (days)">
              <Input
                type="number"
                min={0}
                value={d.trialDays}
                onChange={(e) => set('trialDays', e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div>
          <h3 className="mb-3 border-b border-zinc-200 pb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
            Limits
          </h3>
          <div className="grid gap-4 sm:grid-cols-4">
            {LIMIT_KEYS.map((k) => (
              <Field key={k} label={LIMIT_LABELS[k]}>
                <Input
                  type="number"
                  min={0}
                  value={d.limits[k]}
                  placeholder="Unlimited"
                  onChange={(e) => set('limits', { ...d.limits, [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 border-b border-zinc-200 pb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
            Features
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {FEATURE_KEYS.map((f) => (
              <Checkbox
                key={f}
                label={featureLabel(f)}
                checked={d.features.includes(f)}
                onChange={(e) =>
                  set(
                    'features',
                    e.target.checked ? [...d.features, f] : d.features.filter((x) => x !== f),
                  )
                }
              />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-6 border-t border-zinc-200 pt-4">
          <Checkbox
            label="Public"
            description="Offered on the pricing page and in the subscribe dialog"
            checked={d.isPublic}
            onChange={(e) => set('isPublic', e.target.checked)}
          />
          <Checkbox
            label="Archived"
            description="No new subscriptions; existing ones continue"
            checked={d.isArchived}
            onChange={(e) => set('isArchived', e.target.checked)}
          />
        </div>
        <ErrorNotice error={save.error} />
      </div>
    </Dialog>
  );
}

export function UsageMeter({ item }: { item: UsageItem }) {
  const pct =
    item.used === null || item.limit === null
      ? null
      : Math.min(100, (item.used / Math.max(item.limit, 1)) * 100);
  const tone =
    pct === null
      ? 'bg-zinc-300'
      : pct >= 100
        ? 'bg-red-600'
        : pct >= 80
          ? 'bg-amber-500'
          : 'bg-accent-600';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-zinc-600">{LIMIT_LABELS[item.key]}</span>
        <span className="num shrink-0 font-medium">
          {item.used === null ? (
            <span className="font-normal text-zinc-400">not metered</span>
          ) : (
            item.used.toLocaleString()
          )}
          <span className="font-normal text-zinc-400"> / {fmtLimit(item.limit)}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={LIMIT_LABELS[item.key]}
        aria-valuemin={0}
        aria-valuenow={item.used ?? undefined}
        aria-valuemax={item.limit ?? undefined}
        aria-valuetext={
          item.used === null ? 'not metered' : `${item.used} of ${fmtLimit(item.limit)}`
        }
        className="mt-1.5 h-1.5 bg-zinc-100"
      >
        <div className={cx('h-full transition-all', tone)} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import type React from 'react';
import { CalendarX2, Clock, CreditCard, Gauge, LogOut, Undo2 } from 'lucide-react';
import { Button, cx } from '@grids/ui';
import { signOut } from './auth';
import { useT } from './i18n';
import { useCan, useWorkspace } from './session';

/** The deep maroon used for the project's archive box: the same look for anything that is blocked or taken away. */
const DANGER = {
  '--a': '#7a1f24',
  background: 'color-mix(in srgb, var(--a) 7%, var(--color-snow))',
  borderColor: 'color-mix(in srgb, var(--a) 22%, var(--color-zinc-200))',
  borderInlineStartColor: 'var(--a)',
} as React.CSSProperties;

/**
 * A line across the top of the workspace when the plan needs attention: a limit that is used up (nothing more can be
 * added) or, for those who look after billing, a subscription that is about to run out.
 */
export function PlanNotice() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const navigate = useNavigate();
  // The Billing page says all of this itself, in more detail.
  const onBilling = useRouterState({
    select: (st) => /\/billing(\/|$)/.test(st.location.pathname),
  });
  const billing = can('billing.view');
  const full = (ws.limits ?? []).filter(
    (u) => u.limit !== null && u.used !== null && u.used >= u.limit,
  );
  const items: {
    tone: 'bad' | 'warn';
    icon: typeof Gauge;
    text: string;
    tab: 'plans' | 'subscription';
    label: string;
  }[] = [];
  if (full.length)
    items.push({
      tone: 'bad',
      icon: Gauge,
      tab: 'plans',
      label: 'See plan',
      text: `Plan limit reached: ${full.map((u) => t(`web.billing.limitNames.${u.key}`)).join(', ')}. No more can be added until the plan is changed${billing ? '.' : ': ask your organisation’s administrator.'}`,
    });
  if (billing && ws.subscription?.state === 'expiring' && ws.subscription.daysLeft !== null)
    items.push({
      tone: 'warn',
      icon: Clock,
      tab: 'subscription',
      label: 'See subscription',
      text: `The subscription ends in ${ws.subscription.daysLeft} ${ws.subscription.daysLeft === 1 ? 'day' : 'days'}. After that nobody can sign in.`,
    });
  if (!items.length || onBilling) return null;
  return (
    <div className="mb-6 space-y-2">
      {items.map((n, i) => (
        <div
          key={i}
          role="alert"
          className={cx(
            'flex items-center gap-3 px-4 py-2.5 text-sm',
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
          {billing && (
            <Button
              size="sm"
              variant="secondary"
              icon={CreditCard}
              onClick={() =>
                void navigate({ to: '/o/$tenantId/billing', params: { tenantId: ws.tenant.id }, search: { tab: n.tab } })
              }
            >
              {n.label}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Shown in place of the workspace when the organisation's subscription has ended. */
export function SubscriptionEnded() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md text-center">
        <CalendarX2 className="mx-auto size-14 text-accent-600" strokeWidth={1.5} aria-hidden />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Subscription ended</h1>
        <p className="mt-2 text-sm text-zinc-600">
          This organisation’s subscription has ended, so it can’t be used right now. Ask your
          organisation’s administrator to renew it, or contact the Grids team.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 px-3.5 text-sm hover:bg-zinc-100"
          >
            <Undo2 className="size-4" aria-hidden /> Other organisations
          </Link>
          <Button variant="secondary" icon={LogOut} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, CreditCard, Pencil, Receipt, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { TenantDetail } from '@grids/schema';
import { api } from '../api';
import { tenantRoute } from '../router';
import { useCan } from '../session';
import {
  Button,
  Callout,
  ErrorNotice,
  Loading,
  Mono,
  PageHeader,
  Status,
  Tabs,
  useToast,
} from '@grids/ui';
import { relTime } from '@grids/ui';
import { InvoiceDialog, SubscribeDialog } from './dialogs';
import { ActivityTab } from './tenant/ActivityTab';
import { BillingTab } from './tenant/BillingTab';
import { DomainsTab } from './tenant/DomainsTab';
import { EditProfileDialog, OverviewTab } from './tenant/OverviewTab';
import { InviteDialog, PeopleTab } from './tenant/PeopleTab';
import { SecurityTab } from './tenant/SecurityTab';
import { SupportTab } from './tenant/SupportTab';

type Tab = 'overview' | 'billing' | 'people' | 'security' | 'domains' | 'support' | 'activity';

export function TenantPage() {
  const can = useCan();
  const { tenantId } = tenantRoute.useParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<'edit' | 'subscribe' | 'invite' | null>(null);
  const tenant = useQuery({ queryKey: ['tenant', tenantId], queryFn: () => api.tenant(tenantId) });

  if (tenant.isPending) return <Loading />;
  if (tenant.isError) return <ErrorNotice error={tenant.error} />;
  const t = tenant.data;
  const primary = t.domains.find((d) => d.isPrimary);

  return (
    <>
      <Link
        to="/tenants"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Organisations
      </Link>
      <PageHeader
        eyebrow={t.legalName ?? 'Organisation'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t.name} <Status value={t.status} />
          </span>
        }
        meta={
          <>
            <Mono>{primary?.hostname ?? t.slug}</Mono>
            <span>{t.planName ? `${t.planName} plan` : 'No plan'}</span>
            <span>{t.memberCount} members</span>
            <span>Created {relTime(t.createdAt)}</span>
          </>
        }
        actions={
          <>
            {can('tenants.edit') && (
              <Button variant="secondary" icon={Pencil} onClick={() => setDialog('edit')}>
                Edit profile
              </Button>
            )}
            {can('tenants.lifecycle') && <StatusActions t={t} />}
          </>
        }
      />

      <NextStep
        t={t}
        onSubscribe={() => setDialog('subscribe')}
        onInvite={() => setDialog('invite')}
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview' as const, label: 'Overview', show: true },
          { id: 'billing' as const, label: 'Billing', show: can('billing.view') },
          {
            id: 'people' as const,
            label: 'People',
            count: t.memberCount,
            show: can('members.view'),
          },
          { id: 'security' as const, label: 'Security', show: true },
          { id: 'domains' as const, label: 'Domains', show: true },
          {
            id: 'support' as const,
            label: 'Support',
            count: t.openTickets,
            show: can('support.view'),
          },
          { id: 'activity' as const, label: 'Activity', show: can('logs.system') },
        ].filter((x) => x.show)}
      />

      {tab === 'overview' && <OverviewTab t={t} />}
      {tab === 'billing' && <BillingTab t={t} onSubscribe={() => setDialog('subscribe')} />}
      {tab === 'people' && <PeopleTab t={t} onInvite={() => setDialog('invite')} />}
      {tab === 'security' && <SecurityTab t={t} />}
      {tab === 'domains' && <DomainsTab t={t} />}
      {tab === 'support' && <SupportTab t={t} />}
      {tab === 'activity' && <ActivityTab t={t} />}

      <EditProfileDialog t={t} open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <SubscribeDialog
        tenantId={t.id}
        tenantName={t.name}
        open={dialog === 'subscribe'}
        onClose={() => setDialog(null)}
      />
      <InviteDialog
        t={t}
        open={dialog === 'invite'}
        onClose={() => setDialog(null)}
        defaultRole={t.nextStep === 'invite_admin' ? 'org_admin' : 'member'}
      />
    </>
  );
}

function NextStep({
  t,
  onSubscribe,
  onInvite,
}: {
  t: TenantDetail;
  onSubscribe: () => void;
  onInvite: () => void;
}) {
  const can = useCan();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const invoices = useQuery({
    queryKey: ['invoices', { tenantId: t.id, status: 'open' }],
    queryFn: () => api.invoices({ tenantId: t.id, status: 'open', pageSize: 5 }),
    enabled: t.nextStep === 'record_payment',
  });
  const open = invoices.data?.items[0] ?? null;

  if (t.nextStep === 'subscribe') {
    return (
      <div className="mb-6">
        <Callout
          icon={CreditCard}
          title="Next: set up a subscription"
          action={
            can('billing.subscriptions') && (
              <Button onClick={onSubscribe}>Set up subscription</Button>
            )
          }
        >
          Choose a plan and billing cycle. Paid plans issue the first invoice; trials and free plans
          start immediately.
        </Callout>
      </div>
    );
  }
  if (t.nextStep === 'record_payment') {
    return (
      <div className="mb-6">
        <Callout
          tone="warn"
          icon={Receipt}
          title="Awaiting payment"
          action={
            can('billing.payments') && (
              <Button onClick={() => setInvoiceOpen(true)} disabled={!open}>
                Record payment
              </Button>
            )
          }
        >
          {open ? (
            <>
              Invoice <Mono>{open.number}</Mono> was sent to the billing contact. The workspace is
              provisioned once it’s paid.
            </>
          ) : (
            'Loading invoice…'
          )}
        </Callout>
        <InvoiceDialog invoice={invoiceOpen ? open : null} onClose={() => setInvoiceOpen(false)} />
      </div>
    );
  }
  if (t.nextStep === 'invite_admin') {
    return (
      <div className="mb-6">
        <Callout
          icon={UserPlus}
          title="Next: invite an administrator"
          action={can('members.manage') && <Button onClick={onInvite}>Invite administrator</Button>}
        >
          The workspace is live. Invite the organisation’s administrator. They’ll manage their own
          users, 2FA and settings.
        </Callout>
      </div>
    );
  }
  return null;
}

function StatusActions({ t }: { t: TenantDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const set = useMutation({
    mutationFn: (status: 'active' | 'suspended' | 'cancelled') =>
      api.setTenantStatus(t.id, { status }),
    onSuccess: (res) => {
      qc.setQueryData(['tenant', t.id], res);
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      toast(`${res.name} is now ${res.status}`);
    },
    onError: (e) => alert(e.message),
  });
  if (t.status === 'cancelled') return null;
  return (
    <>
      {t.status === 'active' && (
        <Button
          variant="danger"
          loading={set.isPending}
          onClick={() =>
            confirm(`Suspend ${t.name}? Its users lose access until reactivated.`) &&
            set.mutate('suspended')
          }
        >
          Suspend
        </Button>
      )}
      {(t.status === 'suspended' || t.status === 'provisioning') && (
        <Button variant="secondary" loading={set.isPending} onClick={() => set.mutate('active')}>
          {t.status === 'provisioning' ? 'Resume provisioning' : 'Reactivate'}
        </Button>
      )}
      {t.status !== 'active' && (
        <Button
          variant="danger"
          loading={set.isPending}
          onClick={() =>
            confirm(`Cancel ${t.name}? This cancels the subscription and voids open invoices.`) &&
            set.mutate('cancelled')
          }
        >
          Cancel organisation
        </Button>
      )}
    </>
  );
}

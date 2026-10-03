import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  Menu,
  ScrollText,
  Tags,
  UserCog,
  X,
  type LucideIcon,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api';
import { accountUrl, completeSignIn, userManager } from './auth';
import { BillingPage } from './pages/BillingPage';
import { EmailLogPage } from './pages/EmailLogPage';
import { InvitePage } from './pages/InvitePage';
import { NewTenantPage } from './pages/NewTenantPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlansPage } from './pages/PlansPage';
import { SupportPage } from './pages/SupportPage';
import { SystemLogPage } from './pages/SystemLogPage';
import { TenantPage } from './pages/TenantPage';
import { TenantsPage } from './pages/TenantsPage';
import { TicketPage } from './pages/TicketPage';
import { FullPageSpinner, Logo, RequireSession, useCan, useSession } from './session';
import { applyColorMode, cx } from '@grids/ui';
import type { StaffPermission } from '@grids/schema';
import { StaffPage } from './pages/StaffPage';

const rootRoute = createRootRoute({ component: Outlet });

interface NavItem {
  permission: StaffPermission;
  to:
    | '/'
    | '/tenants'
    | '/billing'
    | '/plans'
    | '/support'
    | '/logs/emails'
    | '/logs/system'
    | '/staff';
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
  badge?: number;
}

function useNav(): { section: string; items: NavItem[] }[] {
  const can = useCan();
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    staleTime: 30_000,
    enabled: can('overview.view'),
  });
  const groups: { section: string; items: NavItem[] }[] = [
    {
      section: 'Platform',
      items: [
        {
          to: '/',
          label: 'Overview',
          icon: LayoutDashboard,
          match: (p) => p === '/',
          permission: 'overview.view',
        },
        {
          to: '/tenants',
          label: 'Organisations',
          icon: Building2,
          match: (p) => p.startsWith('/tenants'),
          permission: 'tenants.view',
        },
      ],
    },
    {
      section: 'Revenue',
      items: [
        {
          to: '/billing',
          label: 'Billing',
          icon: CreditCard,
          match: (p) => p.startsWith('/billing'),
          permission: 'billing.view',
        },
        {
          to: '/plans',
          label: 'Plans & pricing',
          icon: Tags,
          match: (p) => p.startsWith('/plans'),
          permission: 'plans.view',
        },
      ],
    },
    {
      section: 'Operations',
      items: [
        {
          to: '/support',
          label: 'Support',
          icon: LifeBuoy,
          match: (p) => p.startsWith('/support'),
          badge: overview.data?.openTickets,
          permission: 'support.view',
        },
        {
          to: '/logs/emails',
          label: 'Email log',
          icon: Mail,
          match: (p) => p.startsWith('/logs/emails'),
          permission: 'logs.email',
        },
        {
          to: '/logs/system',
          label: 'System log',
          icon: ScrollText,
          match: (p) => p.startsWith('/logs/system'),
          permission: 'logs.system',
        },
      ],
    },
    {
      section: 'Administration',
      items: [
        {
          to: '/staff',
          label: 'Staff & roles',
          icon: UserCog,
          match: (p) => p.startsWith('/staff'),
          permission: 'staff.view',
        },
      ],
    },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) }))
    .filter((g) => g.items.length);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { me } = useSession();
  return (
    <div className="chrome flex h-full flex-col bg-chrome text-zinc-300">
      <div className="flex h-14 items-center border-b border-white/10 px-5">
        <Logo dark />
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {useNav().map((group) => (
          <div key={group.section} className="mb-5">
            <div className="px-5 pb-2 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
              {group.section}
            </div>
            {group.items.map((item) => {
              const active = item.match(path);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex items-center gap-3 border-l-[3px] px-5 py-2 text-sm transition-colors',
                    active
                      ? 'border-accent-500 bg-white/[0.08] text-white'
                      : 'border-transparent hover:bg-white/[0.04] hover:text-white',
                  )}
                >
                  <item.icon
                    className={cx(
                      'size-[18px] shrink-0',
                      active ? 'text-accent-500' : 'text-zinc-500',
                    )}
                    strokeWidth={1.75}
                  />
                  <span className="flex-1">{item.label}</span>
                  {!!item.badge && (
                    <span className="num min-w-5 bg-accent-600 px-1.5 text-center text-[11px] font-medium text-white">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center bg-accent-600 text-xs font-semibold text-white">
            {(me.displayName ?? me.email ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">{me.displayName ?? me.email}</div>
            <div className="truncate text-xs text-zinc-500">{me.email}</div>
          </div>
          <ColorModeButton />
          <a
            href={accountUrl()}
            title="Account & security"
            aria-label="Account & security"
            className="p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
          >
            <UserCog className="size-4" />
          </a>
          <button
            onClick={() => userManager.signoutRedirect()}
            title="Sign out"
            aria-label="Sign out"
            className="p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cycles light → dark → system and saves it as the person's preference. */
function ColorModeButton() {
  const { me } = useSession();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: api.setPreferences,
    onSuccess: (next) => {
      qc.setQueryData(['me'], next);
      applyColorMode(next.preferences.colorMode);
    },
  });
  const mode = me.preferences.colorMode;
  const next = ({ light: 'dark', dark: 'system', system: 'light' } as const)[mode];
  const Icon = { light: Sun, dark: Moon, system: Monitor }[mode];
  const label = `Appearance: ${mode} (switch to ${next})`;
  return (
    <button
      onClick={() => save.mutate({ colorMode: next })}
      title={label}
      aria-label={label}
      className="p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Authenticated shell: fixed dark sidebar on desktop, slide-over on mobile. */
function ConsoleLayout() {
  const [open, setOpen] = useState(false);
  return (
    <RequireSession>
      <div className="min-h-full lg:pl-64">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
          <Sidebar />
        </aside>
        <header className="sticky top-0 z-20 chrome flex h-14 items-center justify-between bg-chrome px-4 lg:hidden">
          <Logo dark />
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 text-white">
            <Menu className="size-5" />
          </button>
        </header>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72">
              <Sidebar onNavigate={() => setOpen(false)} />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="chrome absolute top-3 -right-11 bg-chrome p-2 text-white"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        )}
        <main className="px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1280px]">
            <Outlet />
          </div>
        </main>
      </div>
    </RequireSession>
  );
}

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'console',
  component: ConsoleLayout,
});

export const tenantRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/tenants/$tenantId',
  component: TenantPage,
});
export const ticketRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/support/$ticketId',
  component: TicketPage,
});
export const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: InvitePage,
});

function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeSignIn()
      .then((user) => {
        const returnTo = (user.state as { returnTo?: string } | undefined)?.returnTo ?? '/';
        void navigate({ to: returnTo === '/auth/callback' ? '/' : returnTo, replace: true });
      })
      .catch((e: Error) => setError(e.message));
  }, [navigate]);
  return error ? (
    <p className="p-8 text-sm text-red-700">Sign-in failed: {error}</p>
  ) : (
    <FullPageSpinner />
  );
}
const callbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: CallbackPage,
});

const parent = () => consoleRoute;
const routeTree = rootRoute.addChildren([
  consoleRoute.addChildren([
    createRoute({ getParentRoute: parent, path: '/', component: OverviewPage }),
    createRoute({ getParentRoute: parent, path: '/tenants', component: TenantsPage }),
    createRoute({ getParentRoute: parent, path: '/tenants/new', component: NewTenantPage }),
    tenantRoute,
    createRoute({ getParentRoute: parent, path: '/billing', component: BillingPage }),
    createRoute({ getParentRoute: parent, path: '/plans', component: PlansPage }),
    createRoute({ getParentRoute: parent, path: '/support', component: SupportPage }),
    ticketRoute,
    createRoute({ getParentRoute: parent, path: '/logs/emails', component: EmailLogPage }),
    createRoute({ getParentRoute: parent, path: '/logs/system', component: SystemLogPage }),
    createRoute({ getParentRoute: parent, path: '/staff', component: StaffPage }),
  ]),
  inviteRoute,
  callbackRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

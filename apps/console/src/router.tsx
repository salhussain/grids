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
  Globe,
  SlidersHorizontal,
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
import { applyColorMode, cx, Listbox, ModeSwitch, type ColorMode } from '@grids/ui';
import { LOCALES } from '@grids/i18n';
import { I18nProvider, useI18n, usePlatform, usePlatformBranding, useT } from './i18n';
import { SettingsPage } from './pages/SettingsPage';
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
    | '/staff'
    | '/settings';
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
      section: 'console.nav.platform',
      items: [
        {
          to: '/',
          label: 'console.nav.overview',
          icon: LayoutDashboard,
          match: (p) => p === '/',
          permission: 'overview.view',
        },
        {
          to: '/tenants',
          label: 'console.nav.organisations',
          icon: Building2,
          match: (p) => p.startsWith('/tenants'),
          permission: 'tenants.view',
        },
      ],
    },
    {
      section: 'console.nav.revenue',
      items: [
        {
          to: '/billing',
          label: 'console.nav.billing',
          icon: CreditCard,
          match: (p) => p.startsWith('/billing'),
          permission: 'billing.view',
        },
        {
          to: '/plans',
          label: 'console.nav.plans',
          icon: Tags,
          match: (p) => p.startsWith('/plans'),
          permission: 'plans.view',
        },
      ],
    },
    {
      section: 'console.nav.operations',
      items: [
        {
          to: '/support',
          label: 'console.nav.support',
          icon: LifeBuoy,
          match: (p) => p.startsWith('/support'),
          badge: overview.data?.openTickets,
          permission: 'support.view',
        },
        {
          to: '/logs/emails',
          label: 'console.nav.emailLog',
          icon: Mail,
          match: (p) => p.startsWith('/logs/emails'),
          permission: 'logs.email',
        },
        {
          to: '/logs/system',
          label: 'console.nav.systemLog',
          icon: ScrollText,
          match: (p) => p.startsWith('/logs/system'),
          permission: 'logs.system',
        },
      ],
    },
    {
      section: 'console.nav.administration',
      items: [
        {
          to: '/staff',
          label: 'console.nav.staff',
          icon: UserCog,
          match: (p) => p.startsWith('/staff'),
          permission: 'staff.view',
        },
        {
          to: '/settings',
          label: 'console.nav.settings',
          icon: SlidersHorizontal,
          match: (p) => p.startsWith('/settings'),
          permission: 'settings.manage',
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
  const t = useT();
  return (
    <div className="chrome flex h-full flex-col bg-chrome bg-[radial-gradient(120%_60%_at_0%_0%,rgb(255_255_255/0.06),transparent)] text-zinc-300">
      <div className="flex h-14 items-center border-b border-white/10 px-5">
        <Logo dark />
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {useNav().map((group) => (
          <div key={group.section} className="mb-5">
            <div className="px-6 pb-2 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
              {t(group.section)}
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
                    'mx-3 mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'
                      : 'hover:bg-white/[0.05] hover:text-white',
                  )}
                >
                  <item.icon
                    className={cx(
                      'size-[18px] shrink-0',
                      active ? 'text-accent-500' : 'text-zinc-500',
                    )}
                    strokeWidth={1.75}
                  />
                  <span className="flex-1">{t(item.label)}</span>
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
          <a
            href={accountUrl()}
            title={t('console.shell.account')}
            aria-label={t('console.shell.account')}
            className="p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
          >
            <UserCog className="size-4" />
          </a>
          <button
            onClick={() => userManager.signoutRedirect()}
            title={t('console.shell.signOut')}
            aria-label={t('console.shell.signOut')}
            className="p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Language and appearance, top right on every console page; saved as the person's preferences. */
function HeaderControls({ className }: { className?: string }) {
  const { me } = useSession();
  const t = useT();
  const { locale } = useI18n();
  const platform = usePlatform();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: api.setPreferences,
    onSuccess: (next) => qc.setQueryData(['me'], next),
  });
  const [mode, setMode] = useState<ColorMode>(me.preferences.colorMode);
  const langs = LOCALES.filter((l) => (platform.data?.localization.consoleLanguages ?? ['en']).includes(l.code));
  return (
    <div className={cx('flex items-center gap-2', className)}>
      {langs.length > 1 && (
        <Listbox
          compact
          align="end"
          label={t('console.shell.language')}
          className="w-40"
          value={locale as string}
          onChange={(v) => save.mutate({ locale: v })}
          options={langs.map((l) => ({ value: l.code as string, label: l.nativeName, text: l.nativeName, icon: Globe }))}
        />
      )}
      <ModeSwitch
        value={mode}
        labels={{ light: t('common.light'), dark: t('common.dark'), system: t('common.system'), group: t('common.appearance') }}
        onChange={(m) => {
          setMode(m);
          applyColorMode(m);
          save.mutate({ colorMode: m });
        }}
      />
    </div>
  );
}

/** Wraps the signed-in console in the person's language and the platform's look. */
function ConsoleI18n({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  usePlatformBranding();
  return <I18nProvider preferred={me.preferences.locale}>{children}</I18nProvider>;
}

/** Authenticated shell: fixed dark sidebar on desktop, slide-over on mobile. */
function ConsoleLayout() {
  const [open, setOpen] = useState(false);
  return (
    <RequireSession>
      <ConsoleI18n>
      <div className="min-h-full lg:ps-64">
        <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 lg:block">
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
            <div className="absolute inset-y-0 start-0 w-72">
              <Sidebar onNavigate={() => setOpen(false)} />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="chrome absolute top-3 -end-11 bg-chrome p-2 text-white"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        )}
        <div className="hidden justify-end border-b border-zinc-200 bg-snow/80 px-8 py-2.5 backdrop-blur lg:flex">
          <HeaderControls />
        </div>
        <main className="px-4 py-6 sm:px-8 sm:py-8">
          <div className="mb-4 flex justify-end lg:hidden">
            <HeaderControls />
          </div>
          <div className="mx-auto max-w-[1280px]">
            <Outlet />
          </div>
        </main>
      </div>
      </ConsoleI18n>
    </RequireSession>
  );
}

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'console',
  component: ConsoleLayout,
});

const settingsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/settings',
  component: SettingsPage,
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
    settingsRoute,
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

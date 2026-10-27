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
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  ScrollText,
  Tags,
  UserCog,
  X,
  type LucideIcon,
  SlidersHorizontal,
} from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
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
import { applyColorMode, cx, LanguageMenu, MenuButton, ThemeToggle, useSidebarCollapsed } from '@grids/ui';
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

function Sidebar({ onNavigate, compact }: { onNavigate?: () => void; compact?: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { me } = useSession();
  const t = useT();
  const groups = useNav();
  const name = me.displayName ?? me.email ?? '?';
  return (
    <div className="chrome flex h-full flex-col bg-chrome px-3 text-zinc-300">
      <div className={cx('flex h-16 items-center px-2', compact && 'justify-center px-0')}>
        <Logo dark compact={compact} />
      </div>
      <nav className="-mx-3 flex-1 overflow-y-auto px-3 py-2" aria-label={t('console.nav.platform')}>
        {groups.map((group) => (
          <div key={group.section} className="mb-4">
            {compact ? (
              <div className="mx-2 mb-2 border-t border-white/10" />
            ) : (
              <div className="px-3 pb-1.5 font-mono text-[10px] tracking-[0.12em] text-zinc-500 uppercase">
                {t(group.section)}
              </div>
            )}
            {group.items.map((item) => {
              const active = item.match(path);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  title={compact ? t(item.label) : undefined}
                  aria-label={compact ? t(item.label) : undefined}
                  className={cx(
                    'relative mb-0.5 flex h-9 items-center gap-3 px-3 text-sm transition-colors before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:bg-transparent',
                    compact && 'justify-center px-0',
                    active
                      ? 'bg-white/[0.09] text-white before:bg-accent-500 [&>svg]:text-accent-500'
                      : 'hover:bg-white/[0.05] hover:text-white',
                  )}
                >
                  <item.icon className="size-[17px] shrink-0" strokeWidth={1.75} />
                  {!compact && <span className="flex-1">{t(item.label)}</span>}
                  {!!item.badge &&
                    (compact ? (
                      <span className="absolute end-2 top-1.5 size-2 rounded-full bg-accent-500" />
                    ) : (
                      <span className="num min-w-5 rounded-full bg-accent-600 px-1.5 text-center text-[11px] font-medium text-on-accent">
                        {item.badge}
                      </span>
                    ))}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="-mx-3 border-t border-white/10 px-3 py-3">
        <div className="mb-2 flex flex-col text-xs text-zinc-500">
          <a
            href={accountUrl()}
            title={t('console.shell.account')}
            aria-label={t('console.shell.account')}
            className={cx('flex h-8 items-center gap-2 px-2 hover:bg-white/[0.05] hover:text-white', compact && 'justify-center px-0')}
          >
            <UserCog className="size-3.5" /> {!compact && t('console.shell.account')}
          </a>
        </div>
        <div className={cx('flex items-center gap-2.5 px-1', compact && 'flex-col gap-2 px-0')}>
          <span title={compact ? name : undefined} className="flex size-8 shrink-0 items-center justify-center bg-accent-600 text-xs font-semibold text-on-accent">
            {initials(name)}
          </span>
          <div className={cx('min-w-0 flex-1 leading-tight', compact && 'hidden')}>
            <div className="truncate text-[13px] font-medium text-white">{name}</div>
            <div className="truncate text-[11.5px] text-zinc-500">{me.email}</div>
          </div>
          <button
            type="button"
            onClick={() => userManager.signoutRedirect()}
            title={t('console.shell.signOut')}
            aria-label={t('console.shell.signOut')}
            className="flex size-8 shrink-0 items-center justify-center hover:bg-white/[0.05] hover:text-white"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/**
 * Language and appearance, top right on every console page: the same controls as the
 * sign-in page and the organisation workspace; saved as the person's preferences.
 */
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
  const langs = LOCALES.filter((l) =>
    (platform.data?.localization.consoleLanguages ?? ['en']).includes(l.code),
  );
  const mode = save.variables?.colorMode ?? me.preferences.colorMode;
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <LanguageMenu
        value={locale}
        onChange={(code) => save.mutate({ locale: code })}
        label={t('console.shell.language')}
        draftLabel={t('common.draftTranslation')}
        options={langs.map((l) => ({ code: l.code, label: l.nativeName, draft: l.status === 'draft' }))}
      />
      <ThemeToggle
        mode={mode}
        onChange={(m) => {
          applyColorMode(m);
          save.mutate({ colorMode: m });
        }}
        labels={{ toLight: t('web.shell.lightMode'), toDark: t('web.shell.darkMode') }}
      />
    </div>
  );
}

/** Where you are: the platform, then the section (and the organisation, when on one). */
function Breadcrumbs() {
  const t = useT();
  const platform = usePlatform();
  const groups = useNav();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const item = groups.flatMap((g) => g.items).find((i) => i.match(path));
  const tenantId = path.match(/^\/tenants\/([0-9a-f-]{36})/)?.[1];
  const tenant = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => api.tenant(tenantId!),
    enabled: !!tenantId,
  });
  const crumbs: { label: string; to?: NavItem['to'] }[] = [];
  if (item) crumbs.push({ label: t(item.label), to: item.to });
  if (tenantId) crumbs.push({ label: tenant.data?.name ?? '…' });
  else if (path === '/tenants/new') crumbs.push({ label: t('console.nav.organisations') });
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-zinc-500">
      <Link to="/" className="truncate hover:text-ink">
        {platform.data?.branding?.appName ?? 'Grids'}
      </Link>
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" />
          {c.to && i < crumbs.length - 1 ? (
            <Link to={c.to} className="truncate hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-ink" aria-current="page">
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

/** Wraps the signed-in console in the person's language and the platform's look. */
function ConsoleI18n({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  usePlatformBranding();
  return <I18nProvider preferred={me.preferences.locale}>{children}</I18nProvider>;
}

/** Authenticated shell, laid out like the organisation workspace: sidebar on the canvas, the page as one raised sheet. */
function ConsoleLayout() {
  const [open, setOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  return (
    <RequireSession>
      <ConsoleI18n>
        <div className={cx('min-h-full bg-canvas', collapsed ? 'lg:ps-16' : 'lg:ps-64')}>
          <aside className={cx('fixed inset-y-0 start-0 z-30 hidden lg:block', collapsed ? 'w-16' : 'w-64')}>
            <Sidebar compact={collapsed} />
          </aside>
          {open && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
              <div className="absolute inset-y-0 start-0 w-72 shadow-raised">
                <Sidebar onNavigate={() => setOpen(false)} />
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="absolute top-3 -end-11 bg-snow p-2 text-ink shadow-surface"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>
          )}
          <div className="lg:py-3 lg:pe-3">
            <div className="flex min-h-screen flex-col bg-snow lg:min-h-[calc(100vh-1.5rem)] lg:border lg:border-zinc-200 lg:shadow-surface">
              <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-snow/90 px-4 backdrop-blur sm:px-8">
                <MenuButton label="Menu" onToggle={toggleCollapsed} onOpenDrawer={() => setOpen(true)} />
                <Breadcrumbs />
                <HeaderControls className="ms-auto" />
              </header>
              <main className={cx('flex-1 px-4 py-6 sm:py-8', collapsed ? 'sm:px-6' : 'sm:px-8')}>
                <div className={cx('mx-auto', collapsed ? 'max-w-[1800px]' : 'max-w-[1200px]')}>
                  <Outlet />
                </div>
              </main>
            </div>
          </div>
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

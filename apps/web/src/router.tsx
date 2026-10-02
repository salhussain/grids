import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import {
  Activity,
  ArrowLeftRight,
  CreditCard,
  FolderKanban,
  Globe,
  Languages,
  Settings2,
  UserCog,
  Home,
  KeyRound,
  LifeBuoy,
  LogOut,
  Menu,
  Network,
  Palette,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorkspacePermission } from '@grids/schema';
import { ErrorNotice, cx } from '@grids/ui';
import { api } from './api';
import { accountUrl, completeSignIn, userManager } from './auth';
import { I18nProvider, useT, workspaceLocale } from './i18n';
import { AccessPage } from './pages/AccessPage';
import { BillingPage, InvoicePage } from './pages/BillingPage';
import { DashboardsTab } from './pages/projects/DashboardsTab';
import { DataTab } from './pages/projects/DataTab';
import { EntitiesTab } from './pages/projects/EntitiesTab';
import { EntityPage } from './pages/projects/EntityPage';
import { FormBuilder } from './pages/projects/FormBuilder';
import { FormFillPage, FormsTab } from './pages/projects/FormsTab';
import { JobsTab } from './pages/projects/JobsTab';
import { OverlaysTab } from './pages/projects/OverlaysTab';
import { ProjectLayout } from './pages/projects/ProjectLayout';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { PublicProjectPage } from './pages/projects/PublicProjectPage';
import { SettingsTab } from './pages/projects/SettingsTab';
import { LanguagesPage } from './pages/LanguagesPage';
import { PreferencesDialog } from './prefs';
import { ActivityPage } from './pages/ActivityPage';
import { BrandingPage } from './pages/BrandingPage';
import { DomainsPage } from './pages/DomainsPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { OrgPickerPage } from './pages/OrgPickerPage';
import { PeoplePage } from './pages/PeoplePage';
import { SecurityPage } from './pages/SecurityPage';
import { StructurePage } from './pages/StructurePage';
import { SupportPage, TicketPage } from './pages/SupportPage';
import {
  FullPageSpinner,
  RequireAuth,
  WorkspaceProvider,
  useCan,
  useMe,
  useWorkspace,
} from './session';
import { applyTheme, resetTheme } from './theme';

const rootRoute = createRootRoute({ component: Outlet });

type Section =
  | 'projects'
  | 'people'
  | 'structure'
  | 'access'
  | 'branding'
  | 'security'
  | 'domains'
  | 'languages'
  | 'billing'
  | 'support'
  | 'activity';
interface NavItem {
  to: '' | Section;
  /** Key under web.nav */
  label: string;
  icon: LucideIcon;
  permission?: WorkspacePermission;
  anywhere?: boolean;
}
/** Sections and labels are translation keys under web.nav. */
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'workspace',
    items: [
      { to: '', label: 'home', icon: Home },
      { to: 'projects', label: 'projects', icon: FolderKanban },
      { to: 'people', label: 'people', icon: Users, permission: 'people.view', anywhere: true },
      { to: 'structure', label: 'structure', icon: Network },
      { to: 'access', label: 'access', icon: KeyRound, permission: 'roles.view' },
    ],
  },
  {
    section: 'settings',
    items: [
      { to: 'branding', label: 'branding', icon: Palette, permission: 'branding.manage' },
      { to: 'languages', label: 'languages', icon: Languages, permission: 'languages.manage' },
      { to: 'security', label: 'security', icon: ShieldCheck, permission: 'security.manage' },
      { to: 'domains', label: 'domains', icon: Globe, permission: 'domains.manage' },
      { to: 'billing', label: 'billing', icon: CreditCard, permission: 'billing.view' },
    ],
  },
  {
    section: 'help',
    items: [
      { to: 'support', label: 'support', icon: LifeBuoy, permission: 'support.view' },
      { to: 'activity', label: 'activity', icon: Activity, permission: 'audit.view' },
    ],
  },
];

export function BrandMark({ className = 'size-8' }: { className?: string }) {
  const ws = useWorkspace();
  if (ws.theme.logo)
    return <img src={ws.theme.logo} alt="" className={cx(className, 'object-contain')} />;
  return (
    <span
      className={cx(
        className,
        'flex shrink-0 items-center justify-center bg-accent-600 text-sm font-semibold text-on-accent',
      )}
    >
      {(ws.theme.appName || ws.tenant.name).slice(0, 1).toUpperCase()}
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const can = useCan();
  const t = useT();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = `/o/${ws.tenant.id}`;
  const variant = ws.theme.sidebar;
  const tone = {
    dark: {
      root: 'chrome bg-chrome text-zinc-300',
      muted: 'text-zinc-500',
      active: 'border-accent-500 bg-white/[0.08] text-white',
      hover: 'hover:bg-white/[0.04] hover:text-white',
      rule: 'border-white/10',
      title: 'text-white',
    },
    light: {
      root: 'bg-snow text-zinc-700 border-r border-zinc-200',
      muted: 'text-zinc-400',
      active: 'border-accent-600 bg-accent-50 text-accent-800',
      hover: 'hover:bg-zinc-100',
      rule: 'border-zinc-200',
      title: 'text-ink',
    },
    brand: {
      root: 'bg-accent-700 text-on-accent',
      muted: 'opacity-60',
      active: 'border-on-accent bg-black/20',
      hover: 'hover:bg-black/10',
      rule: 'border-black/15',
      title: 'text-on-accent',
    },
  }[variant];

  return (
    <div className={cx('flex h-full flex-col', tone.root)}>
      <div className={cx('flex h-14 items-center gap-3 border-b px-5', tone.rule)}>
        <BrandMark />
        <div className="min-w-0 leading-tight">
          <div className={cx('truncate text-sm font-semibold', tone.title)}>
            {ws.theme.appName || ws.tenant.name}
          </div>
          <div className={cx('truncate text-[11px]', tone.muted)}>
            {ws.theme.appName ? ws.tenant.name : t('web.nav.workspace')}
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-4" aria-label={t('web.nav.workspace')}>
        {NAV.map((group) => {
          const items = group.items.filter(
            (i) => !i.permission || can(i.permission, { anywhere: i.anywhere }),
          );
          if (!items.length) return null;
          return (
            <div key={group.section} className="mb-5">
              <div
                className={cx(
                  'px-5 pb-2 text-[10px] font-semibold tracking-[0.16em] uppercase',
                  tone.muted,
                )}
              >
                {t(`web.nav.${group.section}`)}
              </div>
              {items.map((item) => {
                const href = item.to ? `${base}/${item.to}` : base;
                const active = item.to
                  ? path.startsWith(href) || (item.to === 'projects' && path.startsWith(`${base}/p/`))
                  : path === base || path === `${base}/`;
                return (
                  <Link
                    key={item.to}
                    to={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex items-center gap-3 border-s-[3px] px-5 py-2 text-sm transition-colors',
                      active ? tone.active : cx('border-transparent', tone.hover),
                    )}
                  >
                    <item.icon className="size-[18px] shrink-0" strokeWidth={1.75} />
                    {t(`web.nav.${item.label}`)}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className={cx('border-t px-5 py-4', tone.rule)}>
        {me.memberships.length > 1 && (
          <Link
            to="/"
            className={cx('mb-3 flex items-center gap-2 text-xs', tone.muted, tone.hover)}
          >
            <ArrowLeftRight className="size-3.5" /> {t('web.shell.switchOrg')}
          </Link>
        )}
        <div className={cx('mb-3 flex flex-col gap-1.5 text-xs', tone.muted)}>
          <button
            type="button"
            onClick={() => setPrefsOpen(true)}
            className={cx('flex items-center gap-2 text-start', tone.hover)}
          >
            <Settings2 className="size-3.5" /> {t('web.shell.preferences')}
          </button>
          <a href={accountUrl()} className={cx('flex items-center gap-2', tone.hover)}>
            <UserCog className="size-3.5" /> {t('web.shell.account')}
          </a>
        </div>
        <PreferencesDialog
          open={prefsOpen}
          onClose={() => setPrefsOpen(false)}
          me={me}
          localization={ws.localization}
        />
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className={cx('truncate text-sm', tone.title)}>{me.displayName ?? me.email}</div>
            <div className={cx('truncate text-xs', tone.muted)}>
              {ws.me.role === 'org_admin' ? t('web.shell.orgAdmin') : t('web.shell.member')}
            </div>
          </div>
          <button
            onClick={() => userManager.signoutRedirect()}
            title={t('web.shell.signOut')}
            aria-label={t('web.shell.signOut')}
            className={cx('p-1.5', tone.hover)}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Loads the workspace context, applies the tenant theme and renders the shell. */
function WorkspaceLayout() {
  return (
    <RequireAuth>
      <WorkspaceShell />
    </RequireAuth>
  );
}

function WorkspaceShell() {
  const { tenantId } = workspaceRoute.useParams();
  const t = useT();
  const ws = useQuery({
    queryKey: ['workspace', tenantId],
    queryFn: () => api.workspace(tenantId),
  });
  const [open, setOpen] = useState(false);
  const bare = useRouterState({ select: (st) => /^\/o\/[^/]+\/p\/[^/]+\/?$/.test(st.location.pathname) });
  useEffect(() => {
    if (ws.data) {
      applyTheme(ws.data.theme);
      document.title = ws.data.theme.appName || `${ws.data.tenant.name} · Grids`;
    }
    return () => resetTheme();
  }, [ws.data]);

  if (ws.isPending) return <FullPageSpinner />;
  if (ws.isError)
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorNotice error={ws.error} />
        <Link to="/" className="mt-4 inline-block text-sm text-accent-700 hover:underline">
          ← {t('web.shell.yourOrgs')}
        </Link>
      </div>
    );

  // A project's explorer is full-screen, without the workspace chrome.
  if (bare)
    return (
      <WorkspaceProvider value={ws.data}>
        <WorkspaceI18n>
          <Outlet />
        </WorkspaceI18n>
      </WorkspaceProvider>
    );
  return (
    <WorkspaceProvider value={ws.data}>
      <WorkspaceI18n>
      <div className="min-h-full lg:ps-64">
        <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 lg:block">
          <Sidebar />
        </aside>
        <header className="sticky top-0 z-20 chrome flex h-14 items-center justify-between bg-chrome px-4 text-white lg:hidden">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span className="text-sm font-semibold">
              {ws.data.theme.appName || ws.data.tenant.name}
            </span>
          </div>
          <button onClick={() => setOpen(true)} aria-label={t('web.shell.openMenu')} className="p-2">
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
                aria-label={t('web.shell.closeMenu')}
                className="chrome absolute top-3 -end-11 bg-chrome p-2 text-white"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        )}
        <main className="px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>
      </WorkspaceI18n>
    </WorkspaceProvider>
  );
}

/** The workspace in the person's language, with the organisation's wording overrides. */
function WorkspaceI18n({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace();
  const me = useMe();
  const locale = workspaceLocale(me.preferences.locale, ws.localization);
  return (
    <I18nProvider locale={locale} overrides={ws.localization.overrides[locale]}>
      {children}
    </I18nProvider>
  );
}

function PickerRoute() {
  return (
    <RequireAuth>
      <OrgPickerPage />
    </RequireAuth>
  );
}

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

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/o/$tenantId',
  component: WorkspaceLayout,
});
const ws = () => workspaceRoute;
export const ticketRoute = createRoute({
  getParentRoute: ws,
  path: '/support/$ticketId',
  component: TicketPage,
});
export const projectRoute = createRoute({
  getParentRoute: ws,
  path: '/p/$project',
  component: ProjectLayout,
});
const pr = () => projectRoute;
const projectTree = projectRoute.addChildren([
  createRoute({ getParentRoute: pr, path: '/', component: () => null }),
  createRoute({ getParentRoute: pr, path: '/dashboards', component: DashboardsTab }),
  createRoute({ getParentRoute: pr, path: '/overlays', component: OverlaysTab }),
  createRoute({ getParentRoute: pr, path: '/entities', component: EntitiesTab }),
  createRoute({ getParentRoute: pr, path: '/entities/$entityId', component: EntityPage }),
  createRoute({ getParentRoute: pr, path: '/data', component: DataTab }),
  createRoute({ getParentRoute: pr, path: '/forms', component: FormsTab }),
  createRoute({ getParentRoute: pr, path: '/forms/$formKey/edit', component: FormBuilder }),
  createRoute({
    getParentRoute: pr,
    path: '/forms/$formKey/fill',
    component: FormFillPage,
    validateSearch: (s: Record<string, unknown>) => ({ entity: typeof s.entity === 'string' ? s.entity : undefined }),
  }),
  createRoute({ getParentRoute: pr, path: '/jobs', component: JobsTab }),
  createRoute({ getParentRoute: pr, path: '/settings', component: SettingsTab }),
]);

export const invoiceRoute = createRoute({
  getParentRoute: ws,
  path: '/billing/invoices/$invoiceId',
  component: InvoicePage,
});
export const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: InvitePage,
});

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: PickerRoute }),
  workspaceRoute.addChildren([
    createRoute({ getParentRoute: ws, path: '/', component: HomePage }),
    createRoute({ getParentRoute: ws, path: '/projects', component: ProjectsPage }),
    projectTree,
    createRoute({ getParentRoute: ws, path: '/people', component: PeoplePage }),
    createRoute({ getParentRoute: ws, path: '/structure', component: StructurePage }),
    createRoute({ getParentRoute: ws, path: '/access', component: AccessPage }),
    createRoute({ getParentRoute: ws, path: '/branding', component: BrandingPage }),
    createRoute({ getParentRoute: ws, path: '/security', component: SecurityPage }),
    createRoute({ getParentRoute: ws, path: '/domains', component: DomainsPage }),
    createRoute({ getParentRoute: ws, path: '/languages', component: LanguagesPage }),
    createRoute({ getParentRoute: ws, path: '/billing', component: BillingPage }),
    invoiceRoute,
    createRoute({ getParentRoute: ws, path: '/support', component: SupportPage }),
    ticketRoute,
    createRoute({ getParentRoute: ws, path: '/activity', component: ActivityPage }),
  ]),
  inviteRoute,
  createRoute({ getParentRoute: () => rootRoute, path: '/public/$tenant/$project', component: PublicProjectPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/auth/callback', component: CallbackPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => <Navigate to="/" /> }),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

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
  ChevronRight,
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
  Search,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
import { FormsHome } from './pages/forms/FormsHome';
import { FormsNav } from './pages/forms/FormsNav';
import { FillPage, InboxPage } from './pages/forms/InboxPage';
import { JobsTab } from './pages/projects/JobsTab';
import { OverlaysTab } from './pages/projects/OverlaysTab';
import { ProjectLayout } from './pages/projects/ProjectLayout';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { PublicProjectPage } from './pages/projects/PublicProjectPage';
import { SettingsTab } from './pages/projects/SettingsTab';
import { LanguagesPage } from './pages/LanguagesPage';
import { CommandPalette, usePaletteShortcut, type PaletteLink } from './palette';
import { PreferencesDialog, ThemeToggle } from './prefs';
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
  if (ws.theme.logo) return <img src={ws.theme.logo} alt="" className={cx(className, 'object-contain')} />;
  return (
    <span className={cx(className, 'flex shrink-0 items-center justify-center bg-accent-600 text-sm font-semibold text-on-accent')}>
      {(ws.theme.appName || ws.tenant.name).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The nav items this person can open, with their hrefs. */
function useNavGroups() {
  const ws = useWorkspace();
  const can = useCan();
  const base = `/o/${ws.tenant.id}`;
  return NAV.map((group) => ({
    section: group.section,
    items: group.items
      .filter((i) => !i.permission || can(i.permission, { anywhere: i.anywhere }))
      .map((i) => ({ ...i, href: i.to ? `${base}/${i.to}` : base })),
  })).filter((g) => g.items.length);
}

type Tone = { root: string; muted: string; active: string; hover: string; rule: string; title: string; field: string };
const TONES: Record<'dark' | 'light' | 'brand', Tone> = {
  // Light: the sidebar sits on the grey canvas; the current page is a raised white tile.
  light: {
    root: 'bg-canvas text-zinc-700',
    muted: 'text-zinc-500',
    active: 'bg-snow text-ink font-medium shadow-surface before:bg-accent-600 [&>svg]:text-accent-600',
    hover: 'hover:bg-zinc-200/60 hover:text-ink',
    rule: 'border-zinc-200',
    title: 'text-ink',
    field: 'border-zinc-300 bg-snow text-zinc-500 hover:border-zinc-400',
  },
  dark: {
    root: 'chrome bg-chrome text-zinc-300',
    muted: 'text-zinc-500',
    active: 'bg-white/[0.09] text-white before:bg-accent-500 [&>svg]:text-accent-500',
    hover: 'hover:bg-white/[0.05] hover:text-white',
    rule: 'border-white/10',
    title: 'text-white',
    field: 'border-white/15 bg-white/[0.04] text-zinc-400 hover:border-white/30',
  },
  brand: {
    root: 'bg-accent-700 text-on-accent',
    muted: 'opacity-70',
    active: 'bg-black/20 before:bg-on-accent',
    hover: 'hover:bg-black/10',
    rule: 'border-black/15',
    title: 'text-on-accent',
    field: 'border-black/20 bg-black/10 opacity-90 hover:bg-black/15',
  },
};

function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch(): void }) {
  const ws = useWorkspace();
  const me = useMe();
  const t = useT();
  const groups = useNavGroups();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = `/o/${ws.tenant.id}`;
  const tone = TONES[ws.theme.sidebar];
  const name = me.displayName ?? me.email ?? '';

  return (
    <div className={cx('flex h-full flex-col px-3', tone.root)}>
      <div className="flex h-16 items-center gap-3 px-2">
        <BrandMark />
        <div className="min-w-0 leading-tight">
          <div className={cx('line-clamp-2 text-sm font-semibold', tone.title)}>{ws.theme.appName || ws.tenant.name}</div>
          <div className={cx('truncate text-[11px]', tone.muted)}>{ws.theme.appName ? ws.tenant.name : t('web.nav.workspace')}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onSearch}
        className={cx('mb-2 flex h-9 items-center gap-2 border px-2.5 text-start text-sm transition-colors', tone.field)}
      >
        <Search className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t('web.shell.search')}</span>
        <kbd className="border border-current/25 px-1 font-mono text-[10px] opacity-80">⌘K</kbd>
      </button>
      <nav className="-mx-3 flex-1 overflow-y-auto px-3 py-2" aria-label={t('web.nav.workspace')}>
        {groups.map((group) => (
          <Fragment key={group.section}>
            <div className="mb-4">
              <div className={cx('px-3 pb-1.5 font-mono text-[10px] tracking-[0.12em] uppercase', tone.muted)}>
                {t(`web.nav.${group.section}`)}
              </div>
              {group.items.map((item) => {
                const active = item.to
                  ? path.startsWith(item.href) || (item.to === 'projects' && path.startsWith(`${base}/p/`))
                  : path === base || path === `${base}/`;
                return (
                  <Link
                    key={item.to}
                    to={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'relative mb-0.5 flex h-9 items-center gap-3 px-3 text-sm transition-colors before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:bg-transparent',
                      active ? tone.active : tone.hover,
                    )}
                  >
                    <item.icon className="size-[17px] shrink-0" strokeWidth={1.75} />
                    {t(`web.nav.${item.label}`)}
                  </Link>
                );
              })}
            </div>
            {group.section === 'workspace' && <FormsNav tone={tone} onNavigate={onNavigate} />}
          </Fragment>
        ))}
      </nav>
      <div className={cx('-mx-3 border-t px-3 py-3', tone.rule)}>
        {me.memberships.length > 1 && (
          <Link to="/" className={cx('mb-1 flex h-8 items-center gap-2 px-2 text-xs', tone.muted, tone.hover)}>
            <ArrowLeftRight className="size-3.5" /> {t('web.shell.switchOrg')}
          </Link>
        )}
        <div className={cx('mb-2 flex flex-col text-xs', tone.muted)}>
          <button type="button" onClick={() => setPrefsOpen(true)} className={cx('flex h-8 items-center gap-2 px-2 text-start', tone.hover)}>
            <Settings2 className="size-3.5" /> {t('web.shell.preferences')}
          </button>
          <a href={accountUrl()} className={cx('flex h-8 items-center gap-2 px-2', tone.hover)}>
            <UserCog className="size-3.5" /> {t('web.shell.account')}
          </a>
        </div>
        <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} me={me} localization={ws.localization} />
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex size-8 shrink-0 items-center justify-center bg-accent-600 text-xs font-semibold text-on-accent">
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className={cx('truncate text-[13px] font-medium', tone.title)}>{name}</div>
            <div className={cx('truncate text-[11.5px]', tone.muted)}>
              {ws.me.role === 'org_admin' ? t('web.shell.orgAdmin') : t('web.shell.member')}
            </div>
          </div>
          <ThemeToggle me={me} className={tone.hover} />
          <button
            type="button"
            onClick={() => userManager.signoutRedirect()}
            title={t('web.shell.signOut')}
            aria-label={t('web.shell.signOut')}
            className={cx('flex size-8 shrink-0 items-center justify-center', tone.hover)}
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

/** Where you are: organisation, then section (and project), inside the page sheet. */
function Breadcrumbs() {
  const ws = useWorkspace();
  const t = useT();
  const groups = useNavGroups();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = `/o/${ws.tenant.id}`;
  const projectKey = path.match(/^\/o\/[^/]+\/p\/([^/]+)/)?.[1];
  const project = useQuery({
    queryKey: ['project', ws.tenant.id, projectKey],
    queryFn: () => api.project(ws.tenant.id, projectKey!),
    enabled: !!projectKey,
  });
  const rest = path.slice(base.length).replace(/^\/|\/$/g, '');
  const section = rest.split('/')[0] ?? '';
  const crumbs: { label: string; href?: string }[] = [];
  if (projectKey) {
    crumbs.push({ label: t('web.nav.projects'), href: `${base}/projects` });
    crumbs.push({ label: project.data?.name ?? projectKey });
  } else if (section) {
    const item = groups.flatMap((g) => g.items).find((i) => i.to === section);
    crumbs.push({ label: item ? t(`web.nav.${item.label}`) : section[0]!.toUpperCase() + section.slice(1) });
  } else crumbs.push({ label: t('web.nav.home') });
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-zinc-500">
      <Link to={base} className="truncate hover:text-ink">
        {ws.theme.appName || ws.tenant.name}
      </Link>
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" />
          {c.href ? (
            <Link to={c.href} className="truncate hover:text-ink">
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
        <Shell open={open} setOpen={setOpen} />
      </WorkspaceI18n>
    </WorkspaceProvider>
  );
}

/** Sidebar on the canvas, the page as one raised sheet beside it, and ⌘K search. */
function Shell({ open, setOpen }: { open: boolean; setOpen(v: boolean): void }) {
  const t = useT();
  const groups = useNavGroups();
  const [search, setSearch] = useState(false);
  const openSearch = useCallback(() => {
    setOpen(false);
    setSearch(true);
  }, [setOpen]);
  usePaletteShortcut(openSearch);
  const links = useMemo<PaletteLink[]>(
    () => groups.flatMap((g) => g.items.map((i) => ({ label: t(`web.nav.${i.label}`), href: i.href, icon: i.icon }))),
    [groups, t],
  );
  return (
    <div className="min-h-full bg-canvas lg:ps-64">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 lg:block">
        <Sidebar onSearch={openSearch} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-72 shadow-raised">
            <Sidebar onNavigate={() => setOpen(false)} onSearch={openSearch} />
            <button
              onClick={() => setOpen(false)}
              aria-label={t('web.shell.closeMenu')}
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
            <button onClick={() => setOpen(true)} aria-label={t('web.shell.openMenu')} className="-ms-2 p-2 lg:hidden">
              <Menu className="size-5" />
            </button>
            <Breadcrumbs />
            <button
              type="button"
              onClick={openSearch}
              aria-label={t('web.shell.search')}
              title={t('web.shell.search')}
              className="ms-auto flex size-9 shrink-0 items-center justify-center text-zinc-600 hover:bg-zinc-100 hover:text-ink lg:hidden"
            >
              <Search className="size-[18px]" />
            </button>
          </header>
          <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
            <div className="mx-auto max-w-[1200px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <CommandPalette open={search} onClose={() => setSearch(false)} links={links} />
    </div>
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
    createRoute({
      getParentRoute: ws,
      path: '/forms',
      component: FormsHome,
      validateSearch: (s: Record<string, unknown>) => ({ group: typeof s.group === 'string' ? s.group : undefined }),
    }),
    createRoute({
      getParentRoute: ws,
      path: '/inbox',
      component: InboxPage,
      validateSearch: (s: Record<string, unknown>) => ({ tab: s.tab === 'mine' || s.tab === 'review' ? (s.tab as 'mine' | 'review') : undefined }),
    }),
    createRoute({
      getParentRoute: ws,
      path: '/fill/$project/$formKey',
      component: FillPage,
      validateSearch: (s: Record<string, unknown>) => ({
        resubmit: typeof s.resubmit === 'string' ? s.resubmit : undefined,
        entity: typeof s.entity === 'string' ? s.entity : undefined,
      }),
    }),
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

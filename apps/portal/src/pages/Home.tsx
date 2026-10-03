import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { User } from 'oidc-client-ts';
import { Empty, ErrorNotice, Input, Loading, cx } from '@grids/ui';
import { Globe, Lock, LogIn, LogOut, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { currentUser, signIn, signOut } from '../auth';
import { HeaderControls, useI18n } from '../prefs';

export function usePlatform() {
  return useQuery({ queryKey: ['platform'], queryFn: api.platform, staleTime: 60_000 });
}

/** Signed-in user, if any (never forces a sign-in). */
export function useOptionalUser() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    void currentUser().then(setUser);
  }, []);
  return user;
}

export function PortalHeader() {
  const platform = usePlatform();
  const user = useOptionalUser();
  const { t } = useI18n();
  const b = platform.data?.branding;
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-snow/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          {b?.logo ? (
            <img src={b.logo} alt="" className="size-8 object-contain" />
          ) : (
            <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
              <rect width="32" height="32" className="fill-accent-600" />
              <path d="M8 8h7v7H8zM17 8h7v7h-7zM8 17h7v7H8zM17 17h7v7h-7z" className="fill-on-accent" />
            </svg>
          )}
          <span className="font-semibold tracking-tight">{b?.appName ?? 'Grids'}</span>
        </Link>
        <div className="ms-auto flex items-center gap-3">
          <HeaderControls />
          {user === undefined ? null : user ? (
            <button type="button" onClick={() => void signOut()} className="inline-flex h-8 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-600" title={user.profile.email ?? undefined}>
              <LogOut className="size-4" /> <span className="hidden sm:inline">{t('web.shell.signOut')}</span>
            </button>
          ) : (
            <button type="button" onClick={() => void signIn({ returnTo: '/' })} className="inline-flex h-8 items-center gap-2 bg-accent-600 px-3 text-sm font-medium text-on-accent hover:bg-accent-700">
              <LogIn className="size-4" /> {t('auth.signIn.submit')}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** The portal: public projects for everyone; signing in adds the projects you can access. */
export function Home() {
  const platform = usePlatform();
  const user = useOptionalUser();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: api.publicCatalogue });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !!user });
  const mine = useQuery({
    queryKey: ['my-projects', me.data?.memberships.map((m) => m.tenantId)],
    enabled: !!me.data,
    queryFn: async () =>
      (
        await Promise.all(
          me.data!.memberships
            .filter((m) => m.status === 'active')
            .map(async (m) => (await api.projects(m.tenantId).catch(() => [])).filter((p) => p.status === 'live').map((p) => ({ tenantId: m.tenantId, tenantName: m.tenantName, p }))),
        )
      ).flat(),
  });
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const publicCards = useMemo(() => (catalogue.data ?? []).filter((c) => match(`${c.project.name} ${c.project.description} ${c.tenant.name}`)), [catalogue.data, q]);  
  const myCards = (mine.data ?? []).filter((m) => m.p.visibility !== 'public' && match(`${m.p.name} ${m.p.description} ${m.tenantName}`));
  const b = platform.data?.branding;

  return (
    <div className="min-h-full bg-canvas">
      <PortalHeader />
      <section className="border-b border-zinc-200 bg-snow">
        <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-8">
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{b?.welcomeMessage || t('auth.brand.headline')}</h1>
          <p className="mt-3 max-w-xl text-zinc-600">Explore open data on maps and dashboards. {user ? '' : 'Sign in to see the private projects you have access to.'}</p>
          <div className="relative mt-6 max-w-md">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input aria-label="Search projects" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 ps-9" />
          </div>
        </div>
      </section>
      <main className="mx-auto max-w-[1280px] space-y-10 px-4 py-10 sm:px-8">
        {user && (
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Lock className="size-4 text-zinc-500" /> Your projects
            </h2>
            {mine.isPending ? <Loading /> : myCards.length ? (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {myCards.map(({ tenantId, tenantName, p }) => (
                  <Card key={`${tenantId}/${p.key}`} to={`/o/${tenantId}/p/${p.key}`} name={p.name} description={p.description} org={tenantName} color={p.color} logo={p.logo} cover={p.coverImage} badge={p.visibility === 'organisation' ? 'Organisation' : 'Private'} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No private projects shared with you.</p>
            )}
          </section>
        )}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Globe className="size-4 text-zinc-500" /> Public projects
          </h2>
          <ErrorNotice error={catalogue.error} />
          {catalogue.isPending ? (
            <Loading />
          ) : publicCards.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {publicCards.map((c) => (
                <Card key={`${c.tenant.slug}/${c.project.key}`} to={`/p/${c.tenant.slug}/${c.project.key}`} name={c.project.name} description={c.project.description} org={c.tenant.name} color={c.project.color} logo={c.project.logo ?? c.tenant.logo} cover={c.project.coverImage} badge="Public" />
              ))}
            </ul>
          ) : (
            <div className="border border-zinc-200 bg-snow">
              <Empty icon={Users} title={q ? 'No matching projects' : 'No public projects yet'} />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Card({ to, name, description, org, color, logo, cover, badge }: { to: string; name: string; description: string; org: string; color: string; logo: string | null; cover: string | null; badge: string }) {
  return (
    <li>
      <Link to={to} className="group flex h-full flex-col overflow-hidden border border-zinc-200 bg-snow transition-shadow hover:shadow-lg">
        <div
          className="relative h-32 bg-cover bg-center"
          style={
            cover
              ? { backgroundImage: `url("${cover}")` }
              : { backgroundColor: `color-mix(in srgb, ${color} 10%, var(--color-snow))`, backgroundImage: `linear-gradient(color-mix(in srgb, ${color} 18%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${color} 18%, transparent) 1px, transparent 1px)`, backgroundSize: '16px 16px' }
          }
        >
          <span className={cx('absolute end-3 top-3 border bg-snow/90 px-1.5 py-0.5 text-[11px] font-medium', badge === 'Public' ? 'border-emerald-300 text-emerald-800' : 'border-zinc-300 text-zinc-700')}>{badge}</span>
          {logo ? <img src={logo} alt="" className="absolute start-4 -bottom-5 size-11 border border-zinc-200 bg-snow object-contain p-1" /> : <span className="absolute start-4 -bottom-5 size-11 border-2 border-snow" style={{ background: color }} />}
        </div>
        <div className="flex flex-1 flex-col p-4 pt-7">
          <div className="text-xs text-zinc-500">{org}</div>
          <h3 className="mt-0.5 font-semibold group-hover:text-accent-700">{name}</h3>
          {description && <p className="mt-1.5 line-clamp-2 text-sm text-zinc-600">{description}</p>}
        </div>
      </Link>
    </li>
  );
}

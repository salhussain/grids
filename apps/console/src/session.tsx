import { useQuery } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeDto, StaffPermission } from '@grids/schema';
import { applyColorMode, storedColorMode } from '@grids/ui';
import { api } from './api';
import { usePlatform, useT } from './i18n';
import { currentUser, signIn, userManager } from './auth';
import { Button, Spinner } from '@grids/ui';

const SessionCtx = createContext<{ user: User; me: MeDto } | null>(null);

export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession outside <RequireSession>');
  return s;
}

/** Console permission check for the signed-in staff member (UI gating; the API enforces). */
export function useCan() {
  const { me } = useSession();
  return (permission: StaffPermission) => me.permissions.includes(permission);
}

/** Renders children only when the user holds `permission`. */
export function Can({
  permission,
  children,
}: {
  permission: StaffPermission;
  children: ReactNode;
}) {
  return useCan()(permission) ? <>{children}</> : null;
}

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="border border-zinc-200 bg-snow px-6 py-16 text-center">
      <p className="text-sm font-semibold">You don’t have access to {what}</p>
      <p className="mt-1 text-sm text-zinc-500">
        Ask a staff administrator to grant the permission.
      </p>
    </div>
  );
}

/** Gate: signs the user in, loads /me, and requires platform-admin for the console. */
export function RequireSession({
  children,
  platformAdmin = true,
}: {
  children: ReactNode;
  platformAdmin?: boolean;
}) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    void currentUser().then(setUser);
    const onLoaded = (u: User) => setUser(u);
    userManager.events.addUserLoaded(onLoaded);
    return () => userManager.events.removeUserLoaded(onLoaded);
  }, []);
  useEffect(() => {
    if (user === null) void signIn();
  }, [user]);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !!user });
  const mode = me.data?.preferences.colorMode;
  useEffect(() => {
    if (mode && mode !== storedColorMode()) applyColorMode(mode);
  }, [mode]);
  useEffect(() => applyColorMode(storedColorMode()), []);

  if (!user || me.isPending) return <FullPageSpinner />;
  if (me.isError) {
    return (
      <Centered title="Couldn’t load your account">
        <p>{me.error.message}</p>
        <Button onClick={() => signIn({ forceLogin: true })}>Sign in again</Button>
      </Centered>
    );
  }
  if (platformAdmin && !me.data.isPlatformAdmin) {
    return (
      <Centered title="No platform access">
        <p>
          You’re signed in as <b className="text-ink">{me.data.email}</b>, which isn’t a platform
          administrator.
        </p>
        {me.data.memberships.length > 0 && (
          <p>
            Your organisations:{' '}
            {me.data.memberships
              .map((m) => `${m.tenantName} (${m.role.replace('_', ' ')})`)
              .join(', ')}
            . The organisation workspace arrives in the next milestone.
          </p>
        )}
        <Button variant="secondary" onClick={() => userManager.signoutRedirect()}>
          Sign out
        </Button>
      </Centered>
    );
  }
  return <SessionCtx.Provider value={{ user, me: me.data }}>{children}</SessionCtx.Provider>;
}

export function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function Centered({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="chrome flex min-h-full items-center justify-center bg-chrome p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border-t-4 border-accent-600 bg-snow p-8 text-sm text-zinc-600">
        <Logo />
        <h1 className="pt-2 text-xl font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Logo({ dark, subtitle }: { dark?: boolean; subtitle?: string }) {
  const platform = usePlatform();
  const t = useT();
  const b = platform.data?.branding;
  return (
    <div className="flex items-center gap-3">
      {b?.logo ? (
        <img
          src={b.logo}
          alt=""
          className="size-8 shrink-0 rounded-lg bg-white object-contain p-0.5"
        />
      ) : (
        <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
          <rect width="32" height="32" rx="9" className="fill-accent-600" />
          <path d="M8 8h7v7H8zM17 8h7v7h-7zM8 17h7v7H8z" fill="white" />
          <path d="M17 17h7v7h-7z" fill="white" fillOpacity=".45" />
        </svg>
      )}
      <div className="leading-tight">
        <div
          className={
            dark
              ? 'text-sm font-semibold tracking-[0.18em] text-white uppercase'
              : 'text-sm font-semibold tracking-[0.18em] text-ink uppercase'
          }
        >
          {b?.appName ?? 'Grids'}
        </div>
        <div className={dark ? 'text-[11px] text-zinc-400' : 'text-[11px] text-zinc-500'}>
          {subtitle ?? t('console.shell.subtitle')}
        </div>
      </div>
    </div>
  );
}

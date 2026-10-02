import { useQuery } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeDto, WorkspaceDto, WorkspacePermission } from '@grids/schema';
import { Spinner } from '@grids/ui';
import { api } from './api';
import { currentUser, signIn, userManager } from './auth';
import { I18nProvider, workspaceLocale } from './i18n';
import { useColorModePreference } from './prefs';

const MeCtx = createContext<MeDto | null>(null);
export const useMe = () => {
  const me = useContext(MeCtx);
  if (!me) throw new Error('useMe outside <RequireAuth>');
  return me;
};

/** Signs the user in and loads /me. */
export function RequireAuth({ children }: { children: ReactNode }) {
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
  useColorModePreference(me.data);
  if (!user || me.isPending) return <FullPageSpinner />;
  if (me.isError) return <p className="p-8 text-sm text-red-700">{me.error.message}</p>;
  // Outside a workspace (e.g. the organisation picker) any language is available.
  return (
    <MeCtx.Provider value={me.data}>
      <I18nProvider locale={workspaceLocale(me.data.preferences.locale)}>{children}</I18nProvider>
    </MeCtx.Provider>
  );
}

const WorkspaceCtx = createContext<WorkspaceDto | null>(null);
export const WorkspaceProvider = WorkspaceCtx.Provider;
export function useWorkspace() {
  const ws = useContext(WorkspaceCtx);
  if (!ws) throw new Error('useWorkspace outside a workspace');
  return ws;
}

/**
 * Workspace permission check. `anywhere` also accepts permissions held only
 * within org-unit subtrees (the API filters to those subtrees).
 */
export function useCan() {
  const ws = useWorkspace();
  return (permission: WorkspacePermission, opts: { anywhere?: boolean } = {}) =>
    ws.me.permissions.includes(permission) ||
    (!!opts.anywhere && ws.me.scoped.some((s) => s.permission === permission));
}

export function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="border border-zinc-200 bg-snow px-6 py-16 text-center">
      <p className="text-sm font-semibold">You don’t have access to {what}</p>
      <p className="mt-1 text-sm text-zinc-500">Ask your organisation administrator.</p>
    </div>
  );
}

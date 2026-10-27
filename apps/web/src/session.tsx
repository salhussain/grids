import { useQuery } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_SESSION_POLICY, type MeDto, type SessionPolicy, type WorkspaceDto, type WorkspacePermission } from '@grids/schema';
import { LogOut, ShieldCheck, Timer } from 'lucide-react';
import { Button, Dialog, Spinner } from '@grids/ui';
import { api } from './api';
import { ApiError } from '@grids/ui';
import { currentUser, endSession, signIn, signOut, userManager } from './auth';
import { I18nProvider, workspaceLocale } from './i18n';
import { useColorModePreference } from './prefs';

const MeCtx = createContext<MeDto | null>(null);
export const useMe = () => {
  const me = useContext(MeCtx);
  if (!me) throw new Error('useMe outside <RequireAuth>');
  return me;
};

const ACTIVITY_KEY = 'grids.lastActivity';

// The organisation's session settings, published by the workspace once it has loaded (the defaults outside one).
let published: SessionPolicy = DEFAULT_SESSION_POLICY;
const listeners = new Set<() => void>();
const publish = (p: SessionPolicy) => {
  if (p === published) return;
  published = p;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/**
 * Signs the person out after the organisation's idle timeout without activity in any tab (the last activity is shared
 * through localStorage), or once its longest session has run. The warning counts down before the idle sign-out; only
 * `stay` (not the mouse) keeps the session.
 */
function useIdleSignOut(active: boolean, authTime: number | undefined) {
  const policy = useSyncExternalStore(subscribe, () => published);
  const [left, setLeft] = useState<number | null>(null);
  const stayRef = useRef<() => void>(() => undefined);
  const { idleTimeoutMinutes, warningSeconds, maxSessionHours } = policy;
  useEffect(() => {
    if (!active) return;
    const idleMs = idleTimeoutMinutes * 60_000;
    const warningMs = Math.min(warningSeconds * 1000, idleMs / 2);
    const read = () => {
      try {
        return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
      } catch {
        return 0;
      }
    };
    let last = Date.now();
    let warning = false;
    const mark = () => {
      last = Date.now();
      try {
        localStorage.setItem(ACTIVITY_KEY, String(last));
      } catch {
        /* storage unavailable: this tab's own clock is used */
      }
    };
    const touch = () => {
      if (warning || Date.now() - last < 2000) return;
      mark();
    };
    stayRef.current = () => {
      warning = false;
      mark();
      setLeft(null);
    };
    mark();
    const events = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      const remaining = idleMs - (Date.now() - Math.max(last, read()));
      warning = remaining <= warningMs;
      setLeft(warning ? Math.max(0, Math.ceil(remaining / 1000)) : null);
      const tooLong = authTime !== undefined && Date.now() / 1000 - authTime >= maxSessionHours * 3600;
      if (remaining <= 0 || tooLong) signOut().catch((e) => console.warn('sign-out failed', e));
    }, 1_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [active, authTime, idleTimeoutMinutes, warningSeconds, maxSessionHours]);
  return { left, stay: () => stayRef.current() };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** "Are you still there?": shown shortly before the idle sign-out. */
function IdleWarning({ left, onStay }: { left: number; onStay(): void }) {
  // Opening the window moves focus to its first control (the × button); nothing should look pre-selected, so let go of it.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <Dialog
      open
      onClose={onStay}
      title="Session expiring"
      footer={
        <>
          <Button variant="ghost" icon={LogOut} onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button icon={ShieldCheck} onClick={onStay}>
            Stay signed in
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <Timer className="size-9 shrink-0 text-accent-600" aria-hidden />
        <div>
          <p className="text-sm text-zinc-700">You’ll be signed out due to inactivity in</p>
          <p className="text-3xl font-semibold tabular-nums" role="timer" aria-live="polite">
            {clock(left)}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

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
  const idle = useIdleSignOut(!!user, user?.profile.auth_time);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !!user });
  useColorModePreference(me.data);
  // The API refused the token (revoked or expired elsewhere): sign in again rather than show the error.
  const unauthorised = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthorised) void endSession();
  }, [unauthorised]);
  if (!user || me.isPending) return <FullPageSpinner />;
  if (unauthorised) return <FullPageSpinner />;
  if (me.isError) return <p className="p-8 text-sm text-red-700">{me.error.message}</p>;
  // Outside a workspace (e.g. the organisation picker) any language is available.
  return (
    <MeCtx.Provider value={me.data}>
      {idle.left !== null && <IdleWarning left={idle.left} onStay={idle.stay} />}
      <I18nProvider locale={workspaceLocale(me.data.preferences.locale)}>{children}</I18nProvider>
    </MeCtx.Provider>
  );
}

const WorkspaceCtx = createContext<WorkspaceDto | null>(null);
/** Provides the workspace, and applies its organisation's session settings while it is open. */
export function WorkspaceProvider({ value, children }: { value: WorkspaceDto; children: ReactNode }) {
  useEffect(() => {
    publish(value.sessionPolicy ?? DEFAULT_SESSION_POLICY);
    return () => publish(DEFAULT_SESSION_POLICY);
  }, [value.sessionPolicy]);
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
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

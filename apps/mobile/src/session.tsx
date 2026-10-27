import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadSession, signIn as doSignIn, signOut as doSignOut, type Session, type SignInOptions } from './auth';
import { wipeAccountData } from './db';
import { refreshCounts, syncAll } from './sync';

interface Ctx {
  session: Session | null;
  loading: boolean;
  signIn(opts?: SignInOptions): Promise<void>;
  /** Signs out. The submissions still waiting stay on the device and are sent when the same account signs in again. */
  signOut(): Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadSession().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async (opts?: SignInOptions) => {
    const s = await doSignIn(opts);
    if (s) {
      setSession(s);
      await refreshCounts();
      void syncAll(true);
    }
  }, []);

  const signOut = useCallback(async () => {
    await doSignOut();
    await wipeAccountData(true);
    setSession(null);
    await refreshCounts();
  }, []);

  const value = useMemo(() => ({ session, loading, signIn, signOut }), [session, loading, signIn, signOut]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('No session provider');
  return c;
};

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Empty } from '@grids/ui';
import { LogOut, Users } from 'lucide-react';
import { api } from '../api';
import { signOut } from '../auth';
import { useOptionalUser } from '../projects';
import { HeaderControls, useI18n } from '../prefs';

export function usePlatform() {
  return useQuery({ queryKey: ['platform'], queryFn: api.platform, staleTime: 60_000 });
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
          {user ? (
            <button type="button" onClick={() => void signOut()} className="inline-flex h-8 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-600" title={user.profile.email ?? undefined}>
              <LogOut className="size-4" /> <span className="hidden sm:inline">{t('web.shell.signOut')}</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Shown only when there is no project to open (none public, none shared with the visitor). */
export function NoProjects() {
  return (
    <div className="min-h-full bg-canvas">
      <PortalHeader />
      <main className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8">
        <div className="border border-zinc-200 bg-snow">
          <Empty icon={Users} title="No projects to show yet" />
        </div>
      </main>
    </div>
  );
}

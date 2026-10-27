import { LogOut } from 'lucide-react';
import { signOut } from './auth';
import { useI18n } from './prefs';
import { useOptionalUser } from './projects';

/** Sign out, for people who are signed in (nothing for anonymous visitors), in the viewer's header. */
export function AuthControl() {
  const user = useOptionalUser();
  const { t } = useI18n();
  if (!user) return null;
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      title={user.profile.email ?? undefined}
      aria-label={t('web.shell.signOut')}
      className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-600"
    >
      <LogOut className="size-4" /> <span className="hidden md:inline">{t('web.shell.signOut')}</span>
    </button>
  );
}

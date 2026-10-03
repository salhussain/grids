import { Navigate } from '@tanstack/react-router';
import { Building2, ChevronRight, LogOut } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Status } from '@grids/ui';
import { userManager } from '../auth';
import { useMe } from '../session';

/** Lists the user's organisations; jumps straight in when there's exactly one. */
export function OrgPickerPage() {
  const me = useMe();
  const active = me.memberships.filter((m) => m.status === 'active');
  if (active.length === 1)
    return <Navigate to="/o/$tenantId" params={{ tenantId: active[0]!.tenantId }} replace />;
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md border-t-4 border-accent-600 bg-snow">
        <div className="border-b border-zinc-200 px-6 py-5">
          <div className="text-xs font-semibold tracking-[0.18em] text-zinc-500">GRIDS</div>
          <h1 className="mt-1 text-xl font-semibold">Choose an organisation</h1>
          <p className="mt-1 text-sm text-zinc-500">Signed in as {me.email}</p>
        </div>
        {me.memberships.length ? (
          <ul className="divide-y divide-zinc-200">
            {me.memberships.map((m) => (
              <li key={m.tenantId}>
                {m.status === 'active' ? (
                  <Link
                    to="/o/$tenantId"
                    params={{ tenantId: m.tenantId }}
                    className="flex items-center gap-3 px-6 py-4 hover:bg-zinc-50"
                  >
                    <Building2 className="size-5 text-zinc-500" />
                    <div className="flex-1">
                      <div className="font-medium">{m.tenantName}</div>
                      <div className="text-xs text-zinc-500">
                        {m.role === 'org_admin' ? 'Organisation admin' : 'Member'}
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-zinc-400" />
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-6 py-4 text-zinc-500">
                    <Building2 className="size-5" />
                    <span className="flex-1">{m.tenantName}</span>
                    <Status value={m.status} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-6 py-8 text-sm text-zinc-600">
            You’re not a member of any organisation yet. Ask your administrator for an invitation.
          </p>
        )}
        <div className="border-t border-zinc-200 px-6 py-3">
          <button
            onClick={() => userManager.signoutRedirect()}
            className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-ink"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

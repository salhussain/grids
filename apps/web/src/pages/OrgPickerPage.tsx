import { Navigate } from '@tanstack/react-router';
import { ChevronRight, LogOut } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Status } from '@grids/ui';
import { userManager } from '../auth';
import { useMe } from '../session';
import { Avatar } from '../ui';

/** Lists the user's organisations; jumps straight in when there's exactly one. */
export function OrgPickerPage() {
  const me = useMe();
  const active = me.memberships.filter((m) => m.status === 'active');
  if (active.length === 1)
    return <Navigate to="/o/$tenantId" params={{ tenantId: active[0]!.tenantId }} replace />;
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-canvas p-4">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-lg">
        <div className="mb-6">
          <div className="font-mono text-[11px] tracking-[0.18em] text-zinc-500">GRIDS</div>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em]">Choose an organisation</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {me.email} belongs to {me.memberships.length} organisation{me.memberships.length === 1 ? '' : 's'}.
          </p>
        </div>
        {me.memberships.length ? (
          <ul className="grid gap-3">
            {me.memberships.map((m) => {
              const inner = (
                <>
                  <Avatar name={m.tenantName} className="size-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.tenantName}</div>
                    <div className="text-xs text-zinc-500">{m.role === 'org_admin' ? 'Organisation admin' : 'Member'}</div>
                  </div>
                </>
              );
              return (
                <li key={m.tenantId}>
                  {m.status === 'active' ? (
                    <Link
                      to="/o/$tenantId"
                      params={{ tenantId: m.tenantId }}
                      className="flex items-center gap-4 border border-zinc-200 bg-snow p-4 shadow-surface transition-colors hover:border-zinc-400"
                    >
                      {inner}
                      <ChevronRight className="size-4 text-zinc-400 rtl:rotate-180" />
                    </Link>
                  ) : (
                    <div className="flex items-center gap-4 border border-zinc-200 bg-snow p-4 opacity-70">
                      {inner}
                      <Status value={m.status} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border border-zinc-200 bg-snow p-6 text-sm text-zinc-600">
            You’re not a member of any organisation yet. Ask your administrator for an invitation.
          </p>
        )}
        <button
          onClick={() => userManager.signoutRedirect()}
          className="mt-6 inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-ink"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </div>
  );
}

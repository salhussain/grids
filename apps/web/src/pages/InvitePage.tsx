import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, ErrorNotice, Status } from '@grids/ui';
import { api } from '../api';
import { currentUser, signIn, userManager } from '../auth';
import { inviteRoute } from '../router';
import { FullPageSpinner } from '../session';

/** Invitee landing page: preview → sign in / register in the organisation's IdP org → accept → workspace. */
export function InvitePage() {
  const { token } = inviteRoute.useParams();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.previewInvite(token),
  });
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void currentUser().then((u) =>
      setEmail(u ? ((u.profile.email as string | undefined) ?? null) : null),
    );
  }, []);
  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: (me) => {
      const m = me.memberships.find((x) => x.tenantName === preview.data?.tenantName);
      void navigate({
        to: m ? '/o/$tenantId' : '/',
        params: m ? { tenantId: m.tenantId } : undefined,
        replace: true,
      } as never);
    },
  });

  if (preview.isPending || email === undefined) return <FullPageSpinner />;
  const card = (title: string, body: React.ReactNode) => (
    <div className="chrome flex min-h-full items-center justify-center bg-chrome p-4">
      <div className="w-full max-w-md space-y-4 border-t-4 border-accent-600 bg-snow p-8 text-sm text-zinc-600">
        <div className="text-xs font-semibold tracking-[0.18em] text-zinc-500">GRIDS</div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {body}
      </div>
    </div>
  );
  if (preview.isError)
    return card(
      'Invitation not found',
      <p>
        This link is invalid or was replaced by a newer invitation. Ask your administrator to resend
        it.
      </p>,
    );
  const inv = preview.data;
  const roleLabel = inv.role === 'org_admin' ? 'an administrator' : 'a member';

  return card(
    `Join ${inv.tenantName}`,
    <>
      <p>
        {inv.firstName ? `Hi ${inv.firstName}, you’ve` : 'You’ve'} been invited to join{' '}
        <b className="text-ink">{inv.tenantName}</b> as {roleLabel}.
      </p>
      <div className="flex items-center justify-between border border-zinc-200 bg-zinc-50 px-3 py-2">
        <span className="font-mono text-xs">{inv.email}</span>
        <Status value={inv.status} />
      </div>
      {inv.mfaRequired && (
        <p className="flex items-start gap-2 text-xs">
          <ShieldCheck className="size-4 shrink-0 text-accent-600" /> This organisation requires
          two-factor authentication. You’ll set it up when you sign in.
        </p>
      )}
      {inv.status !== 'pending' ? (
        <p>
          This invitation has{' '}
          {inv.status === 'accepted'
            ? 'already been used'
            : inv.status === 'revoked'
              ? 'been revoked'
              : 'expired'}
          .
        </p>
      ) : email ? (
        <>
          <p>
            Signed in as <b className="text-ink">{email}</b>.
          </p>
          <ErrorNotice error={accept.error} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => accept.mutate()} loading={accept.isPending}>
              Accept invitation
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await userManager.removeUser();
                await signIn({
                  returnTo: `/invite/${token}`,
                  orgId: inv.idpOrgId,
                  forceLogin: true,
                });
              }}
            >
              Use another account
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>
            Sign in, or create your account with <b className="text-ink">{inv.email}</b>, to accept.
          </p>
          <Button
            onClick={() =>
              signIn({
                returnTo: `/invite/${token}`,
                orgId: inv.idpOrgId,
                forceLogin: true,
                loginHint: inv.email,
              })
            }
          >
            Continue
          </Button>
        </>
      )}
    </>,
  );
}

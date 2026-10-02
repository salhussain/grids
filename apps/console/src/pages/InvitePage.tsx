import { useMutation, useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { currentUser, signIn, userManager } from '../auth';
import { inviteRoute } from '../router';
import { Centered, FullPageSpinner } from '../session';
import { Button, ErrorNotice, Status } from '@grids/ui';

/** Invitee landing page: preview → sign in / register in the tenant's IdP org → accept. */
export function InvitePage() {
  const { token } = inviteRoute.useParams();
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
  const accept = useMutation({ mutationFn: () => api.acceptInvite(token) });

  if (preview.isPending || email === undefined) return <FullPageSpinner />;
  if (preview.isError) {
    return (
      <Centered title="Invitation not found">
        <p>
          This link is invalid or has been replaced by a newer invitation. Ask your administrator to
          resend it.
        </p>
      </Centered>
    );
  }
  const inv = preview.data;
  const roleLabel = inv.role === 'org_admin' ? 'an administrator' : 'a member';

  if (accept.isSuccess) {
    return (
      <Centered title={`Welcome to ${inv.tenantName}`}>
        <p>
          You’re now {roleLabel} of <b className="text-ink">{inv.tenantName}</b>. The organisation
          workspace (users, projects, branding) opens in the next milestone.
        </p>
      </Centered>
    );
  }

  return (
    <Centered title={`Join ${inv.tenantName}`}>
      <p>
        {inv.firstName ? `Hi ${inv.firstName}, you’ve` : 'You’ve'} been invited to join{' '}
        <b className="text-ink">{inv.tenantName}</b> as {roleLabel}.
      </p>
      <div className="flex items-center justify-between border border-zinc-200 bg-zinc-50 px-3 py-2">
        <span className="font-mono text-xs">{inv.email}</span>
        <Status value={inv.status} />
      </div>
      {inv.mfaRequired && (
        <p className="flex items-start gap-2 text-xs text-zinc-600">
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
              signIn({ returnTo: `/invite/${token}`, orgId: inv.idpOrgId, forceLogin: true })
            }
          >
            Continue
          </Button>
        </>
      )}
    </Centered>
  );
}

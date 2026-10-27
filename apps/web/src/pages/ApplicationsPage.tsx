import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Check, Copy, KeyRound, Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { IconTile } from '../ui';
import type { CreatedOAuthClient, OAuthClientDto } from '@grids/schema';
import {
  confirmDialog,
  Button,
  CopyField,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Mono,
  PageHeader,
  Panel,
  Status,
  Table,
  Td,
  Textarea,
  VerticalTabs,
  relTime,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

/** Applications this organisation lets sign in through Grids (single sign-on for its own tools). */
export function ApplicationsPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const [tab, setTab] = useState<'apps' | 'connect'>('apps');
  const [editing, setEditing] = useState<OAuthClientDto | 'new' | null>(null);
  const [secret, setSecret] = useState<CreatedOAuthClient | null>(null);
  const allowed = can('security.manage');
  const clients = useQuery({
    queryKey: ['oauth-clients', id],
    queryFn: () => api.oauthClients(id),
    enabled: allowed,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['oauth-clients', id] });
  const remove = useMutation({
    mutationFn: (c: OAuthClientDto) => api.deleteOAuthClient(id, c.clientId),
    onSuccess: () => (refresh(), toast('Application removed')),
  });
  const toggle = useMutation({
    mutationFn: (c: OAuthClientDto) =>
      api.updateOAuthClient(id, c.clientId, { disabled: !c.disabled }),
    onSuccess: refresh,
  });
  const rotate = useMutation({
    mutationFn: (c: OAuthClientDto) => api.rotateOAuthSecret(id, c.clientId),
    onSuccess: (c) => setSecret(c),
  });
  if (!allowed) return <NoAccess what="applications" />;
  const issuer = clients.data?.issuer ?? '';
  const endpoints: [string, string][] = [
    ['Issuer', issuer],
    ['Discovery', `${issuer}/.well-known/openid-configuration`],
    ['Authorization', `${issuer}/auth`],
    ['Token', `${issuer}/token`],
    ['User info', `${issuer}/me`],
    ['Signing keys', `${issuer}/jwks`],
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.nav.applications')}
        meta={
          <span>
            Let your own tools sign people in with their {ws.tenant.name} account (OpenID Connect).
          </span>
        }
        actions={
          <Button icon={Plus} onClick={() => setEditing('new')}>
            Register application
          </Button>
        }
      />
      <VerticalTabs
        label="Applications"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'apps', label: 'Applications', icon: AppWindow },
          { id: 'connect', label: 'Connection details', icon: Plug },
        ]}
      >
        {tab === 'apps' && (
          <Panel
            flush
            title="Registered applications"
            description="Only people who belong to this organisation can sign in to them."
          >
            <div className="px-5 empty:hidden">
              <ErrorNotice error={clients.error ?? remove.error ?? toggle.error ?? rotate.error} />
            </div>
            {clients.isPending ? (
              <Loading />
            ) : (
              <Table
                head={['Application', 'Client ID', 'Redirect URLs', 'Status', 'Added', '']}
                empty={
                  <div className="flex flex-col items-center gap-2">
                    <AppWindow className="size-6 text-accent-600" />
                    <span className="font-medium text-zinc-900">No applications yet</span>
                    <span>
                      Register one to get a client ID, then use the connection details below.
                    </span>
                  </div>
                }
              >
                {clients.data?.clients.map((c) => (
                  <tr key={c.clientId}>
                    <Td>
                      <span className="flex items-center gap-3">
                        <IconTile icon={AppWindow} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="block text-xs text-zinc-500">
                            {c.confidential
                              ? 'Server app · client secret'
                              : 'Browser or mobile app · PKCE'}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <CopyCell value={c.clientId} label="client ID" />
                    </Td>
                    <Td>
                      <div className="space-y-0.5">
                        {c.redirectUris.map((u) => (
                          <Mono key={u} className="block max-w-xs truncate text-xs">
                            {u}
                          </Mono>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      <Status value={c.disabled ? 'disabled' : 'active'} />
                    </Td>
                    <Td className="whitespace-nowrap text-zinc-500">{relTime(c.createdAt)}</Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          onClick={() => setEditing(c)}
                        >
                          Edit
                        </Button>
                        {c.confidential && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={KeyRound}
                            loading={rotate.isPending}
                            onClick={async () =>
                              (await confirmDialog(
                                `Create a new secret for ${c.name}? The current one stops working immediately.`,
                              )) && rotate.mutate(c)
                            }
                          >
                            New secret
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => toggle.mutate(c)}>
                          {c.disabled ? 'Enable' : 'Disable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          onClick={async () =>
                            (await confirmDialog(
                              `Remove ${c.name}? People will no longer be able to sign in to it.`,
                            )) && remove.mutate(c)
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        )}
        {tab === 'connect' && (
          <Panel
            flush
            title="Connection details"
            description="Enter these in the application's single sign-on settings."
          >
            <Table head={['Setting', 'Address']}>
              {endpoints.map(([label, value]) => (
                <tr key={label}>
                  <Td className="w-40 font-medium">{label}</Td>
                  <Td>
                    <CopyCell value={value} label={label} />
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
              Use the authorization code flow with PKCE. Request the openid, email and profile
              scopes; the ID token carries the organisation as <Mono>org_id</Mono>.
            </p>
          </Panel>
        )}
      </VerticalTabs>
      {editing && (
        <ClientDialog
          tenantId={id}
          client={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            void refresh();
            if (created?.clientSecret) setSecret(created);
            else toast('Application saved');
          }}
        />
      )}
      <Dialog
        open={!!secret}
        onClose={() => (setSecret(null), void refresh())}
        title={secret?.name ?? ''}
        description="Copy the client secret now. It is only shown once."
        footer={<Button onClick={() => (setSecret(null), void refresh())}>Done</Button>}
      >
        {secret && (
          <div className="space-y-4">
            <Field label="Client ID">
              <CopyField value={secret.clientId} />
            </Field>
            {secret.clientSecret && (
              <Field
                label="Client secret"
                hint="Store it in the application's server settings. Anyone with it can act as the application."
              >
                <CopyField value={secret.clientSecret} />
              </Field>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

/** A value in monospace with an icon-only copy button, for table cells. */
function CopyCell({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <Mono className="min-w-0 break-all text-xs">{value}</Mono>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        title={copied ? 'Copied' : 'Copy'}
        disabled={!value}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex size-7 shrink-0 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      >
        {copied ? <Check className="size-4 text-green-700" /> : <Copy className="size-4" />}
      </button>
    </span>
  );
}

function ClientDialog({
  tenantId,
  client,
  onClose,
  onSaved,
}: {
  tenantId: string;
  client: OAuthClientDto | null;
  onClose(): void;
  onSaved(created?: CreatedOAuthClient): void;
}) {
  const [name, setName] = useState(client?.name ?? '');
  const [redirects, setRedirects] = useState(client?.redirectUris.join('\n') ?? '');
  const [logout, setLogout] = useState(client?.postLogoutRedirectUris.join('\n') ?? '');
  const [confidential, setConfidential] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      if (client) {
        await api.updateOAuthClient(tenantId, client.clientId, {
          name,
          redirectUris: lines(redirects),
          postLogoutRedirectUris: lines(logout),
        });
        return undefined;
      }
      return api.createOAuthClient(tenantId, {
        name,
        redirectUris: lines(redirects),
        postLogoutRedirectUris: lines(logout),
        confidential,
      });
    },
    onSuccess: onSaved,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={client ? `Edit ${client.name}` : 'Register application'}
      description="An application that signs people in with their organisation account."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || !lines(redirects).length}
          >
            {client ? 'Save' : 'Register'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <Field label="Name" hint="Shown to people on the sign-in page">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Staff intranet"
          />
        </Field>
        <Field
          label="Redirect URLs"
          hint="One per line. People return here after signing in. https only (http for localhost)."
        >
          <Textarea
            value={redirects}
            onChange={(e) => setRedirects(e.target.value)}
            rows={3}
            placeholder="https://intranet.example.org/auth/callback"
            className="font-mono text-xs"
          />
        </Field>
        <Field
          label="Sign-out redirect URLs (optional)"
          hint="One per line. Where people go after signing out."
        >
          <Textarea
            value={logout}
            onChange={(e) => setLogout(e.target.value)}
            rows={2}
            className="font-mono text-xs"
          />
        </Field>
        {!client && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--brand-600)]"
            />
            <span>
              <span className="font-medium">This application runs on a server</span>
              <span className="block text-xs text-zinc-500">
                It keeps a client secret. Leave off for single-page and mobile apps, which use PKCE
                alone.
              </span>
            </span>
          </label>
        )}
      </div>
    </Dialog>
  );
}

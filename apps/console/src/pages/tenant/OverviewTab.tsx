import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { UpdateTenantInput, type TenantDetail } from '@grids/schema';
import { api } from '../../api';
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  KeyValues,
  Mono,
  Panel,
  Tag,
  Textarea,
  useToast,
} from '@grids/ui';
import { countryName, dateTime } from '@grids/ui';
import { UsageMeter } from '../PlansPage';
import {
  AddressFields,
  BusinessFields,
  ContactFields,
  PreferenceFields,
  contactOrUndefined,
  emptyContact,
  issuesToErrors,
  type ContactForm,
  type Errors,
  type ProfileForm,
} from '../tenantForm';

export function OverviewTab({ t }: { t: TenantDetail }) {
  const a = t.address;
  const address = [
    a.line1,
    a.line2,
    [a.city, a.region, a.postalCode].filter(Boolean).join(' '),
    countryName(a.country),
  ].filter(Boolean);
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Panel title="Business profile">
          <KeyValues
            items={[
              ['Legal name', t.legalName],
              ['Industry', t.industry],
              ['Size', t.companySize ? `${t.companySize} people` : null],
              [
                'Website',
                t.website && (
                  <a
                    href={t.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-700 hover:underline"
                  >
                    {t.website.replace(/^https?:\/\//, '')}
                  </a>
                ),
              ],
              ['Registration no.', t.registrationNumber && <Mono>{t.registrationNumber}</Mono>],
              ['Tax ID', t.taxId && <Mono>{t.taxId}</Mono>],
              ['Email', t.email],
              ['Phone', t.phone],
              ['Time zone', t.timezone],
              ['Currency · language', `${t.currency} · ${t.locale}`],
            ]}
          />
        </Panel>
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title="Registered address">
            {address.length ? (
              <address className="text-sm leading-relaxed not-italic">
                {address.map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </address>
            ) : (
              <p className="text-sm text-zinc-500">No address on file.</p>
            )}
          </Panel>
          <Panel title="Contacts">
            <div className="space-y-4">
              {(['primary', 'billing', 'technical'] as const).map((k) => {
                const c = t.contacts[k];
                return (
                  <div key={k} className="text-sm">
                    <div className="mb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                      {k}
                    </div>
                    {c ? (
                      <>
                        <div className="font-medium">
                          {c.name}
                          {c.jobTitle && (
                            <span className="font-normal text-zinc-500"> · {c.jobTitle}</span>
                          )}
                        </div>
                        <div className="text-zinc-600">
                          {c.email}
                          {c.phone && ` · ${c.phone}`}
                        </div>
                      </>
                    ) : (
                      <div className="text-zinc-400">
                        {k === 'billing' ? 'Same as primary' : 'Not set'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
        {t.notes && (
          <Panel title="Internal notes">
            <p className="text-sm whitespace-pre-wrap text-zinc-700">{t.notes}</p>
          </Panel>
        )}
      </div>
      <div className="space-y-6">
        <Panel
          title="Plan usage"
          description={t.planName ? `${t.planName} plan limits` : 'No plan yet'}
        >
          <div className="space-y-4">
            {t.usage.map((u) => (
              <UsageMeter key={u.key} item={u} />
            ))}
          </div>
        </Panel>
        <Panel title="Placement & identity">
          <KeyValues
            items={[
              [
                'Tenant ID',
                <Mono key="id" className="text-xs">
                  {t.id.slice(0, 18)}…
                </Mono>,
              ],
              ['Data cell', <Tag key="c">{t.cellId} · shared</Tag>],
              [
                'IdP organisation',
                t.idpOrgId ? (
                  <Mono key="i" className="text-xs">
                    {t.idpOrgId}
                  </Mono>
                ) : (
                  'Not provisioned'
                ),
              ],
              ['2FA policy', t.mfaRequired ? 'Required' : 'Optional'],
              ['Created', dateTime(t.createdAt)],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

const toForm = (t: TenantDetail): ProfileForm => ({
  name: t.name,
  legalName: t.legalName ?? '',
  slug: t.slug,
  industry: t.industry ?? '',
  companySize: t.companySize ?? '',
  website: t.website ?? '',
  registrationNumber: t.registrationNumber ?? '',
  taxId: t.taxId ?? '',
  email: t.email ?? '',
  phone: t.phone ?? '',
  address: {
    line1: t.address.line1 ?? '',
    line2: t.address.line2 ?? '',
    city: t.address.city ?? '',
    region: t.address.region ?? '',
    postalCode: t.address.postalCode ?? '',
    country: t.address.country ?? '',
  },
  timezone: t.timezone,
  locale: t.locale,
  currency: t.currency as ProfileForm['currency'],
  notes: t.notes ?? '',
});
const toContact = (c: TenantDetail['contacts']['primary']): ContactForm =>
  c
    ? { name: c.name, email: c.email, phone: c.phone ?? '', jobTitle: c.jobTitle ?? '' }
    : emptyContact();

export function EditProfileDialog({
  t,
  open,
  onClose,
}: {
  t: TenantDetail;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(() => toForm(t));
  const [contacts, setContacts] = useState(() => ({
    primary: toContact(t.contacts.primary),
    billing: toContact(t.contacts.billing),
    technical: toContact(t.contacts.technical),
  }));
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof ProfileForm>(k: K, val: ProfileForm[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.updateTenant>[1]) => api.updateTenant(t.id, input),
    onSuccess: (res) => {
      qc.setQueryData(['tenant', t.id], res);
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      toast('Profile saved');
      onClose();
    },
  });

  function submit() {
    const { slug: _slug, ...profile } = v;
    const input = {
      ...profile,
      contacts: {
        primary: contacts.primary,
        billing: contactOrUndefined(contacts.billing) ?? null,
        technical: contactOrUndefined(contacts.technical) ?? null,
      },
    };
    const parsed = UpdateTenantInput.safeParse(input);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
    setErrors({});
    save.mutate(input);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Edit organisation"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <Section title="Business details">
          <BusinessFields v={v} set={set} errors={errors} />
        </Section>
        <Section title="Address">
          <AddressFields v={v.address} set={(a) => set('address', a)} errors={errors} />
        </Section>
        <Section title="Primary contact">
          <ContactFields
            v={contacts.primary}
            set={(c) => setContacts((x) => ({ ...x, primary: c }))}
            errors={errors}
            prefix="primary"
            required
          />
        </Section>
        <Section title="Billing contact (blank = same as primary)">
          <ContactFields
            v={contacts.billing}
            set={(c) => setContacts((x) => ({ ...x, billing: c }))}
            errors={errors}
            prefix="billing"
          />
        </Section>
        <Section title="Technical contact">
          <ContactFields
            v={contacts.technical}
            set={(c) => setContacts((x) => ({ ...x, technical: c }))}
            errors={errors}
            prefix="technical"
          />
        </Section>
        <Section title="Preferences">
          <PreferenceFields v={v} set={set} />
        </Section>
        <Field label="Internal notes">
          <Textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <ErrorNotice error={save.error} />
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 border-b border-zinc-200 pb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

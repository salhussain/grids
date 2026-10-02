import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CreateTenantInput } from '@grids/schema';
import { api } from '../api';
import {
  Button,
  Checkbox,
  ErrorNotice,
  Field,
  PageHeader,
  Panel,
  Textarea,
  cx,
  useToast,
} from '@grids/ui';
import {
  AddressFields,
  BusinessFields,
  ContactFields,
  PreferenceFields,
  contactOrUndefined,
  emptyContact,
  emptyProfile,
  issuesToErrors,
  type Errors,
} from './tenantForm';

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

const STEPS = [
  ['Create organisation', 'Business details, address and contacts.'],
  [
    'Set up subscription',
    'Choose a plan and monthly or yearly billing. Yearly plans are discounted.',
  ],
  [
    'Collect payment',
    'The first invoice is emailed to the billing contact. Recording payment provisions the workspace. Trials and free plans start immediately.',
  ],
  [
    'Invite administrators',
    'Once active, invite the organisation’s administrators. They manage their own users and 2FA.',
  ],
];

export function NewTenantPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [profile, setProfile] = useState(emptyProfile);
  const [primary, setPrimary] = useState(emptyContact);
  const [billing, setBilling] = useState(emptyContact);
  const [technical, setTechnical] = useState(emptyContact);
  const [billingSame, setBillingSame] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof typeof profile>(k: K, v: (typeof profile)[K]) =>
    setProfile((p) => ({ ...p, [k]: v }));

  const create = useMutation({
    mutationFn: api.createTenant,
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      toast(`${t.name} created`);
      void navigate({ to: '/tenants/$tenantId', params: { tenantId: t.id } });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = {
      ...profile,
      contacts: {
        primary,
        billing: billingSame ? undefined : contactOrUndefined(billing),
        technical: contactOrUndefined(technical),
      },
    };
    // Same Zod schema the API validates with.
    const parsed = CreateTenantInput.safeParse(input);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setErrors({});
    create.mutate(input);
  }

  return (
    <>
      <Link
        to="/tenants"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Organisations
      </Link>
      <PageHeader
        eyebrow="Step 1 of 4"
        title="New organisation"
        meta={
          <span>
            Capture the organisation’s business profile. The subscription and administrators come
            next.
          </span>
        }
      />

      <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1fr_320px]" noValidate>
        <div className="space-y-6">
          {Object.keys(errors).length > 0 && (
            <ErrorNotice
              error={
                new Error(
                  `Please fix ${Object.keys(errors).length} field${Object.keys(errors).length > 1 ? 's' : ''} below.`,
                )
              }
            />
          )}
          <Panel title="Business details">
            <BusinessFields
              v={profile}
              set={set}
              errors={errors}
              slugPreview={slugify(profile.legalName || profile.name)}
            />
          </Panel>
          <Panel title="Registered address">
            <AddressFields v={profile.address} set={(a) => set('address', a)} errors={errors} />
          </Panel>
          <Panel
            title="Primary contact"
            description="Main point of contact. Receives the welcome email when the workspace is ready."
          >
            <ContactFields v={primary} set={setPrimary} errors={errors} prefix="primary" required />
          </Panel>
          <Panel title="Billing contact" description="Receives invoices and payment receipts.">
            <Checkbox
              label="Same as primary contact"
              checked={billingSame}
              onChange={(e) => setBillingSame(e.target.checked)}
            />
            {!billingSame && (
              <div className="mt-4">
                <ContactFields
                  v={billing}
                  set={setBilling}
                  errors={errors}
                  prefix="billing"
                  required
                />
              </div>
            )}
          </Panel>
          <Panel
            title="Technical contact"
            description="Optional. For integrations, SSO and DNS (custom domains)."
          >
            <ContactFields v={technical} set={setTechnical} errors={errors} prefix="technical" />
          </Panel>
          <Panel title="Preferences">
            <PreferenceFields v={profile} set={set} />
          </Panel>
          <Panel title="Internal notes" description="Visible to platform staff only.">
            <Field label="Notes">
              <Textarea
                value={profile.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="How they found us, contract terms, special requirements…"
              />
            </Field>
          </Panel>
          <ErrorNotice error={create.error} />
          <div className="flex gap-2 border-t border-zinc-300 pt-5">
            <Button type="submit" loading={create.isPending}>
              Create organisation
            </Button>
            <Link
              to="/tenants"
              className="inline-flex h-9 items-center px-3.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200/60"
            >
              Cancel
            </Link>
          </div>
        </div>

        <aside className="xl:sticky xl:top-8 xl:self-start">
          <div className="border border-zinc-200 bg-snow">
            <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold">
              Onboarding
            </div>
            <ol className="p-5">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="flex gap-3 pb-5 last:pb-0">
                  <span
                    className={cx(
                      'flex size-6 shrink-0 items-center justify-center font-mono text-xs',
                      i === 0 ? 'bg-accent-600 text-white' : 'border border-zinc-300 text-zinc-500',
                    )}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <div
                      className={cx('text-sm font-medium', i === 0 ? 'text-ink' : 'text-zinc-600')}
                    >
                      {title}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </form>
    </>
  );
}

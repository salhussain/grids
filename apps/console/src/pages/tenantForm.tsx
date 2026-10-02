import { COMPANY_SIZES, CURRENCIES, INDUSTRIES, type Currency } from '@grids/schema';
import { Field, Input, Select } from '@grids/ui';
import { COUNTRIES, TIMEZONES } from '@grids/ui';

/** Editable organisation profile (shared by create and edit). */
export interface ProfileForm {
  name: string;
  legalName: string;
  slug: string;
  industry: string;
  companySize: string;
  website: string;
  registrationNumber: string;
  taxId: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
  timezone: string;
  locale: string;
  currency: Currency;
  notes: string;
}
export interface ContactForm {
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
}

export const emptyContact = (): ContactForm => ({ name: '', email: '', phone: '', jobTitle: '' });
export const emptyProfile = (): ProfileForm => ({
  name: '',
  legalName: '',
  slug: '',
  industry: '',
  companySize: '',
  website: '',
  registrationNumber: '',
  taxId: '',
  email: '',
  phone: '',
  address: { line1: '', line2: '', city: '', region: '', postalCode: '', country: '' },
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: 'en',
  currency: 'USD',
  notes: '',
});

export type Errors = Record<string, string>;
type Setter<T> = <K extends keyof T>(key: K, value: T[K]) => void;

export function BusinessFields({
  v,
  set,
  errors,
  slugPreview,
}: {
  v: ProfileForm;
  set: Setter<ProfileForm>;
  errors: Errors;
  slugPreview?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Display name"
        required
        error={errors.name}
        hint="How the organisation appears across Grids"
      >
        <Input
          value={v.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Pacific Health"
          autoFocus
        />
      </Field>
      <Field label="Registered legal name" error={errors.legalName}>
        <Input
          value={v.legalName}
          onChange={(e) => set('legalName', e.target.value)}
          placeholder="Pacific Health Network Ltd"
        />
      </Field>
      {slugPreview !== undefined && (
        <Field
          label="Workspace slug"
          error={errors.slug}
          hint={
            v.slug ? (
              <>
                Address: <span className="font-mono">{v.slug}.grids.app</span>
              </>
            ) : (
              <>
                Leave blank to generate{' '}
                <span className="font-mono">{slugPreview || 'from the name'}</span>
              </>
            )
          }
        >
          <Input
            value={v.slug}
            onChange={(e) => set('slug', e.target.value.toLowerCase())}
            placeholder={slugPreview || 'auto-generated'}
            className="font-mono"
          />
        </Field>
      )}
      <Field label="Industry" error={errors.industry}>
        <Select value={v.industry} onChange={(e) => set('industry', e.target.value)}>
          <option value="">Select…</option>
          {INDUSTRIES.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </Select>
      </Field>
      <Field label="Organisation size" error={errors.companySize}>
        <Select value={v.companySize} onChange={(e) => set('companySize', e.target.value)}>
          <option value="">Select…</option>
          {COMPANY_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} people
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Website" error={errors.website}>
        <Input
          type="url"
          value={v.website}
          onChange={(e) => set('website', e.target.value)}
          placeholder="https://example.org"
        />
      </Field>
      <Field label="Company / registration number" error={errors.registrationNumber}>
        <Input
          value={v.registrationNumber}
          onChange={(e) => set('registrationNumber', e.target.value)}
        />
      </Field>
      <Field label="Tax ID / VAT / GST number" error={errors.taxId}>
        <Input value={v.taxId} onChange={(e) => set('taxId', e.target.value)} />
      </Field>
      <Field label="General email" error={errors.email}>
        <Input
          type="email"
          value={v.email}
          onChange={(e) => set('email', e.target.value)}
          placeholder="info@example.org"
        />
      </Field>
      <Field label="Main phone" error={errors.phone}>
        <Input
          type="tel"
          value={v.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="+64 9 000 0000"
        />
      </Field>
    </div>
  );
}

export function AddressFields({
  v,
  set,
  errors,
}: {
  v: ProfileForm['address'];
  set: (a: ProfileForm['address']) => void;
  errors: Errors;
}) {
  const up = (k: keyof ProfileForm['address'], value: string) => set({ ...v, [k]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Address line 1" className="sm:col-span-2" error={errors['address.line1']}>
        <Input
          value={v.line1}
          onChange={(e) => up('line1', e.target.value)}
          placeholder="Street address"
        />
      </Field>
      <Field label="Address line 2" className="sm:col-span-2">
        <Input
          value={v.line2}
          onChange={(e) => up('line2', e.target.value)}
          placeholder="Suite, floor, building"
        />
      </Field>
      <Field label="City">
        <Input value={v.city} onChange={(e) => up('city', e.target.value)} />
      </Field>
      <Field label="State / region / province">
        <Input value={v.region} onChange={(e) => up('region', e.target.value)} />
      </Field>
      <Field label="Postal code">
        <Input value={v.postalCode} onChange={(e) => up('postalCode', e.target.value)} />
      </Field>
      <Field label="Country" error={errors['address.country']}>
        <Select value={v.country} onChange={(e) => up('country', e.target.value)}>
          <option value="">Select…</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function PreferenceFields({ v, set }: { v: ProfileForm; set: Setter<ProfileForm> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Time zone">
        <Select value={v.timezone} onChange={(e) => set('timezone', e.target.value)}>
          {TIMEZONES.map((tz) => (
            <option key={tz}>{tz}</option>
          ))}
        </Select>
      </Field>
      <Field label="Billing currency">
        <Select value={v.currency} onChange={(e) => set('currency', e.target.value as Currency)}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Language">
        <Select value={v.locale} onChange={(e) => set('locale', e.target.value)}>
          <option value="en">English</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
          <option value="pt">Portuguese</option>
        </Select>
      </Field>
    </div>
  );
}

export function ContactFields({
  v,
  set,
  errors,
  prefix,
  required,
}: {
  v: ContactForm;
  set: (c: ContactForm) => void;
  errors: Errors;
  prefix: string;
  required?: boolean;
}) {
  const up = (k: keyof ContactForm, value: string) => set({ ...v, [k]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" required={required} error={errors[`${prefix}.name`]}>
        <Input value={v.name} onChange={(e) => up('name', e.target.value)} />
      </Field>
      <Field label="Email" required={required} error={errors[`${prefix}.email`]}>
        <Input type="email" value={v.email} onChange={(e) => up('email', e.target.value)} />
      </Field>
      <Field label="Phone">
        <Input type="tel" value={v.phone} onChange={(e) => up('phone', e.target.value)} />
      </Field>
      <Field label="Job title">
        <Input value={v.jobTitle} onChange={(e) => up('jobTitle', e.target.value)} />
      </Field>
    </div>
  );
}

const blank = (c: ContactForm) => !c.name && !c.email && !c.phone && !c.jobTitle;
export const contactOrUndefined = (c: ContactForm) => (blank(c) ? undefined : c);

/** Maps Zod/API issue paths (e.g. contacts.primary.email) to form error keys. */
export function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  return Object.fromEntries(
    issues.map((i) => [
      i.path
        .map(String)
        .join('.')
        .replace(/^contacts\./, ''),
      i.message,
    ]),
  );
}

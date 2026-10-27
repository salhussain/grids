/** Marketing copy and pricing in one place, so the pages stay layout-only. */
export interface Plan {
  id: 'starter' | 'team' | 'enterprise';
  name: string;
  /** USD per month when billed monthly; null means "talk to us". */
  monthly: number | null;
  blurb: string;
  cta: string;
  popular?: boolean;
  highlights: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 49,
    blurb: 'For a small team running its first surveys.',
    cta: 'Start free trial',
    highlights: ['Up to 10 people', '5 projects', '2,000 submissions / month', '5 GB storage', 'Email support'],
  },
  {
    id: 'team',
    name: 'Team',
    monthly: 199,
    blurb: 'For departments collecting data across regions.',
    cta: 'Start free trial',
    popular: true,
    highlights: [
      'Up to 75 people',
      '40 projects',
      '25,000 submissions / month',
      '100 GB storage',
      'Custom domain and branding',
      'Org structure and scoped roles',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthly: null,
    blurb: 'For ministries and agencies with security and scale needs.',
    cta: 'Talk to sales',
    highlights: [
      'Unlimited people and projects',
      '500,000+ submissions / month',
      'Single sign-on and audit export',
      'Dedicated data schema',
      'Priority support with an SLA',
    ],
  },
];

export const ANNUAL_DISCOUNT = 0.2;
export const price = (p: Plan, annual: boolean) =>
  p.monthly === null ? null : Math.round(p.monthly * (annual ? 1 - ANNUAL_DISCOUNT : 1));

/** Rows of the comparison table: [label, starter, team, enterprise]; true/false render as ticks. */
export const COMPARE: { group: string; rows: [string, string | boolean, string | boolean, string | boolean][] }[] = [
  {
    group: 'Usage',
    rows: [
      ['People', '10', '75', 'Unlimited'],
      ['Projects', '5', '40', 'Unlimited'],
      ['Submissions / month', '2,000', '25,000', '500,000+'],
      ['Storage', '5 GB', '100 GB', '2 TB+'],
      ['API calls / month', '50k', '1M', '25M'],
    ],
  },
  {
    group: 'Workspace',
    rows: [
      ['Custom branding', true, true, true],
      ['Custom domain', false, true, true],
      ['Organisation structure and scoped roles', false, true, true],
      ['Multiple languages', '2', '6', 'Unlimited'],
    ],
  },
  {
    group: 'Security',
    rows: [
      ['Two-step sign-in', true, true, true],
      ['Single sign-on (OIDC)', false, false, true],
      ['Audit log export', false, true, true],
      ['Dedicated data schema', false, false, true],
    ],
  },
  {
    group: 'Support',
    rows: [
      ['Email support', true, true, true],
      ['Onboarding session', false, true, true],
      ['Priority support with SLA', false, false, true],
    ],
  },
];

export const FAQ: [string, string][] = [
  ['Is there a free trial?', 'Yes. Every paid plan starts with a 14-day trial. No card is needed to begin.'],
  ['What counts as a submission?', 'Each completed form response, whether it was entered online or synced from a device after being offline.'],
  ['Can we change plans later?', 'At any time from the Billing page. Upgrades apply immediately; downgrades apply at the next renewal.'],
  ['Where is our data stored?', 'In the region you choose when the organisation is created. Enterprise organisations can have a dedicated schema.'],
  ['Do you offer discounts for NGOs and governments?', 'Yes. Talk to us; programmes funded by development partners often qualify.'],
  ['Can people outside our organisation see dashboards?', 'Only the dashboards you publish. Everything else stays private to the people you grant access to.'],
];

export const FEATURES = [
  { icon: 'ClipboardList', title: 'Collect anywhere', body: 'Build forms once and fill them on any device, including offline. Responses sync when a signal returns and are never edited after submission.' },
  { icon: 'Network', title: 'Mirror your organisation', body: 'Model regions, departments and facilities as a hierarchy. Grant a role for a unit and everything beneath it.' },
  { icon: 'ChartColumn', title: 'Dashboards that stay live', body: 'Turn submissions into charts, maps and tables that refresh as data arrives. Publish to the public or keep them private.' },
  { icon: 'ShieldCheck', title: 'Security by default', body: 'Two-step sign-in, single sign-on, an audit trail and isolated storage for every organisation.' },
  { icon: 'Palette', title: 'Looks like you', body: 'Your logo, colours, domain and languages across the sign-in page, workspace and emails.' },
  { icon: 'Workflow', title: 'Connect your systems', body: 'Pull from APIs and databases on a schedule, map the fields once, and keep every dataset fresh.' },
] as const;

export const USE_CASES = [
  { title: 'Health surveillance', body: 'Weekly facility reports, outbreak alerts and completeness maps for a national health ministry.' },
  { title: 'Statistics and census', body: 'Household surveys with enumerator hierarchies, quality checks and published indicators.' },
  { title: 'Humanitarian response', body: 'Rapid assessments in the field, shared with partners without sharing everything.' },
  { title: 'Aviation and assets', body: 'Track fleets, inspections and incidents against a common register.' },
] as const;

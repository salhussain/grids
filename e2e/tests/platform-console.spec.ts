import { expect, test, type Page } from '@playwright/test';
import {
  PLATFORM_ADMIN,
  expectNoHorizontalScroll,
  latestEmail,
  gridsLogin,
  gridsRegister,
  signedIn,
} from './helpers';

// Platform console end-to-end against the real stack (identity service, Mailpit, API, console).
const shots = process.env.SHOTS_DIR;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const id = () => Date.now().toString(36);

// Later tests reuse data (invoices, emails) created by the onboarding test.
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, path = '/') {
  await page.goto(path);
  await gridsLogin(page, PLATFORM_ADMIN.login, PLATFORM_ADMIN.password);
}

/** Fills the New organisation form and returns the detail page URL. */
async function createOrganisation(page: Page, name: string, primaryEmail: string) {
  await page.goto('/tenants/new');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Registered legal name').fill(`${name} Ltd`);
  await page.getByLabel('Industry').selectOption('Healthcare');
  await page.getByLabel('Organisation size').selectOption('51–200');
  await page.getByLabel('Website').fill('https://example.org');
  await page.getByLabel('Tax ID / VAT / GST number').fill('GST-123-456');
  await page.getByLabel('Address line 1').fill('1 Queen Street');
  await page.getByLabel('City', { exact: true }).fill('Auckland');
  await page.getByLabel('Country', { exact: true }).selectOption('NZ');
  const primary = page.locator('section', { hasText: 'Primary contact' });
  await primary.getByLabel('Full name').fill('Ana Smith');
  await primary.getByLabel('Email').fill(primaryEmail);
  await primary.getByLabel('Job title').fill('CIO');
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
}

test('onboarding: create → subscribe yearly → pay → invite admin → admin joins', async ({
  browser,
}) => {
  const suffix = id();
  const name = `Coral Reef ${suffix}`;
  const adminEmail = `admin-${suffix}@example.org`;
  const page = await browser.newPage();
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await snap(page, 'v2-01-overview');

  // 1. Create (slug left blank → generated from the legal name)
  await createOrganisation(page, name, `ana-${suffix}@example.org`);
  await expect(page.getByText(`coral-reef-${suffix}-ltd`)).toBeVisible();
  await expect(page.getByText('Next: set up a subscription')).toBeVisible();
  await snap(page, 'v2-02-created');

  // 2. Subscribe: Team, yearly (15% off)
  await page.getByRole('button', { name: 'Set up subscription' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Team/ }).click();
  await dialog.getByRole('radio', { name: /Yearly/ }).click();
  await expect(dialog.getByText('$1,009.80 / year')).toBeVisible(); // $99 × 12 × 0.85
  await snap(page, 'v2-03-subscribe');
  await dialog.getByRole('button', { name: 'Create subscription & issue invoice' }).click();

  // 3. Payment
  await expect(page.getByText('Awaiting payment')).toBeVisible();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Reference').fill('BT-2026-001');
  await page.getByRole('button', { name: /Confirm payment of \$1,009\.80/ }).click();
  await expect(page.getByText('Next: invite an administrator')).toBeVisible();
  await expect(page.locator('h1').getByText('active')).toBeVisible();

  // 4. Invite the administrator with person details
  await page.getByRole('button', { name: 'Invite administrator' }).click();
  const invite = page.getByRole('dialog');
  await expect(invite.getByLabel('Role')).toHaveValue('org_admin');
  await invite.getByLabel('First name').fill('Reef');
  await invite.getByLabel('Last name').fill('Admin');
  await invite.getByLabel('Work email').fill(adminEmail);
  await invite.getByLabel('Job title').fill('Head of Data');
  await invite.getByLabel('Department').fill('Monitoring');
  await invite.getByLabel('Phone').fill('+64 21 555 0101');
  await invite.getByLabel('Personal message').fill('Welcome to Grids!');
  const sentAt = new Date(Date.now() - 2000);
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(invite.getByText(`Emailed to ${adminEmail}`)).toBeVisible();
  await snap(page, 'v2-04-invited');
  await invite.getByRole('button', { name: 'Done' }).click();

  // The invitation email (Mailpit) carries the link and message
  const mail = await latestEmail(adminEmail, sentAt);
  expect(mail).toContain('Welcome to Grids!');
  // Members join through the organisation workspace (web app), not the console.
  const inviteUrl = mail.match(/http:\/\/localhost:5174\/invite\/[\w-]+/)![0];

  // Invitee registers on the organisation-branded sign-in page and accepts
  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(inviteUrl);
  await expect(invitee.getByRole('heading', { name: `Join ${name}` })).toBeVisible();
  await expect(invitee.getByText('Hi Reef')).toBeVisible();
  await invitee.getByRole('button', { name: 'Continue' }).click();
  await invitee.waitForURL(/\/ui\/interaction\//);
  await expect(invitee.getByText(name).first()).toBeVisible(); // organisation branding
  await gridsRegister(invitee, { givenName: 'Reef', familyName: 'Admin', email: adminEmail });
  await signedIn(invitee);
  await invitee.getByRole('button', { name: 'Accept invitation' }).click();
  // Accepting lands in the organisation's workspace
  await invitee.waitForURL(/localhost:5174\/o\/[\w-]+$/);
  await expect(invitee.getByRole('heading', { name: 'Welcome, Reef' })).toBeVisible();

  // Platform admin sees the member with captured details and 2FA status
  await page.reload();
  await page.getByRole('tab', { name: /People/ }).click();
  const row = page.getByRole('row', { name: /Reef Admin/ });
  await expect(row).toContainText('Head of Data · Monitoring');
  await expect(row).toContainText('+64 21 555 0101');
  await expect(row).toContainText('Not enrolled');
  await expect(row.getByRole('combobox')).toHaveValue('org_admin');
  await expect(page.getByText('Next: invite an administrator')).toBeHidden();
  await snap(page, 'v2-05-people');

  // Require 2FA for the organisation
  await page.getByRole('tab', { name: 'Security' }).click();
  await page.getByRole('switch', { name: 'Require 2FA' }).click();
  await expect(page.getByText('2FA is now required')).toBeVisible();
  await page.getByRole('tab', { name: /People/ }).click();
  await expect(page.getByRole('row', { name: /Reef Admin/ })).toContainText('Required, not set up');

  // Billing tab shows the paid yearly subscription
  await page.getByRole('tab', { name: 'Billing' }).click();
  await expect(page.getByText('$1,009.80').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /INV-/ })).toContainText('paid');
  await snap(page, 'v2-06-billing-tab');
});

test('plans, billing, support and logs', async ({ page }) => {
  const suffix = id();
  await signIn(page, '/plans');

  // Create a plan
  await page.getByRole('button', { name: 'New plan' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Plan ID').fill(`starter-${suffix}`);
  await editor.getByLabel('Name').fill(`Starter ${suffix}`);
  await editor.getByLabel('Monthly price').fill('29');
  await editor.getByLabel('Yearly discount %').fill('20');
  await editor.getByLabel('Users').fill('10');
  await editor.getByLabel('Projects').fill('2');
  await editor.getByLabel('API access').check();
  await editor.getByRole('button', { name: 'Save plan' }).click();
  await expect(
    page.getByRole('columnheader', { name: new RegExp(`Starter ${suffix}`) }),
  ).toContainText('$278.40 / year');
  await snap(page, 'v2-07-plans');
  // Archive it again so test runs don't clutter the catalogue
  await page.getByRole('button', { name: `Edit Starter ${suffix}` }).click();
  await page.getByRole('dialog').getByLabel('Archived').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save plan' }).click();
  await expect(
    page.getByRole('columnheader', { name: new RegExp(`Starter ${suffix}`) }),
  ).toBeHidden();

  // Billing overview
  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByText('MRR', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Revenue collected per month/ })).toBeVisible();
  await snap(page, 'v2-08-billing');
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await expect(page.getByRole('row', { name: /INV-/ }).first()).toBeVisible();

  // Support: open a ticket on behalf of an organisation, add a note, reply
  await page.getByRole('link', { name: /Support/ }).click();
  await page.getByRole('button', { name: 'New ticket' }).click();
  const t = page.getByRole('dialog');
  await t.getByLabel('Organisation', { exact: true }).selectOption({ index: 1 });
  await t.getByLabel('Subject').fill(`Map overlay missing ${suffix}`);
  await t.getByLabel('Priority').selectOption('urgent');
  await t.getByLabel('Description').fill('The regional overlay does not render.');
  await t.getByRole('button', { name: 'Open ticket' }).click();
  await expect(page.getByRole('heading', { name: `Map overlay missing ${suffix}` })).toBeVisible();
  await page.getByRole('switch', { name: 'Internal note' }).click();
  await page.getByLabel('Note', { exact: true }).fill('Probably tile server latency.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Probably tile server latency.')).toBeVisible();
  await page.getByRole('switch', { name: 'Internal note' }).click();
  await page
    .getByLabel('Message', { exact: true })
    .fill('We are investigating and will update you shortly.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByLabel('Status')).toHaveValue('pending');
  await snap(page, 'v2-09-ticket');

  // Logs
  await page.getByRole('link', { name: 'Email log' }).click();
  await expect(page.getByRole('row', { name: /invoice_issued|invitation/ }).first()).toBeVisible();
  await page.getByRole('row').nth(1).click();
  await expect(page.getByRole('dialog').locator('pre')).not.toBeEmpty();
  await snap(page, 'v2-10-email-log');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'System log' }).click();
  await page.getByLabel('Area').selectOption('ticket.');
  await expect(page.getByRole('row', { name: /ticket\.note_added/ }).first()).toBeVisible();
  await snap(page, 'v2-11-system-log');
});

test('custom domain on a trial organisation', async ({ page }) => {
  const suffix = id();
  await signIn(page);
  await createOrganisation(page, `Domain Test ${suffix}`, `d-${suffix}@example.org`);
  await page.getByRole('button', { name: 'Set up subscription' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('radio', { name: /Business/ }).click();
  await d.getByText(/day free trial/).click();
  await d.getByRole('button', { name: /Start 14-day trial/ }).click();
  await expect(page.locator('h1').getByText('active')).toBeVisible();

  await page.getByRole('tab', { name: 'Domains' }).click();
  await page.getByLabel('Hostname').fill(`data-${suffix}.test`);
  await page.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.locator(`input[value="_grids-challenge.data-${suffix}.test"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: 'Make primary' }).click();
  await expect(
    page.locator('h1 + div, h1 ~ *').getByText(`data-${suffix}.test`).first(),
  ).toBeVisible();
  await snap(page, 'v2-12-domains');
});

test('console works at phone width', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Organisations' }).click();
  await expect(page.getByRole('heading', { name: 'Organisations', exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('/tenants/new');
  await expect(page.getByRole('button', { name: 'Create organisation' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await snap(page, 'v2-13-mobile');
});

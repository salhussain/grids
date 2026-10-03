import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, onboardWithAdmin } from './helpers';

const shots = process.env.SHOTS_DIR;

test('organisation admin runs their workspace', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const page = await onboardWithAdmin(browser, {
    name: `Atoll Health ${suffix}`,
    plan: 'Team',
    adminEmail: `owner-${suffix}@example.org`,
  });
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await expect(page.getByText('Organisation admin', { exact: true }).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Workspace' });

  // Structure: Region → District
  await nav.getByRole('link', { name: 'Structure' }).click();
  await page.getByRole('button', { name: 'Add the first unit' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Name', exact: true }).fill('North');
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Level', exact: true })
    .fill('Region');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add unit under North' }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Northland');
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Level', exact: true })
    .fill('District');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('treeitem', { name: 'Northland' })).toHaveAttribute(
    'aria-level',
    '2',
  );
  await expect(page.getByText('Region → District')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m2-01-structure.png`, fullPage: true });

  // Branding: colour, name, sidebar; theme applies to the whole app
  await nav.getByRole('link', { name: 'Branding' }).click();
  await page.getByLabel('Workspace name').fill('Atoll Data');
  await page.getByRole('button', { name: 'Use #198038' }).click();
  await page.getByRole('radio', { name: 'Brand colour' }).click();
  await page.getByLabel('Welcome message').fill('Kia ora! Data for every atoll.');
  if (shots) await page.screenshot({ path: `${shots}/m2-02-branding.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText('Branding saved')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--brand-600')))
    .toBe('#198038');
  await expect(page.getByRole('complementary').getByText('Atoll Data').first()).toBeVisible();

  // Roles: a custom scopable role
  await nav.getByRole('link', { name: 'Roles & access' }).click();
  await page.getByRole('button', { name: 'New role' }).click();
  const role = page.getByRole('dialog');
  await role.getByRole('textbox', { name: 'Name', exact: true }).fill('Field coordinator');
  await role.getByRole('checkbox', { name: /View people and their details/ }).check();
  await role.getByRole('checkbox', { name: /Invite people/ }).check();
  await role.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('row', { name: /Field coordinator/ })).toContainText('Custom');
  await page.getByRole('tab', { name: 'Permission matrix' }).click();
  await expect(
    page.getByRole('cell', { name: 'Field coordinator: granted' }).first(),
  ).toBeVisible();

  // People: invite straight into a district
  await nav.getByRole('link', { name: 'People' }).click();
  await page.getByRole('button', { name: 'Invite people' }).click();
  const inv = page.getByRole('dialog');
  await inv.getByLabel('First name').fill('Tala');
  await inv.getByLabel('Last name').fill('Field');
  await inv.getByLabel('Work email').fill(`tala-${suffix}@example.org`);
  await inv.getByLabel('Org unit').selectOption({ label: '— Northland (District)' });
  await inv.getByRole('button', { name: 'Send invitation' }).click();
  await expect(inv.getByText(`Emailed to tala-${suffix}@example.org`)).toBeVisible();
  await inv.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`tala-${suffix}`) })).toContainText(
    'Northland',
  );
  if (shots) await page.screenshot({ path: `${shots}/m2-03-people.png`, fullPage: true });

  // Security: require 2FA
  await nav.getByRole('link', { name: 'Security' }).click();
  await page.getByRole('switch', { name: 'Require 2FA' }).click();
  await expect(page.getByText('2FA is now required for everyone')).toBeVisible();

  // Support: raise a ticket
  await nav.getByRole('link', { name: 'Support' }).click();
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  await page.getByRole('dialog').getByLabel('Subject').fill('How do we import our facility list?');
  await page
    .getByRole('dialog')
    .getByLabel('Describe the issue')
    .fill('We have 300 facilities in a spreadsheet.');
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(
    page.getByRole('heading', { name: 'How do we import our facility list?' }),
  ).toBeVisible();

  // Activity reflects everything
  await nav.getByRole('link', { name: 'Activity' }).click();
  for (const action of [
    'structure.unit_created',
    'branding.updated',
    'access.role_created',
    'invitation.created',
    'security.mfa_required',
    'ticket.created',
  ]) {
    await expect(page.getByText(action).first()).toBeVisible();
  }
  if (shots) await page.screenshot({ path: `${shots}/m2-04-activity.png`, fullPage: true });

  // Phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(page.url().replace(/\/activity$/, '/structure'));
  await expect(page.getByRole('heading', { name: 'Structure' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (shots) await page.screenshot({ path: `${shots}/m2-05-mobile.png`, fullPage: true });
});

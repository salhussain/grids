import { expect, test } from '@playwright/test';
import { NEW_PASSWORD, PLATFORM_ADMIN, gridsLogin, latestEmail } from './helpers';

const shots = process.env.SHOTS_DIR;

test('staff: invite a support agent who only sees support', async ({ browser }) => {
  const suffix = Date.now().toString(36);
  const email = `agent-${suffix}@grids.local`;
  const admin = await browser.newPage();
  await admin.goto('/staff');
  await gridsLogin(admin, PLATFORM_ADMIN.login, PLATFORM_ADMIN.password);
  await expect(admin.getByRole('heading', { name: 'Staff & roles' })).toBeVisible();

  // Invite with the built-in Support agent role plus one individual permission
  await admin.getByRole('button', { name: 'Invite staff' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Sue');
  await dialog.getByLabel('Last name').fill('Agent');
  await dialog.getByLabel('Work email').fill(email);
  await dialog.getByRole('checkbox', { name: /Support agent/ }).check();
  await dialog.getByRole('checkbox', { name: /View the system log/ }).check();
  await expect(dialog.getByText('View tickets (from role)')).toBeVisible();
  if (shots) await admin.screenshot({ path: `${shots}/v3-01-invite-staff.png`, fullPage: true });
  const sentAt = new Date(Date.now() - 2000);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  const row = admin.getByRole('row', { name: new RegExp(email) });
  await expect(row).toContainText('Support agent');
  await expect(row).toContainText('logs.system');
  await expect(row).toContainText('invited');

  // Roles tab and permission matrix
  await admin.getByRole('tab', { name: 'Roles' }).click();
  await expect(admin.getByRole('row', { name: /Super admin/ })).toContainText('Built-in');
  await admin.getByRole('tab', { name: 'Permission matrix' }).click();
  await expect(admin.getByRole('cell', { name: 'Support agent: granted' }).first()).toBeVisible();
  if (shots) await admin.screenshot({ path: `${shots}/v3-02-matrix.png`, fullPage: true });

  // The agent sets a password from the set-up email, then signs in to the console
  const mail = await latestEmail(email, sentAt);
  const setupUrl = mail.match(/(http:\/\/localhost:4100\/ui\/setup\/[\w-]+)/)![1]!;
  const agent = await (await browser.newContext()).newPage();
  await agent.goto(setupUrl);
  await expect(agent.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await agent.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await agent.getByLabel('Confirm password', { exact: true }).fill(NEW_PASSWORD);
  await agent.getByRole('button', { name: 'Save password' }).click();
  await agent.getByRole('link', { name: 'Go to sign in' }).click();
  await gridsLogin(agent, email, NEW_PASSWORD);

  // Only permitted navigation is shown; billing is not reachable
  const nav = agent.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Support' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'System log' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Billing' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Staff & roles' })).toHaveCount(0);
  await agent.goto('http://localhost:5173/billing');
  await expect(agent.getByText('You don’t have access to billing')).toBeVisible();
  if (shots) await agent.screenshot({ path: `${shots}/v3-03-agent.png`, fullPage: true });

  // Suspending the agent removes access
  await admin.getByRole('tab', { name: 'Staff' }).click();
  await admin
    .getByRole('row', { name: new RegExp(email) })
    .getByRole('button', { name: 'Edit access' })
    .click();
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('dialog').getByRole('button', { name: 'Suspend' }).click();
  await expect(admin.getByRole('row', { name: new RegExp(email) })).toContainText('suspended');
});

test('live pages auto-refresh, refresh on demand, and paginate', async ({ page }) => {
  await page.goto('/logs/system');
  await gridsLogin(page, PLATFORM_ADMIN.login, PLATFORM_ADMIN.password);
  await expect(page.getByRole('button', { name: 'Pause auto-refresh' })).toBeVisible();

  // Auto refresh: a new request within ~15s without interaction
  const auto = page.waitForResponse((r) => r.url().includes('/platform/logs/audit'), {
    timeout: 20_000,
  });
  expect((await auto).ok()).toBe(true);

  // Manual refresh
  const manual = page.waitForResponse((r) => r.url().includes('/platform/logs/audit'));
  await page.getByRole('button', { name: 'Refresh now' }).click();
  expect((await manual).ok()).toBe(true);

  // Server-side pagination: page 2 requests page=2 and shows a different range
  const nav = page.getByRole('navigation', { name: 'Pagination' });
  await expect(nav).toContainText(/1–50 of [\d,]+/);
  const next = page.waitForResponse((r) => r.url().includes('page=2'));
  await nav.getByRole('button', { name: 'Next page' }).click();
  await next;
  await expect(nav).toContainText(/51–100 of/);

  // Pause stops polling
  await page.getByRole('button', { name: 'Pause auto-refresh' }).click();
  await expect(page.getByRole('button', { name: 'Resume auto-refresh' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume auto-refresh' }).click();
  if (shots) await page.screenshot({ path: `${shots}/v3-04-system-log.png`, fullPage: true });
});

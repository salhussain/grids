import { expect, type Browser, type Page } from '@playwright/test';

export const PLATFORM_ADMIN = { login: 'admin@grids.local', password: 'Password1!' };
/** Passes the identity service's password policy (10+ characters, not common). */
export const NEW_PASSWORD = 'Lagoon-sunrise-2026';
export const IDP = process.env.IDP_URL ?? 'http://localhost:4100';

/** Signs in on the Grids sign-in page and waits until the app has finished its callback. */
export async function gridsLogin(page: Page, email: string, password: string) {
  await page.waitForURL(/\/ui\/interaction\//);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await signedIn(page);
}

/** Waits until the browser is back in an app with the redirect callback completed. */
export async function signedIn(page: Page) {
  await page.waitForURL((u) => !u.href.startsWith(IDP) && !u.pathname.startsWith('/auth/callback'));
}

/** Creates an account on the sign-in page and enters the emailed verification code. */
export async function gridsRegister(
  page: Page,
  user: { givenName: string; familyName: string; email: string; password?: string },
) {
  await page.waitForURL(/\/ui\/interaction\//);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('First name').fill(user.givenName);
  await page.getByLabel('Last name').fill(user.familyName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password ?? NEW_PASSWORD);
  const at = new Date(Date.now() - 2000);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const code = (await latestEmail(user.email, at)).match(/\b(\d{6})\b/)![1]!;
  await page.getByLabel('Verification code').fill(code); // submits when complete
}

const API = process.env.API_URL ?? 'http://localhost:4000';
const SERVICE_TOKEN = process.env.IDENTITY_SERVICE_TOKEN ?? 'dev-service-token-change-me';

/** Polls the platform's development mailbox for the newest message to `to` and returns its text. */
export async function latestEmail(to: string, since: Date): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${API}/internal/mail?to=${encodeURIComponent(to)}&since=${since.toISOString()}`, {
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    const messages = (await res.json()) as { text: string }[];
    if (messages[0]) return messages[0].text;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No email to ${to}`);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export const WEB = process.env.WEB_URL ?? 'http://localhost:5174';

/**
 * Onboards an organisation through the console (create → trial → invite admin)
 * and has the admin register and accept. Returns the admin's page, signed in to
 * the web workspace.
 */
export async function onboardWithAdmin(
  browser: Browser,
  opts: { name: string; plan: 'Team' | 'Business'; adminEmail: string },
) {
  const console = await browser.newPage();
  await console.goto('/tenants/new');
  await gridsLogin(console, PLATFORM_ADMIN.login, PLATFORM_ADMIN.password);
  await console.getByLabel('Display name').fill(opts.name);
  const primary = console.locator('section', { hasText: 'Primary contact' });
  await primary.getByLabel('Full name').fill('Owner Person');
  await primary.getByLabel('Email').fill(opts.adminEmail);
  await console.getByRole('button', { name: 'Create organisation' }).click();
  await console.getByRole('button', { name: 'Set up subscription' }).first().click();
  const sub = console.getByRole('dialog');
  await sub.getByRole('radio', { name: new RegExp(opts.plan) }).click();
  await sub.getByText(/day free trial/).click();
  await sub.getByRole('button', { name: /Start \d+-day trial/ }).click();
  await console.getByRole('button', { name: 'Invite administrator' }).click();
  const inv = console.getByRole('dialog');
  await inv.getByLabel('First name').fill('Owner');
  await inv.getByLabel('Last name').fill('Person');
  await inv.getByLabel('Work email').fill(opts.adminEmail);
  const sentAt = new Date(Date.now() - 2000);
  await inv.getByRole('button', { name: 'Send invitation' }).click();
  await inv.getByRole('button', { name: 'Done' }).click();
  await console.close();

  const inviteUrl = (await latestEmail(opts.adminEmail, sentAt)).match(
    /(http:\/\/localhost:5174\/invite\/[\w-]+)/,
  )![1]!;
  const page = await (await browser.newContext({ baseURL: WEB })).newPage();
  await page.goto(inviteUrl);
  await page.getByRole('button', { name: 'Continue' }).click();
  await gridsRegister(page, { givenName: 'Owner', familyName: 'Person', email: opts.adminEmail });
  await signedIn(page);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(/\/o\/[\w-]+$/);
  return page;
}

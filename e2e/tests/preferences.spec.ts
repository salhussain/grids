import { expect, test } from '@playwright/test';
import { onboardWithAdmin } from './helpers';

const shots = process.env.SHOTS_DIR;

test('preferences, languages, right-to-left and billing', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const name = `Lagoon Water ${suffix}`;
  const page = await onboardWithAdmin(browser, {
    name,
    plan: 'Team',
    adminEmail: `owner-${suffix}@example.org`,
  });
  const nav = page.getByRole('navigation', { name: 'Workspace' });

  // Dark mode is a personal preference that persists (the header toggle, as on the sign-in page)
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  if (shots) await page.screenshot({ path: `${shots}/p-01-dark-home.png`, fullPage: true });

  // Billing: trial subscription, the upcoming first charge, usage
  await nav.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  await expect(page.getByText('Trial', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Trial ends /)).toBeVisible();
  await expect(page.getByText('Upcoming charge').first()).toBeVisible();
  await expect(page.getByRole('meter', { name: 'People' })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/p-02-billing-dark.png`, fullPage: true });

  // Languages: offer French and Arabic, reword "People" in French
  await nav.getByRole('link', { name: 'Languages' }).click();
  await page.getByRole('checkbox', { name: /Français/ }).check();
  await page.getByRole('checkbox', { name: /العربية/ }).check();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('fr');
  await page.getByRole('textbox', { name: 'Search text' }).fill('web.nav.people');
  await page.getByRole('textbox', { name: 'Your wording: web.nav.people' }).fill('Équipe');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Language settings saved')).toBeVisible();

  // Each person picks their language among those offered, from the header's language menu
  await page.getByRole('button', { name: /^Language: / }).click();
  await page.getByRole('option', { name: 'Français' }).click();
  const navFr = page.getByRole('navigation', { name: 'Espace de travail' });
  await expect(navFr.getByRole('link', { name: 'Équipe' })).toBeVisible(); // organisation wording
  await expect(navFr.getByRole('link', { name: 'Facturation' })).toBeVisible();

  await page.getByRole('button', { name: /: Français$/ }).click();
  await page.getByRole('option', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page
    .getByRole('navigation', { name: 'مساحة العمل' })
    .getByRole('link', { name: 'الرئيسية' })
    .click();
  // The sidebar sits on the right in right-to-left layouts
  const box = (await page.locator('aside').boundingBox())!;
  expect(box.x).toBeGreaterThan(500);
  if (shots) await page.screenshot({ path: `${shots}/p-03-arabic-rtl.png`, fullPage: true });

  // Back to light English for the next run's screenshots
  await page.getByRole('button', { name: /: العربية$/ }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

import { expect, test } from '@playwright/test';
import { PLATFORM_ADMIN, gridsLogin } from './helpers';

test('signing out stays signed out', async ({ page }) => {
  await page.goto('/');
  await gridsLogin(page, PLATFORM_ADMIN.login, PLATFORM_ADMIN.password);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  // Back on the sign-in page, and it must not sign in again by itself.
  await page.waitForURL(/\/ui\/interaction\//);
  await page.waitForTimeout(3000);
  expect(page.url()).toMatch(/\/ui\/interaction\//);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

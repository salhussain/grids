import { expect, test, type Page } from '@playwright/test';
import { onboardWithAdmin, WEB } from './helpers';

const shots = process.env.SHOTS_DIR;
const API = process.env.API_URL ?? 'http://localhost:4000';

/** The signed-in user's access token, as the web app stores it. */
async function accessToken(page: Page) {
  return page.evaluate(() => {
    for (const store of [sessionStorage, localStorage])
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)!;
        if (k.startsWith('oidc.user:')) return (JSON.parse(store.getItem(k)!) as { access_token: string }).access_token;
      }
    throw new Error('not signed in');
  });
}

test('a form gets a graph workflow built on the canvas', async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = Date.now().toString(36);
  const page = await onboardWithAdmin(browser, { name: `Workflow Health ${suffix}`, plan: 'Business', adminEmail: `wf-${suffix}@example.org` });
  const tenantId = page.url().match(/\/o\/([\w-]+)/)![1]!;
  const auth = { authorization: `Bearer ${await accessToken(page)}` };

  // A project with forms comes from a template (the UI starts projects empty).
  const created = await page.request.post(`${API}/tenants/${tenantId}/projects`, { headers: auth, data: { name: 'Surveillance', template: 'health-surveillance' } });
  expect(created.status()).toBe(201);
  const key = ((await created.json()) as { key: string }).key;

  await page.goto(`${WEB}/o/${tenantId}/p/${key}/forms/weekly_report/edit`);
  await page.getByRole('tab', { name: 'Workflow' }).or(page.getByRole('button', { name: 'Workflow' })).first().click();
  await expect(page.getByText('Off. Submissions are accepted as soon as they are sent')).toBeVisible();

  // Turn it on: a starter graph (submitted → review → approved / rejected) appears.
  await page.getByRole('switch', { name: 'On' }).click();
  const canvas = page.locator('.react-flow');
  await expect(canvas.getByText('Supervisor review')).toBeVisible();
  await expect(canvas.getByText('Approved', { exact: true })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/workflow-01-starter.png` });

  // Add an email step and edit it from the inspector.
  await page.getByRole('button', { name: 'Send email' }).click();
  await expect(page.getByRole('textbox', { name: 'Step name' })).toBeVisible();
  await page.getByLabel('Subject').fill('Report ${deaths} received');
  await expect(canvas.getByText('Report ${deaths} received')).toBeVisible();

  // The new node is not connected yet, so saving is blocked until it is.
  await expect(page.getByText('is not reachable from the start')).toBeVisible();
  await expect(page.getByText('has no "next" connection')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/workflow-02-problems.png` });

  // Delete the loose node: the graph is valid again and saves.
  await page.getByRole('button', { name: 'Delete step' }).click();
  await expect(page.getByText('Fix before saving')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  const forms = await (await page.request.get(`${API}/tenants/${tenantId}/projects/${key}/forms`, { headers: auth })).json();
  const wf = forms.find((f: { key: string }) => f.key === 'weekly_report').settings.workflow;
  expect(wf.enabled).toBe(true);
  expect(wf.graph.nodes.map((n: { type: string }) => n.type).sort()).toEqual(['approval', 'end', 'end', 'start']);
});

import { expect, test, type Page } from '@playwright/test';
import { expectVisibleFocus, focusByKeyboard, mockAuthoringApi, waitForStableUi, workspaceJobs } from './fixtures';

/** Every shot: no horizontal scroll, then a viewport screenshot. */
async function shot(page: Page, name: string, fullPage = false) {
  await waitForStableUi(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', fullPage });
}

const dark = (page: Page) => page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));

test.describe('Authoring hub (§7.9)', () => {
  test('drafts list with readiness squares; the first row action takes keyboard focus', async ({ page }) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring');
    await expect(page.getByRole('heading', { name: 'Authoring', level: 1 })).toBeVisible();
    await expect(page.getByText('Shortest hops').first()).toBeVisible();
    await shot(page, 'authoring-drafts');

    const firstAction = page.getByRole('button', { name: 'Actions for hp_graph_bfs' });
    await focusByKeyboard(page, firstAction);
    await expectVisibleFocus(firstAction);
  });

  test('drafts list in dark', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'dark baselines are desktop only');
    await dark(page);
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByText('Shortest hops').first()).toBeVisible();
    await shot(page, 'authoring-drafts-dark');
  });

  test('author profiles table and the edit drawer', async ({ page }) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/profiles');
    await expect(page.getByRole('link', { name: 'Author profiles', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
    await shot(page, 'author-profiles');

    await page.getByRole('button', { name: 'Ada', exact: true }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Edit Ada' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('ada.l').first()).toBeVisible();
    await shot(page, 'author-profile-drawer');
  });
});

test.describe('Draft workspace (§7.9)', () => {
  test('metadata; the first step tab takes keyboard focus', async ({ page }) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/d-bfs/metadata');
    await expect(page.getByText('Saved · rev 14')).toBeVisible();
    await expect(page.getByLabel('Time limit')).toHaveValue('1000');
    await shot(page, 'draft-metadata');

    const firstStep = page.getByRole('link', { name: 'Metadata, done' });
    await focusByKeyboard(page, firstStep);
    await expectVisibleFocus(firstStep);
  });

  test('statement', async ({ page }) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/d-bfs/statement');
    await expect(page.getByText('older than the draft (rev 14)')).toBeVisible();
    await expect(page.frameLocator('iframe[title="Live statement preview"]').getByText('fewest roads').first()).toBeVisible();
    await shot(page, 'draft-statement');
  });

  test('solution while a compile runs', async ({ page }) => {
    const running = { ...workspaceJobs[0], id: 'j-running', status: 'running', createdAt: '2026-09-16T01:59:00.000Z', resultSummary: null };
    await mockAuthoringApi(page, { jobs: [running, ...workspaceJobs] });
    await page.goto('/admin/authoring/d-bfs/solution');
    await expect(page.getByText('Compile solution · running')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Last compile' })).toBeVisible();
    await shot(page, 'draft-solution-running');
  });

  test('testcases', async ({ page }) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/d-bfs/testcases');
    await expect(page.getByText('24 testcases · 3.1 MB')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actions for 01.in' })).toBeVisible();
    await shot(page, 'draft-testcases');
  });

  test('verify & publish with a failed verify', async ({ page }) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/d-bfs/verify');
    await expect(page.getByText('Rebuild the PDF and verify rev 14 before publishing.')).toBeVisible();
    await expect(page.getByText('24 cases, all with outputs · 3.1 MB')).toBeVisible();
    // Full page: the footer with Verify, Publish and the reason sits below the fold.
    await shot(page, 'draft-verify', true);
  });

  test('verify & publish in dark', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'dark baselines are desktop only');
    await dark(page);
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/d-bfs/verify');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByText('24 cases, all with outputs · 3.1 MB')).toBeVisible();
    await shot(page, 'draft-verify-dark');
  });

  test('history and the job drawer', async ({ page }) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/d-bfs/jobs');
    await expect(page.getByText('Failed · case 7 wrong answer').first()).toBeVisible();
    await page.getByRole('button', { name: 'Verify All' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Verify All · rev 12' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/case 7 wrong answer: expected/)).toBeVisible();
    await shot(page, 'draft-history-drawer');
  });

  test('full-screen statement editor', async ({ page }, testInfo) => {
    await mockAuthoringApi(page);
    await page.goto('/admin/authoring/d-bfs/editor');
    await expect(page.getByRole('link', { name: '← Workspace' })).toBeVisible();
    await expect(page.getByText('Saved · rev 14')).toBeVisible();
    if (testInfo.project.name === 'desktop') {
      await expect(page.getByText('Live preview is up to date')).toBeVisible();
      await expect(page.frameLocator('iframe[title="Live statement preview"]').getByText('fewest roads').first()).toBeVisible();
    } else {
      await expect(page.getByRole('group', { name: 'Editor pane' }).getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
    }
    await shot(page, 'statement-editor');
  });
});

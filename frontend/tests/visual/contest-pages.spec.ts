import { expect, test, type Page } from '@playwright/test';
import { expectVisibleFocus, focusByKeyboard, mockContestApi, waitForStableUi } from './fixtures';

/** Phase 4 contest pages (§7.7): one baseline per state and viewport, dark for the table and the scoreboard. */

const settle = async (page: Page) => {
  await waitForStableUi(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};
const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', fullPage: true });
const dark = (page: Page) => page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));

test('contests list', async ({ page }) => {
  await mockContestApi(page, 'list');
  await page.goto('/contests');
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
  await settle(page);
  await shot(page, 'contests');
  const enter = page.getByRole('link', { name: 'Enter' });
  await focusByKeyboard(page, enter);
  await expectVisibleFocus(enter);
});

test('contest lobby', async ({ page }) => {
  await mockContestApi(page, 'scheduled');
  await page.goto('/contests/1');
  await expect(page.getByRole('heading', { name: /Registered · 12/ })).toBeVisible();
  await settle(page);
  await shot(page, 'contest-lobby');
});

test('contest join gate', async ({ page }) => {
  await mockContestApi(page, 'running-guest');
  await page.goto('/contests/1');
  await expect(page.getByRole('button', { name: 'Join contest' })).toBeVisible();
  await settle(page);
  await shot(page, 'contest-join-gate');
});

for (const theme of ['light', 'dark'] as const) {
  test(`contest problems (${theme})`, async ({ page }) => {
    if (theme === 'dark') await dark(page);
    await mockContestApi(page, 'running');
    await page.goto('/contests/1/problems');
    await expect(page.getByRole('table', { name: 'Problems' }).getByRole('link', { name: 'Interval merge' })).toBeVisible();
    await settle(page);
    await shot(page, theme === 'dark' ? 'contest-problems-dark' : 'contest-problems');
  });

  test(`contest scoreboard (${theme})`, async ({ page }) => {
    if (theme === 'dark') await dark(page);
    await mockContestApi(page, 'running');
    await page.goto('/contests/1/scoreboard');
    await expect(page.getByRole('link', { name: 'ploy' })).toBeVisible();
    await settle(page);
    await shot(page, theme === 'dark' ? 'contest-scoreboard-dark' : 'contest-scoreboard');
    if (theme === 'light') {
      const first = page.getByRole('link', { name: 'ploy' });
      await focusByKeyboard(page, first);
      await expectVisibleFocus(first);
    }
  });
}

test('contest finishing', async ({ page }) => {
  await mockContestApi(page, 'finishing');
  await page.goto('/contests/1/problems');
  await expect(page.getByText('Judging final submissions…')).toBeVisible();
  await settle(page);
  await shot(page, 'contest-finishing');
});

test('contest recap', async ({ page }) => {
  await mockContestApi(page, 'finished');
  await page.goto('/contests/1');
  await expect(page.getByRole('list', { name: 'Your result' })).toBeVisible();
  await settle(page);
  await shot(page, 'contest-recap');
});

test('contest problem after the end', async ({ page }) => {
  await mockContestApi(page, 'finishing');
  await page.goto('/contests/1/problems/interval?tab=submit');
  await expect(page.getByText('Contest ended — submissions closed.')).toBeVisible();
  await settle(page);
  await shot(page, 'contest-problem-ended');
});

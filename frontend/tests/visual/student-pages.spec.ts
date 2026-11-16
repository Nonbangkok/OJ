import { expect, test, type Page } from '@playwright/test';
import { expectVisibleFocus, focusByKeyboard, mockGuestApi, mockStudentApi, waitForStableUi } from './fixtures';

/**
 * Phase 3 student pages (§7.1–7.10): one baseline per page and viewport, plus
 * dark for the two pages with the most colour (Problems, Profile).
 */

const settle = async (page: Page) => {
  await waitForStableUi(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', fullPage: true });

const dark = async (page: Page) => {
  await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
};

test.describe('signed-in student', () => {
  test.beforeEach(async ({ page }) => { await mockStudentApi(page); });

  test('home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Continue where you left off' })).toBeVisible();
    await expect(page.getByText('vector::erase').first()).toBeVisible();
    await settle(page);
    await shot(page, 'home');
  });

  test('problems', async ({ page }) => {
    await page.goto('/problems');
    await expect(page.getByRole('link', { name: 'Queue rotate' })).toBeVisible();
    await settle(page);
    await shot(page, 'problems');

    const row = page.getByRole('link', { name: 'vector::erase' });
    await focusByKeyboard(page, row);
    await expectVisibleFocus(row);
  });

  test('problems, dark', async ({ page }) => {
    await dark(page);
    await page.goto('/problems');
    await expect(page.getByRole('link', { name: 'Queue rotate' })).toBeVisible();
    await settle(page);
    await shot(page, 'problems-dark');
  });

  // Submitting opens the submission's own page (covered by "submission detail"); this is the Submit tab.
  test('problem detail, submit tab', async ({ page }) => {
    await page.goto('/problems/hp_vec04_erase?tab=submit');
    await expect(page.getByRole('heading', { name: 'vector::erase', level: 1 })).toBeVisible();
    await expect(page.getByLabel(/Your code/i)).toBeVisible();
    await settle(page);
    await shot(page, 'problem-detail-submit');
  });

  test('submissions', async ({ page }) => {
    await page.goto('/submissions');
    await expect(page.getByText('Queue rotate')).toBeVisible();
    await settle(page);
    await shot(page, 'submissions');
  });

  test('submission detail', async ({ page }) => {
    await page.goto('/submissions/48213');
    await expect(page.getByText('WRONG ANSWER').first()).toBeVisible();
    await settle(page);
    await shot(page, 'submission-detail');
  });

  test('ranking', async ({ page }) => {
    await page.goto('/scoreboard');
    await expect(page.getByText('ploy')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your rank' })).toBeVisible();
    await settle(page);
    await shot(page, 'ranking');

    const segment = page.getByRole('button', { name: 'All time' });
    await focusByKeyboard(page, segment);
    await expectVisibleFocus(segment);
  });

  test('profile', async ({ page }, testInfo) => {
    await page.goto('/profile/nattapat');
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
    await settle(page);

    // Desktop puts Recently solved and Verdicts side by side; phones stack them.
    const recent = await page.getByRole('heading', { name: 'Recently Solved' }).boundingBox();
    const verdicts = await page.getByRole('heading', { name: 'Verdicts' }).boundingBox();
    if (testInfo.project.name === 'desktop') expect(Math.abs(recent!.y - verdicts!.y)).toBeLessThan(2);
    else expect(verdicts!.y).toBeGreaterThan(recent!.y);
    // Verdict bars are drawn: the biggest count fills its whole track.
    const fills = await page.locator('[class*="breakdown-bar-fill"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(Math.max(...fills)).toBeGreaterThan(40);
    await shot(page, 'profile');
  });

  test('profile, dark', async ({ page }) => {
    await dark(page);
    await page.goto('/profile/nattapat');
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
    await settle(page);
    await shot(page, 'profile-dark');
  });

  test('not found', async ({ page }) => {
    await page.goto('/problemz/vector_eraze');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await settle(page);
    await shot(page, 'not-found');
  });
});

test.describe('guest', () => {
  test.beforeEach(async ({ page }) => { await mockGuestApi(page); });

  test('guest home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Start with these problems' })).toBeVisible();
    await expect(page.getByText('Queue rotate')).toBeVisible();
    await settle(page);
    await shot(page, 'guest-home');
  });

  test('login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await settle(page);
    await shot(page, 'login');
  });

  test('register', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
    await settle(page);
    await shot(page, 'register');
  });
});

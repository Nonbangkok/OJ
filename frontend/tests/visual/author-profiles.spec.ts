import { expect, test } from '@playwright/test';
import {
  expectVisibleFocus,
  focusByKeyboard,
  mockAdminApi,
  waitForStableUi,
} from './fixtures';

test('author profiles stay readable across viewports and themes', async ({ page }, testInfo) => {
  await mockAdminApi(page);
  await page.goto('/admin/authoring');
  await expect(page.getByRole('heading', { name: 'Problem Authoring' })).toBeVisible();
  await page.getByRole('button', { name: 'Author profiles', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Edit International Algorithmic Marathon Author/ })
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Edit Precision Scheduling Collective With Deliberately Long Attribution/,
    })
  ).toBeVisible();
  await waitForStableUi(page);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const metrics = await page
    .getByRole('button', { name: /Edit International/ })
    .evaluate((button) => {
      const row = button.closest('li')!;
      const identity = row.querySelector('[data-profile-identity]')!;
      return {
        buttonWidth: button.getBoundingClientRect().width,
        identityWidth: identity.getBoundingClientRect().width,
        rowWidth: row.getBoundingClientRect().width,
      };
    });
  expect(metrics.buttonWidth).toBeLessThan(160);
  expect(metrics.identityWidth).toBeGreaterThan(120);
  if (testInfo.project.name === 'mobile') expect(metrics.rowWidth).toBeLessThanOrEqual(390);

  const longProfileEdit = page.getByRole('button', {
    name: /Edit Precision Scheduling Collective With Deliberately Long Attribution/,
  });
  if (testInfo.project.name === 'mobile') await longProfileEdit.scrollIntoViewIfNeeded();

  await expect(page).toHaveScreenshot('author-profiles.png', { animations: 'disabled' });

  await focusByKeyboard(page, longProfileEdit);
  await expectVisibleFocus(longProfileEdit);
  await expect(page).toHaveScreenshot('author-profiles-focus.png', { animations: 'disabled' });

  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page).toHaveScreenshot('author-profiles-dark.png', { animations: 'disabled' });
  }
});

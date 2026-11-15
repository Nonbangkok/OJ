import { expect, test } from '@playwright/test';
import { expectVisibleFocus, focusByKeyboard, mockAdminApi, waitForStableUi } from './fixtures';

test('authoring inside the app shell is responsive and visually stable', async ({ page }, testInfo) => {
  await mockAdminApi(page);
  await page.goto('/admin/authoring');
  await expect(page.getByRole('heading', { name: 'Authoring', level: 1 })).toBeVisible();
  await waitForStableUi(page);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );

  let focusTarget;
  if (testInfo.project.name === 'mobile') {
    // Phones: no sidebar; a bottom tab bar whose "More" sheet holds the Manage pages.
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    const tabs = page.getByRole('navigation', { name: 'Primary' });
    await expect(tabs).toBeVisible();
    const more = tabs.getByRole('button', { name: 'More' });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(sheet.getByRole('link', { name: 'Manage · Authoring' })).toBeVisible();
    await sheet.getByRole('link', { name: 'Manage · Authoring' }).click();
    await expect(page).toHaveURL(/\/admin\/authoring$/);
    await expect(sheet).toBeHidden();
    focusTarget = more;
  } else {
    // Desktop: one sidebar for practice and Manage pages, current page marked.
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await expect(nav.getByText('Manage', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Authoring', exact: true })).toHaveAttribute('aria-current', 'page');
    focusTarget = page.getByRole('button', { name: 'Open user menu' });
    await expect(focusTarget).toBeVisible();
  }

  await expect(page).toHaveScreenshot('admin-authoring-shell.png', { animations: 'disabled' });

  // The sheet returns focus to "More" programmatically after a tap; clear it so the
  // check below measures real keyboard focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await focusByKeyboard(page, focusTarget);
  await expectVisibleFocus(focusTarget);
  await expect(page).toHaveScreenshot('admin-authoring-shell-focus.png', { animations: 'disabled' });
});

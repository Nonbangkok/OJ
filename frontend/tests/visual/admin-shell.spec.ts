import { expect, test } from '@playwright/test';
import { expectVisibleFocus, focusByKeyboard, mockAdminApi, waitForStableUi } from './fixtures';

test('authoring shell is responsive and visually stable', async ({ page }, testInfo) => {
  await mockAdminApi(page);
  await page.goto('/admin/authoring');
  await expect(page.getByRole('heading', { name: 'Problem Authoring' })).toBeVisible();
  await waitForStableUi(page);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
  // The content-area Problem Management link was removed by design; the admin
  // navbar's Problems link (asserted below on desktop) covers navigation.

  // The toggle's accessible name flips between "Menu" and "Close menu" with
  // its open state, so match either.
  const menuToggle = page.getByRole('button', { name: /^(Menu|Close menu)$/ });
  const userMenuTrigger = page.getByRole('button', { name: 'Open user menu' });
  const authoring = page.getByRole('link', { name: 'Authoring', exact: true });

  if (testInfo.project.name === 'mobile') {
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    await menuToggle.click();
    await expect(authoring).toBeVisible();
    const [authoringBox, menuBox] = await Promise.all([
      authoring.boundingBox(),
      menuToggle.boundingBox(),
    ]);
    expect(authoringBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(
      authoringBox!.x + authoringBox!.width <= menuBox!.x ||
        menuBox!.x + menuBox!.width <= authoringBox!.x ||
        authoringBox!.y + authoringBox!.height <= menuBox!.y ||
        menuBox!.y + menuBox!.height <= authoringBox!.y
    ).toBe(true);
    await authoring.click();
    await expect(page).toHaveURL(/\/admin\/authoring$/);
    // Navigating from the open menu closes it, restoring the collapsed name.
    await expect(menuToggle).toHaveAccessibleName('Menu');
  } else {
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Problems', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contests', exact: true })).toBeVisible();
    await expect(authoring).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(userMenuTrigger).toBeVisible();
    await authoring.click();
    await expect(page).toHaveURL(/\/admin\/authoring$/);
  }

  await expect(page).toHaveScreenshot('admin-authoring-shell.png', { animations: 'disabled' });

  const focusTarget = testInfo.project.name === 'mobile' ? menuToggle : userMenuTrigger;
  await focusByKeyboard(page, focusTarget);
  await expectVisibleFocus(focusTarget);
  await expect(page).toHaveScreenshot('admin-authoring-shell-focus.png', { animations: 'disabled' });
});

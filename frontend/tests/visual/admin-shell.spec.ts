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
  await expect(page.getByRole('link', { name: 'Problem Management' })).toBeVisible();

  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const authoring = page.getByRole('link', { name: 'Authoring', exact: true });
  const logout = page.getByRole('button', { name: 'Logout', exact: true });

  if (testInfo.project.name === 'mobile') {
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(authoring).toBeVisible();
    await expect(logout).toBeVisible();
    const [authoringBox, logoutBox] = await Promise.all([
      authoring.boundingBox(),
      logout.boundingBox(),
    ]);
    expect(authoringBox).not.toBeNull();
    expect(logoutBox).not.toBeNull();
    expect(
      authoringBox!.x + authoringBox!.width <= logoutBox!.x ||
        logoutBox!.x + logoutBox!.width <= authoringBox!.x ||
        authoringBox!.y + authoringBox!.height <= logoutBox!.y ||
        logoutBox!.y + logoutBox!.height <= authoringBox!.y
    ).toBe(true);
    await authoring.click();
    await expect(page).toHaveURL(/\/admin\/authoring$/);
    await expect(menu).toHaveAccessibleName('Menu');
  } else {
    await expect(menu).toBeHidden();
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Problems', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contests', exact: true })).toBeVisible();
    await expect(authoring).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Signed in as author.admin' })).toBeVisible();
    await expect(logout).toBeVisible();
    await authoring.click();
    await expect(page).toHaveURL(/\/admin\/authoring$/);
  }

  await expect(page).toHaveScreenshot('admin-authoring-shell.png', { animations: 'disabled' });

  const focusTarget = testInfo.project.name === 'mobile' ? menu : logout;
  await focusByKeyboard(page, focusTarget);
  await expectVisibleFocus(focusTarget);
  await expect(page).toHaveScreenshot('admin-authoring-shell-focus.png', { animations: 'disabled' });
});

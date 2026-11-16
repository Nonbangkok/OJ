import { expect, test, type Page } from '@playwright/test';
import { expectVisibleFocus, focusByKeyboard, mockManageApi, waitForStableUi } from './fixtures';

/** Phase 5 Manage pages (§7.8): one baseline per page and viewport, dark for Settings and Problems. */

const settle = async (page: Page) => {
  await waitForStableUi(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};
const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', fullPage: true });
const dark = (page: Page) => page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));

/** A ZIP's central directory + end record with these names — all the testcase counter reads. */
const zipWithNames = (names: string[]): Buffer => {
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const central: number[] = [];
  for (const name of names) {
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(0), ...u32(0), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0),
      ...Array.from(name, (c) => c.charCodeAt(0)));
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(names.length), ...u16(names.length), ...u32(central.length), ...u32(0), ...u16(0)];
  return Buffer.from([...central, ...end]);
};

test('users', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/users');
  await expect(page.getByText('nattapat').first()).toBeVisible();
  await settle(page);
  await shot(page, 'users');
  const firstAction = page.getByRole('button', { name: /^Actions for / }).first();
  await focusByKeyboard(page, firstAction);
  await expectVisibleFocus(firstAction);
});

test('users bulk selection', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/users');
  await page.getByRole('checkbox', { name: 'Select nattapat' }).check();
  await page.getByRole('checkbox', { name: 'Select ploy.s' }).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await settle(page);
  await shot(page, 'users-bulk');
});

test('user edit drawer', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'nattapat' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Edit nattapat' })).toBeVisible();
  await waitForStableUi(page);
  await shot(page, 'user-edit-drawer');
});

test('batch create result', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Create users' }).click();
  const drawer = page.getByRole('dialog', { name: 'Create users' });
  await drawer.getByLabel('Username prefix').fill('m43_');
  await drawer.getByLabel('How many').fill('3');
  await drawer.getByRole('button', { name: 'Create 3 users' }).click();
  await expect(page.getByRole('dialog', { name: 'Created 3 users' })).toBeVisible();
  await waitForStableUi(page);
  await shot(page, 'batch-result');
});

for (const theme of ['light', 'dark'] as const) {
  test(`problems (${theme})`, async ({ page }) => {
    if (theme === 'dark') await dark(page);
    await mockManageApi(page);
    await page.goto('/admin/problems');
    await expect(page.getByText('Interval merge').first()).toBeVisible();
    await settle(page);
    await shot(page, theme === 'dark' ? 'problems-dark' : 'problems');
  });

  test(`settings (${theme})`, async ({ page }) => {
    if (theme === 'dark') await dark(page);
    await mockManageApi(page);
    await page.goto('/admin/settings');
    await expect(page.getByRole('switch', { name: 'Registration' })).toBeChecked();
    await settle(page);
    await shot(page, theme === 'dark' ? 'settings-dark' : 'settings');
  });
}

test('problem editor, General', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/problems/interval');
  await expect(page.getByLabel('Title')).toHaveValue('Interval merge');
  await expect(page.getByText('Type locked · 214 submissions.')).toBeVisible();
  await settle(page);
  await shot(page, 'problem-general');

  // Ported from the old modal spec: the type control keeps its own quiet look inside a form.
  const header = page.getByRole('group', { name: 'Problem type' }).getByRole('button', { name: 'Header' });
  expect(await header.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await header.evaluate((node) => getComputedStyle(node).fontSize)).toBe('14px');
});

test('problem editor, replace testcases confirm', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/problems/interval/testcases');
  await expect(page.getByText('10 testcases · 2.0 MB')).toBeVisible();
  const names = Array.from({ length: 12 }, (_, i) => [`${i + 1}.in`, `${i + 1}.out`]).flat();
  await page.locator('input[type="file"]').setInputFiles({ name: 'week12.zip', mimeType: 'application/zip', buffer: zipWithNames(names) });
  await expect(page.getByRole('dialog', { name: 'Replace 10 testcases with 12?' })).toBeVisible();
  await waitForStableUi(page);
  await shot(page, 'problem-testcases-confirm');
});

test('contests', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/contests');
  await expect(page.getByText('Running · 1:12:08 left').first()).toBeVisible();
  await settle(page);
  await shot(page, 'contests');
});

test('contest create drawer', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/contests');
  await page.getByRole('button', { name: 'New contest' }).click();
  const drawer = page.getByRole('dialog', { name: 'New contest' });
  await drawer.getByLabel('Title').fill('Weekly 13');
  await drawer.getByLabel('Start date').fill('2026-09-27');
  await drawer.getByLabel('Start time').fill('19:00');
  await expect(drawer.getByText('Ends Sun 27 Sept, 21:00')).toBeVisible();
  await waitForStableUi(page);
  await shot(page, 'contest-create');
});

test('contest editor, Problems', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/contests/7/problems');
  await expect(page.getByText('Interval cover')).toBeVisible();
  await settle(page);
  await shot(page, 'contest-problems');
  const trigger = page.getByRole('button', { name: 'More actions for interval2' });
  await focusByKeyboard(page, trigger);
  await page.keyboard.press('Enter');
  const moveUp = page.getByRole('menuitem', { name: 'Move up' });
  await expect(moveUp).toBeVisible();
  // Initial menu focus differs between pointer and touch emulation; Home always lands on the first item.
  await page.keyboard.press('Home');
  await expect(moveUp).toBeFocused();
  await expectVisibleFocus(moveUp);
});

test('analysis', async ({ page }) => {
  await mockManageApi(page);
  await page.goto('/admin/analysis');
  await expect(page.getByText('▲ 12% vs prev. 30d')).toBeVisible();
  await settle(page);
  await shot(page, 'analysis');
});

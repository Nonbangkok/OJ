import { expect, test } from '@playwright/test';
import { json, mockAdminApi, waitForStableUi } from './fixtures';

/**
 * The admin problem modal lives inside `.form-container`, whose stylesheet
 * paints EVERY descendant button as a full-width accent action button. A
 * shared primitive dropped in there must keep its own look: the regression
 * this guards is the Problem type SegmentedControl rendering its inactive
 * segment as a blue action button that overflows the control's 2.1rem well.
 */
test('problem type segmented control keeps its own styling inside the form container', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.route('**/api/admin/problems?*', (route) =>
    route.fulfill(
      json({ problems: [], nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false })
    )
  );
  await page.route('**/api/admin/problems', (route) =>
    route.fulfill(
      json({ problems: [], nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false })
    )
  );
  await page.route('**/api/admin/collections', (route) => route.fulfill(json([])));
  await page.route('**/api/admin/authors', (route) => route.fulfill(json([])));

  await page.goto('/admin/problems');
  await page.getByRole('button', { name: '+ New Problem' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Problem' })).toBeVisible();
  await waitForStableUi(page);

  const group = page.getByRole('group', { name: 'Problem type' });
  const standard = group.getByRole('button', { name: 'Standard' });
  const header = group.getByRole('button', { name: 'Header' });

  const [groupBox, standardBox, headerBox] = await Promise.all([
    group.boundingBox(),
    standard.boundingBox(),
    header.boundingBox(),
  ]);
  expect(groupBox).not.toBeNull();
  expect(standardBox).not.toBeNull();
  expect(headerBox).not.toBeNull();

  // Segments stay inside the control's well — the visible symptom was a
  // segment taller than its container, spilling past the rounded border.
  for (const box of [standardBox!, headerBox!]) {
    expect(box.y).toBeGreaterThanOrEqual(groupBox!.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(groupBox!.y + groupBox!.height + 0.5);
  }

  // The inactive segment is quiet, not an accent action button.
  const inactiveBackground = await header.evaluate(
    (node) => getComputedStyle(node).backgroundColor
  );
  expect(inactiveBackground).toBe('rgba(0, 0, 0, 0)');

  // Both segments share the control's own type scale (0.875rem), not the
  // 1rem action-button scale.
  for (const segment of [standard, header]) {
    expect(await segment.evaluate((node) => getComputedStyle(node).fontSize)).toBe('14px');
  }

  // Selecting Header moves the active styling and reveals the filename field.
  await header.click();
  await expect(header).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Submission filename')).toBeVisible();
  const activeBackground = await header.evaluate(
    (node) => getComputedStyle(node).backgroundColor
  );
  expect(activeBackground).not.toBe('rgba(0, 0, 0, 0)');
});

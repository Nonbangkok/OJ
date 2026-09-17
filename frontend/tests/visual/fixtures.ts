import type { Page } from '@playwright/test';

const fixedTime = new Date('2026-09-16T09:00:00+07:00');

const drafts = [
  {
    id: 'draft-20260916-01',
    revision: 4,
    verifiedRevision: 4,
    status: 'draft',
    hasLatestPdf: false,
    latestPdfRevision: null,
    hasAuthorProfileImage: false,
    updatedAt: '2026-09-16T02:00:00.000Z',
    publishedAt: null,
    problemId: 'international-marathon-route',
    title: 'International Marathon Route Reconstruction',
    authorProfileId: 'profile-international',
    authorAkaName: 'International Algorithmic Marathon Author',
    authorRealName: 'Dr. Alexandria International-Longname von Algorithmus',
    language: 'English',
    countryCode: 'THA',
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    statementHtml: '<p>Deterministic visual fixture.</p>',
    solutionCpp: '#include <bits/stdc++.h>\nint main() { return 0; }',
    generatorCpp: null,
    templateVersion: 'red-gate-v1',
  },
  {
    id: 'draft-20260916-02',
    revision: 7,
    verifiedRevision: 7,
    status: 'ready',
    hasLatestPdf: true,
    latestPdfRevision: 7,
    hasAuthorProfileImage: false,
    updatedAt: '2026-09-16T02:10:00.000Z',
    publishedAt: null,
    problemId: 'stable-scheduling',
    title: 'Stable Scheduling Across Time Zones',
    authorProfileId: 'profile-precision',
    authorAkaName: 'Precision Scheduling Collective',
    authorRealName: 'Professor Beatrice Deterministic Fixture',
    language: 'Thai',
    countryCode: 'THA',
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    statementHtml: '<p>Second deterministic visual fixture.</p>',
    solutionCpp: '#include <iostream>\nint main() { return 0; }',
    generatorCpp: '#include <iostream>\nint main() { return 0; }',
    templateVersion: 'red-gate-v1',
  },
];

const profiles = [
  {
    id: 'profile-international',
    userId: 701,
    akaName: 'International Algorithmic Marathon Author',
    realName: 'Dr. Alexandria International-Longname von Algorithmus',
    defaultLanguage: 'English',
    countryCode: 'THA',
    hasProfileImage: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-16T02:00:00.000Z',
  },
  {
    id: 'profile-precision',
    userId: null,
    akaName: 'Precision Scheduling Collective With Deliberately Long Attribution',
    realName: 'Professor Beatrice Deterministic Fixture for Cross-Viewport Regression Coverage',
    defaultLanguage: 'Thai',
    countryCode: 'THA',
    hasProfileImage: false,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-16T02:10:00.000Z',
  },
];

function json(body: unknown) {
  return {
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

export async function mockAdminApi(page: Page): Promise<void> {
  await page.clock.setFixedTime(fixedTime);

  // Playwright uses the last matching route, so register this safety net first.
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 404,
      ...json({ message: `Unhandled visual fixture: ${route.request().url()}` }),
    })
  );
  await page.route('**/api/me', (route) =>
    route.fulfill(
      json({
        isAuthenticated: true,
        user: { id: 1, username: 'author.admin', role: 'admin' },
      })
    )
  );
  await page.route('**/api/admin/authoring/drafts', (route) => route.fulfill(json(drafts)));
  await page.route('**/api/admin/author-profiles', (route) => route.fulfill(json(profiles)));
}

export async function waitForStableUi(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
}

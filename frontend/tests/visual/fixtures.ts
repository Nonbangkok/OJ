import { expect, type Locator, type Page } from '@playwright/test';

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
    testcaseStats: { total: 2, withOutput: 2 },
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
    testcaseStats: { total: 2, withOutput: 2 },
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

export function json(body: unknown) {
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
  // ProblemAuthoring also loads the "My drafts" list up front. The backend
  // matches the username to an Author Profile AKA; 'author.admin' matches none.
  await page.route('**/api/admin/authoring/drafts?scope=mine', (route) => route.fulfill(json([])));
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

export async function focusByKeyboard(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 80; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Keyboard navigation did not reach the expected target');
}

export async function expectVisibleFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const indication = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
  expect(
    (indication.outlineStyle !== 'none' && indication.outlineWidth !== '0px') ||
      indication.boxShadow !== 'none'
  ).toBe(true);
}

const studentProblems = [
  { id: 'hp_vec04_erase', title: 'vector::erase', author: 'Ada', categories: ['Data Structures'], difficulty: 1200,
    best_score: 60, submission_count: '3', latest_submission_at: '2026-09-16T00:00:00.000Z',
    latest_submission_status: 'Wrong Answer', best_submission_status: 'Wrong Answer',
    best_submission_results: [...Array(6).fill({ status: 'Accepted' }), { status: 'Wrong Answer' }, ...Array(3).fill({ status: 'Skipped' })] },
  { id: 'queue_rotate', title: 'Queue rotate', author: 'Ada', categories: ['Data Structures'], difficulty: 900,
    best_score: 100, submission_count: '1', latest_submission_at: '2026-09-15T08:00:00.000Z',
    latest_submission_status: 'Accepted', best_submission_status: 'Accepted',
    best_submission_results: Array(10).fill({ status: 'Accepted' }) },
  { id: 'two_sum_sorted', title: 'Two sum (sorted)', author: 'Ben', categories: ['Greedy'], difficulty: 1000,
    best_score: 80, submission_count: '2', latest_submission_at: '2026-09-14T08:00:00.000Z',
    latest_submission_status: 'Time Limit Exceeded', best_submission_status: 'Time Limit Exceeded',
    best_submission_results: [...Array(8).fill({ status: 'Accepted' }), { status: 'Time Limit Exceeded' }, { status: 'Skipped' }] },
  { id: 'bfs_grid', title: 'BFS on a grid', author: 'Ben', categories: ['Graph'], difficulty: 1400,
    best_score: null, submission_count: null, latest_submission_at: null, latest_submission_status: null,
    best_submission_status: null, best_submission_results: null },
];

const ref = (id: string, title: string, difficulty: number, xp: number) => ({ id, title, difficulty, xp });

const homeSummary = {
  progression: { totalXp: 1940, level: 5, tier: 'Apprentice',
    levelProgress: { current: 340, required: 500, remaining: 160, percentage: 68 }, globalRank: 214 },
  currentStreak: 5,
  solvedToday: false,
  week: ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']
    .map((day, i) => ({ day, solved: [1, 4, 0, 2, 6, 1, 0][i] })),
  continue: { ...ref('hp_vec04_erase', 'vector::erase', 1200, 33), bestScore: 60, attempts: 3,
    lastTriedAt: '2026-09-16T00:00:00.000Z', latestStatus: 'Wrong Answer',
    caseStatuses: [...Array(6).fill('Accepted'), 'Wrong Answer', 'Skipped', 'Skipped', 'Skipped'] },
  startWith: [],
  collections: [
    { id: 2, name: 'pair', solved: 9, total: 10, next: ref('pair_ord', 'pair ordering', 900, 24) },
    { id: 3, name: 'vector', solved: 3, total: 10, next: ref('vec_at', 'vector::at', 1600, 60) },
    { id: 4, name: 'stack / queue', solved: 0, total: 10, next: ref('stack_min', 'Min stack', 1000, 28) },
  ],
  levelUp: { remaining: 160, problem: ref('big_one', 'Range minimum', 2400, 104) },
};

const problemDetail = {
  id: 'hp_vec04_erase', title: 'vector::erase', author: 'Ada', difficulty: 1200, categories: ['Data Structures'],
  time_limit_ms: 1000, memory_limit_mb: 256, has_pdf: true, problem_type: 'standard',
  submission_filename: null, has_starter_files: false,
  collection: { id: 3, name: 'vector' },
  viewerBest: { score: 60, caseStatuses: [...Array(6).fill('Accepted'), 'Wrong Answer', 'Skipped', 'Skipped', 'Skipped'] },
  viewerSubmissionCount: 3,
};

const submissionDetail = {
  id: 48213, username: 'nattapat', problem_id: 'hp_vec04_erase', problem_title: 'vector::erase',
  overall_status: 'Wrong Answer', score: 60, language: 'cpp', submitted_at: '2026-09-16T01:58:00.000Z',
  code: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n; cin >> n;\n    vector<int> a(n);\n    for (auto &x : a) cin >> x;\n    a.erase(a.begin() + n / 2);\n    for (int x : a) cout << x << " ";\n}\n',
  max_time_ms: 410, max_memory_kb: 12595, time_limit_ms: 1000, memory_limit_mb: 256,
  results: [
    ...[30, 40, 110, 190, 270, 330].map((timeMs, i) => ({ testCase: i + 1, status: 'Accepted', timeMs, memoryKb: 3900 + i * 1500 })),
    { testCase: 7, status: 'Wrong Answer', timeMs: 410, memoryKb: 12595 },
    { testCase: 8, status: 'Skipped' }, { testCase: 9, status: 'Skipped' }, { testCase: 10, status: 'Skipped' },
  ],
};

/** A signed-in student ("nattapat") with the phase 3 endpoints mocked. */
export async function mockStudentApi(page: Page): Promise<void> {
  await page.clock.setFixedTime(fixedTime);
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, ...json({ message: `Unhandled visual fixture: ${route.request().url()}` }) }));
  await page.route('**/api/me', (route) =>
    route.fulfill(json({ isAuthenticated: true, user: { id: 7, username: 'nattapat', role: 'user', tier: 'Apprentice', level: 5 } })));
  await page.route('**/api/site-config', (route) =>
    route.fulfill(json({ accessMode: 'public', allowRegistration: true, passwordChangeEnabled: true })));
  await page.route('**/api/me/home', (route) => route.fulfill(json(homeSummary)));
  await page.route('**/api/contests', (route) => route.fulfill(json([])));
  await page.route(/\/api\/problems-with-stats/, (route) =>
    route.fulfill(json({ problems: studentProblems, nextCursor: null, hasMore: false })));
  await page.route(/\/api\/problem-status-counts/, (route) =>
    route.fulfill(json({ all: 142, unsolved: 97, attempted: 7, solved: 38 })));
  await page.route('**/api/problems/categories', (route) =>
    route.fulfill(json({ categories: [{ name: 'Data Structures', count: 40 }, { name: 'Graph', count: 30 }, { name: 'Greedy', count: 20 }], uncategorized: 2, total: 142 })));
  await page.route('**/api/problems/filter-options', (route) =>
    route.fulfill(json({ collections: [{ id: 2, name: 'pair' }, { id: 3, name: 'vector' }], hasUncollected: true })));
  await page.route('**/api/problems/hp_vec04_erase', (route) => route.fulfill(json(problemDetail)));
  await page.route('**/api/problems/hp_vec04_erase/pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<body style="font:14px sans-serif;padding:24px">Statement preview</body>' }));
  await page.route(/\/api\/submissions\/48213/, (route) => route.fulfill(json(submissionDetail)));
}

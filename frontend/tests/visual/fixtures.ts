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

const strip = (passed: number, failed: string | null, total = 10) => [
  ...Array(passed).fill('Accepted'), ...(failed ? [failed] : []),
  ...Array(Math.max(0, total - passed - (failed ? 1 : 0))).fill('Skipped'),
];

const submissionList = [
  { id: 48213, username: 'nattapat', problem_id: 'hp_vec04_erase', problem_title: 'vector::erase', overall_status: 'Wrong Answer',
    score: 60, language: 'cpp', submitted_at: '2026-09-16T01:58:00.000Z', case_statuses: strip(6, 'Wrong Answer'), max_time_ms: 410, max_memory_kb: 12595 },
  { id: 48190, username: 'nattapat', problem_id: 'queue_rotate', problem_title: 'Queue rotate', overall_status: 'Accepted',
    score: 100, language: 'cpp', submitted_at: '2026-09-15T08:00:00.000Z', case_statuses: strip(10, null), max_time_ms: 120, max_memory_kb: 3400 },
  { id: 48155, username: 'nattapat', problem_id: 'two_sum_sorted', problem_title: 'Two sum (sorted)', overall_status: 'Time Limit Exceeded',
    score: 80, language: 'python', submitted_at: '2026-09-14T08:00:00.000Z', case_statuses: strip(8, 'Time Limit Exceeded'), max_time_ms: 4000, max_memory_kb: 9800 },
  { id: 48101, username: 'nattapat', problem_id: 'bfs_grid', problem_title: 'BFS on a grid', overall_status: 'Compilation Error',
    score: 0, language: 'cpp', submitted_at: '2026-09-13T08:00:00.000Z', case_statuses: ['Compilation Error'], max_time_ms: null, max_memory_kb: null },
];

const rankingRows = [
  ['ploy', 9120, 214, 10, 'Expert'], ['krit', 8800, 201, 10, 'Expert'], ['mint', 8800, 199, 10, 'Expert'],
  ['tonkla', 7310, 180, 9, 'Specialist'], ['fah', 6400, 160, 9, 'Specialist'], ['bank', 5100, 141, 8, 'Specialist'],
  ['jane', 4300, 120, 7, 'Apprentice'], ['pete', 3900, 101, 7, 'Apprentice'],
].map(([username, xp, solved, level, tier], i) => ({
  rank: i === 2 ? 2 : i + 1, username, hasAvatar: false, xp, solved, level, tier,
}));

const ranking = {
  rows: rankingRows, total: 412, page: 1, pageSize: 50, window: 'all',
  viewer: { rank: 214, username: 'nattapat', hasAvatar: false, xp: 1940, solved: 38, level: 5, tier: 'Apprentice' },
};

const categoryStats = [
  ['Data Structures', 14, 40], ['Graph', 6, 30], ['Greedy', 9, 20], ['Dynamic Programming', 3, 25],
  ['Math', 4, 12], ['Sorting', 2, 6],
].map(([category, solved, total]) => ({
  category, solved, total, percentage: Math.round(((solved as number) / (total as number)) * 1000) / 10,
}));

const dailyActivity = Array.from({ length: 120 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 8, 16) - i * 86_400_000).toISOString().slice(0, 10);
  return { day, count: [0, 2, 1, 0, 4, 0, 3, 1, 0, 0, 6, 2][i % 12] };
}).filter((d) => d.count > 0);

const profile = {
  id: 7, username: 'nattapat', role: 'user', hasAvatar: false, avatarUpdatedAt: null, createdAt: '2026-06-01T00:00:00.000Z',
  problemsAttempted: 45, problemsSolved: 38, totalScore: 4120, submissionCount: 162,
  verdictCounts: { Accepted: 70, 'Wrong Answer': 60, 'Time Limit Exceeded': 20, 'Compilation Error': 12 },
  languageCounts: { cpp: 140, python: 22 },
  dailyActivity, currentStreak: 5, longestStreak: 12, lastAcDate: '2026-09-15',
  categoryStats,
  achievements: {
    unlocked: [
      { id: 'first_solve', name: 'First solve', description: 'Solve your first problem.' },
      { id: 'ten_solves', name: 'Ten solved', description: 'Solve 10 problems.' },
      { id: 'streak_7', name: 'Week streak', description: 'Solve on 7 days in a row.' },
    ],
    stats: { problemsSolved: 38, currentStreak: 5, longestStreak: 12, languagesSolvedIn: { cpp: 38 }, contestsJoined: 0 },
  },
  progression: homeSummary.progression,
  recentRewards: [
    { problemId: 'queue_rotate', problemTitle: 'Queue rotate', xpAwarded: 24, difficultySnapshot: 900, awardedAt: '2026-09-15T08:00:00.000Z' },
    { problemId: 'pair_swap', problemTitle: 'pair swap', xpAwarded: 20, difficultySnapshot: 800, awardedAt: '2026-09-14T08:00:00.000Z' },
  ],
};

/** A signed-out visitor on a public Grader. */
export async function mockGuestApi(page: Page): Promise<void> {
  await page.clock.setFixedTime(fixedTime);
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, ...json({ message: `Unhandled visual fixture: ${route.request().url()}` }) }));
  await page.route('**/api/me', (route) => route.fulfill(json({ isAuthenticated: false })));
  await page.route('**/api/site-config', (route) =>
    route.fulfill(json({ accessMode: 'public', allowRegistration: true, passwordChangeEnabled: true })));
  await page.route('**/api/contests', (route) => route.fulfill(json([])));
  await page.route(/\/api\/problems-with-stats/, (route) =>
    route.fulfill(json({ problems: studentProblems.map((p) => ({ ...p, best_score: null, submission_count: null,
      latest_submission_at: null, latest_submission_status: null, best_submission_status: null, best_submission_results: null })),
    nextCursor: null, hasMore: false })));
}

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
  await page.route(/\/api\/submissions(\?|$)/, (route) => route.fulfill(json(submissionList)));
  await page.route(/\/api\/submissions\/48213/, (route) => route.fulfill(json(submissionDetail)));
  await page.route(/\/api\/scoreboard/, (route) => route.fulfill(json(ranking)));
  await page.route('**/api/users/nattapat/profile', (route) => route.fulfill(json(profile)));
}

type ContestState = 'list' | 'scheduled' | 'running-guest' | 'running' | 'finishing' | 'finished';

const contestStatuses = (s: string) => [...s].map((c) => ({ status: c === 'P' ? 'Accepted' : c === 'F' ? 'Wrong Answer' : c === 'T' ? 'Time Limit Exceeded' : 'Skipped' }));
const contestProblems = [
  { id: 'sum_digits', title: 'Sum of digits', best_score: 100, submission_count: '1', best_submission_results: contestStatuses('PPPPPPPPPP') },
  { id: 'queue_rotate', title: 'Queue rotate', best_score: 100, submission_count: '3', best_submission_results: contestStatuses('PPPPPPPPPP') },
  { id: 'interval', title: 'Interval merge', best_score: 60, submission_count: '4', best_submission_results: contestStatuses('PPPPPPFNNN') },
  { id: 'detour', title: 'Shortest detour', best_score: 40, submission_count: '2', best_submission_results: contestStatuses('PPPPTNNNNN') },
  { id: 'matrix', title: 'Matrix exponent', best_score: null, submission_count: '0', best_submission_results: null },
];

const at = (minutes: number) => new Date(fixedTime.getTime() + minutes * 60_000).toISOString();

const contestFor = (state: ContestState) => {
  const base = { id: 1, title: 'Mid-term practice', description: null, participant_count: '86', problem_count: 5, is_visible: true };
  const problems = contestProblems.map(({ id, title }) => ({ id, title }));
  switch (state) {
    case 'scheduled':
      return { ...base, title: 'Weekly round #19', status: 'scheduled', start_time: at(4 * 1440 + 372), end_time: at(4 * 1440 + 492), is_participant: false, problem_count: 6, problems: [] };
    case 'running-guest':
      return { ...base, status: 'running', start_time: at(-60), end_time: at(72), is_participant: false, problems: [] };
    case 'finishing':
      return { ...base, status: 'finishing', start_time: at(-180), end_time: at(-1), is_participant: true, problems };
    case 'finished':
      return { ...base, title: 'Weekly round #18', status: 'finished', start_time: at(-4 * 1440), end_time: at(-4 * 1440 + 120), is_participant: true, participant_count: '74', problems };
    default:
      return { ...base, status: 'running', start_time: at(-60), end_time: at(72), is_participant: true, problems };
  }
};

const standing = (username: string, rank: number, scores: Array<[string, number, number, string, number]>) => {
  const detailed = Object.fromEntries(scores.map(([id, score, attempts, strip, minute]) => [id, { score, attempts, best_at: at(-60 + minute), statuses: contestStatuses(strip).map((s) => s.status) }]));
  const total = scores.reduce((sum, [, score]) => sum + score, 0);
  const last = scores.length ? Math.max(...scores.map(([, score, , , minute]) => (score > 0 ? minute : 0))) : 1;
  return { user_id: rank, username, has_avatar: false, rank, total_score: total, detailed_scores: detailed, last_score_improvement_time: at(-60 + last) };
};

const contestStandings = [
  standing('ploy', 1, [['sum_digits', 100, 1, 'PPPPPPPPPP', 8], ['queue_rotate', 100, 2, 'PPPPPPPPPP', 21], ['interval', 100, 3, 'PPPPPPPPPP', 47], ['detour', 60, 2, 'PPPPPPFNNN', 55]]),
  standing('krit', 2, [['sum_digits', 100, 1, 'PPPPPPPPPP', 6], ['queue_rotate', 100, 1, 'PPPPPPPPPP', 18], ['interval', 100, 2, 'PPPPPPPPPP', 52], ['detour', 40, 1, 'PPPPTNNNNN', 58]]),
  standing('nattapat', 3, [['sum_digits', 100, 1, 'PPPPPPPPPP', 9], ['queue_rotate', 100, 3, 'PPPPPPPPPP', 30], ['interval', 60, 4, 'PPPPPPFNNN', 44], ['detour', 40, 2, 'PPPPTNNNNN', 50]]),
  standing('mint', 4, [['sum_digits', 100, 1, 'PPPPPPPPPP', 12], ['queue_rotate', 100, 4, 'PPPPPPPPPP', 33], ['interval', 60, 2, 'PPPPPPFNNN', 40]]),
  standing('tonkla', 5, [['sum_digits', 100, 2, 'PPPPPPPPPP', 15], ['interval', 0, 3, 'FNNNNNNNNN', 20]]),
  standing('fah', 6, []),
];

/** A signed-in student on the contest pages, with contest 1 in the given state. */
export async function mockContestApi(page: Page, state: ContestState): Promise<void> {
  await mockStudentApi(page);
  const contest = contestFor(state);
  const list = [
    contestFor('running'),
    { ...contestFor('scheduled'), id: 19, is_participant: true, participant_count: '12' },
    { ...contestFor('scheduled'), id: 20, title: 'Graph camp selection', start_time: at(12 * 1440), end_time: at(12 * 1440 + 300), participant_count: '0', problem_count: 8 },
    { ...contestFor('finished'), id: 18 },
    { ...contestFor('finished'), id: 17, title: 'Sorting sprint', start_time: at(-10 * 1440), end_time: at(-10 * 1440 + 90), participant_count: '58', problem_count: 4 },
  ];
  await page.route('**/api/contests', (route) => route.fulfill(json(state === 'list' ? list : [contest])));
  await page.route('**/api/contests/1', (route) => route.fulfill(json(contest)));
  await page.route('**/api/contests/1/problems', (route) => route.fulfill(json(contest.is_participant ? contestProblems : [])));
  await page.route('**/api/contests/1/scoreboard', (route) => route.fulfill(json(
    state === 'scheduled'
      ? { scoreboard: ['nattapat', 'ploy.s', 'tonkla', 'mintra', 'phum_k', 'jirat', 'kanok', 'beam', 'fah', 'oat', 'ice', 'pim'].map((username, i) => ({ user_id: i + 1, username, total_score: 0, detailed_scores: {} })), problems: [], status: 'scheduled', start_time: contest.start_time }
      : { scoreboard: contestStandings, problems: contestProblems.map(({ id, title }) => ({ problem_id: id, title })), status: contest.status, start_time: contest.start_time },
  )));
  await page.route('**/api/contests/1/problems/interval', (route) => route.fulfill(json({
    id: 'interval', title: 'Interval merge', author: 'Ada', time_limit_ms: 1000, memory_limit_mb: 256, has_pdf: false,
    problem_type: 'standard', submission_filename: null, has_starter_files: false,
  })));
}

import { expect, type Locator, type Page } from '@playwright/test';

const fixedTime = new Date('2026-09-16T09:00:00+07:00');

// B7 draft list rows (with readiness) for the Authoring hub.
const job = (status: string, revision: number) => ({ status, revision });
const drafts = [
  {
    id: 'd-bfs', problemId: 'hp_graph_bfs', title: 'Shortest hops', authorProfileId: 'profile-ada', authorAkaName: 'Ada',
    status: 'generated', revision: 14, verifiedRevision: 12, createdBy: 1,
    createdAt: '2026-09-01T02:00:00.000Z', updatedAt: '2026-09-16T01:40:00.000Z', publishedAt: null,
    readiness: {
      hasStatement: true, hasSolution: true, hasGenerator: true, testcases: { total: 24, withOutput: 24 }, latestPdfRevision: 12,
      latestJobs: { compile_solution: job('succeeded', 14), build_pdf: job('succeeded', 12), verify_all: job('failed', 12) },
      activeJob: false,
    },
  },
  {
    id: 'd-sched', problemId: 'stable-scheduling', title: 'Stable Scheduling Across Time Zones', authorProfileId: 'profile-precision',
    authorAkaName: 'Precision Scheduling Collective With Deliberately Long Attribution',
    status: 'ready', revision: 7, verifiedRevision: 7, createdBy: 1,
    createdAt: '2026-09-02T02:00:00.000Z', updatedAt: '2026-09-15T08:10:00.000Z', publishedAt: null,
    readiness: {
      hasStatement: true, hasSolution: true, hasGenerator: false, testcases: { total: 12, withOutput: 12 }, latestPdfRevision: 7,
      latestJobs: { compile_solution: job('succeeded', 7), build_pdf: job('succeeded', 7), verify_all: job('succeeded', 7) },
      activeJob: false,
    },
  },
  {
    id: 'd-route', problemId: 'international-marathon-route', title: 'International Marathon Route Reconstruction',
    authorProfileId: 'profile-international', authorAkaName: 'International Algorithmic Marathon Author',
    status: 'published', revision: 4, verifiedRevision: 4, createdBy: 2,
    createdAt: '2026-08-20T02:00:00.000Z', updatedAt: '2026-09-10T02:00:00.000Z', publishedAt: '2026-09-10T02:00:00.000Z',
    readiness: {
      hasStatement: true, hasSolution: true, hasGenerator: true, testcases: { total: 30, withOutput: 30 }, latestPdfRevision: 4,
      latestJobs: { compile_solution: job('succeeded', 4), build_pdf: job('succeeded', 4), verify_all: job('succeeded', 4) },
      activeJob: false,
    },
  },
  {
    id: 'd-sum', problemId: 'sum_two', title: 'Sum of two', authorProfileId: null, authorAkaName: 'author.admin',
    status: 'draft', revision: 1, verifiedRevision: null, createdBy: 1,
    createdAt: '2026-09-16T00:30:00.000Z', updatedAt: '2026-09-16T00:30:00.000Z', publishedAt: null,
    readiness: {
      hasStatement: false, hasSolution: false, hasGenerator: false, testcases: { total: 0, withOutput: 0 }, latestPdfRevision: null,
      latestJobs: {}, activeJob: false,
    },
  },
];

// B8 profile list rows (drafts using each profile, the linked account).
const profiles = [
  {
    id: 'profile-ada', userId: 12, akaName: 'Ada', realName: 'Ada Lovelace', defaultLanguage: 'Thai', countryCode: 'THA',
    hasProfileImage: false, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-09-14T02:00:00.000Z',
    draftCount: 1, linkedUsername: 'ada.l',
  },
  {
    id: 'profile-international', userId: 701, akaName: 'International Algorithmic Marathon Author',
    realName: 'Dr. Alexandria International-Longname von Algorithmus', defaultLanguage: 'English', countryCode: 'THA',
    hasProfileImage: false, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-16T02:00:00.000Z',
    draftCount: 1, linkedUsername: 'alexandria.longname',
  },
  {
    id: 'profile-precision', userId: null, akaName: 'Precision Scheduling Collective With Deliberately Long Attribution',
    realName: 'Professor Beatrice Deterministic Fixture for Cross-Viewport Regression Coverage', defaultLanguage: 'Thai',
    countryCode: 'THA', hasProfileImage: false, createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-16T02:10:00.000Z',
    draftCount: 1, linkedUsername: null,
  },
];

// The workspace draft (rev 14): verified at 12, PDF from 12, a failed verify at 12.
const statementHtml = [
  '<h2>Shortest hops</h2>',
  '<p>A city has <b>n</b> intersections and <b>m</b> one-way roads. Find the fewest roads from intersection 1 to every other intersection.</p>',
  '<h3>Input</h3>',
  '<p>The first line holds n and m (1 ≤ n, m ≤ 200000). Each of the next m lines holds a road a → b.</p>',
  '<h3>Output</h3>',
  '<p>Print n numbers: the fewest roads to each intersection, or -1 when it cannot be reached.</p>',
].join('\n');
const solutionCpp = [
  '#include <bits/stdc++.h>',
  'using namespace std;',
  '',
  'int main() {',
  '  int n, m;',
  '  cin >> n >> m;',
  '  vector<vector<int>> g(n + 1);',
  '  for (int i = 0; i < m; i++) { int a, b; cin >> a >> b; g[a].push_back(b); }',
  '  vector<int> d(n + 1, -1);',
  '  queue<int> q; q.push(1); d[1] = 0;',
  '  while (!q.empty()) {',
  '    int u = q.front(); q.pop();',
  '    for (int v : g[u]) if (d[v] < 0) { d[v] = d[u] + 1; q.push(v); }',
  '  }',
  '  for (int i = 1; i <= n; i++) cout << d[i] << " \\n"[i == n];',
  '}',
].join('\n');
const workspaceDraft = {
  id: 'd-bfs', problemId: 'hp_graph_bfs', title: 'Shortest hops', authorProfileId: 'profile-ada', authorAkaName: 'Ada',
  authorRealName: 'Ada Lovelace', language: 'Thai', countryCode: 'THA', categories: ['Graph'], difficulty: 1600,
  timeLimitMs: 1000, memoryLimitMb: 256, statementHtml, solutionCpp,
  generatorCpp: '#include <bits/stdc++.h>\nint main(int argc, char** argv) {\n  std::mt19937 rng(std::stoi(argv[1]));\n  std::cout << 5 << " " << 4 << "\\n";\n}',
  templateVersion: 'red-gate-v1', revision: 14, verifiedRevision: 12, hasLatestPdf: true, latestPdfRevision: 12,
  status: 'generated', publishedAt: null, hasAuthorProfileImage: false, updatedAt: '2026-09-16T01:40:00.000Z',
  testcaseStats: { total: 24, withOutput: 24 },
};
const workspaceJob = (over: Record<string, unknown>) => ({
  draftId: 'd-bfs', errorCode: null, errorMessage: null, resultSummary: null, ...over,
});
export const workspaceJobs = [
  workspaceJob({ id: 'j-compile', jobType: 'compile_solution', status: 'succeeded', draftRevision: 14, createdAt: '2026-09-16T01:38:00.000Z',
    resultSummary: { durationMs: 1800, warnings: [] }, log: 'g++ -std=c++20 -O2 solution.cpp\n' }),
  workspaceJob({ id: 'j-outputs', jobType: 'generate_outputs', status: 'succeeded', draftRevision: 13, createdAt: '2026-09-16T01:20:00.000Z' }),
  workspaceJob({ id: 'j-verify', jobType: 'verify_all', status: 'failed', draftRevision: 12, createdAt: '2026-09-16T01:05:00.000Z',
    errorCode: 'wrong_answer', errorMessage: 'output mismatch on case 7',
    resultSummary: {
      failedCase: { caseNumber: 7, durationMs: 41 },
      verification: {
        checks: { solution_compiles: 'passed', outputs_match: 'failed', pdf_current: 'passed' }, caseCount: 24,
        totalTestcaseBytes: 3_100_008, memoryLimitMb: 256, peakMemoryBytes: null, warnings: [],
        cases: Array.from({ length: 7 }, (_, i) => ({ caseId: `c${i + 1}`, caseNumber: i + 1, durationMs: 18 + i * 3 })),
      },
    },
    log: 'case 1 ok 18 ms\ncase 2 ok 21 ms\ncase 3 ok 24 ms\ncase 4 ok 27 ms\ncase 5 ok 30 ms\ncase 6 ok 33 ms\ncase 7 wrong answer: expected "3 4 -1", got "3 4 5"\n' }),
  workspaceJob({ id: 'j-pdf', jobType: 'build_pdf', status: 'succeeded', draftRevision: 12, createdAt: '2026-09-16T00:58:00.000Z' }),
  workspaceJob({ id: 'j-gen', jobType: 'run_generator', status: 'timed_out', draftRevision: 11, createdAt: '2026-09-15T09:30:00.000Z',
    errorCode: 'generator_timeout', errorMessage: 'The generator ran longer than 10 s' }),
];
const workspaceTestcases = Array.from({ length: 24 }, (_, i) => ({
  id: `c${i + 1}`, caseNumber: i + 1, filename: i === 23 ? 'max_chain_200000.in' : `${String(i + 1).padStart(2, '0')}.in`,
  inputBytes: 100_000, outputBytes: 29_167, hasOutput: true, source: i < 2 ? 'uploaded' : 'generated', sourceRevision: 13,
  createdAt: '2026-09-16T01:20:00.000Z', updatedAt: '2026-09-16T01:20:00.000Z',
}));
const previewShell = '<!doctype html><html><head><style>body{font-family:Georgia,serif;margin:0;padding:32px 40px;color:#1d1d1f;background:#fff;line-height:1.55}h2{margin-top:0}</style></head><body><article id="statement"></article></body></html>';

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

/** mockAdminApi plus a full draft workspace for `d-bfs` (§7.9 visual baselines). */
export async function mockAuthoringApi(page: Page, options: { jobs?: unknown[] } = {}): Promise<void> {
  await mockAdminApi(page);
  const jobs = options.jobs ?? workspaceJobs;
  await page.route('**/api/admin/authoring/profile-syncs', (route) => route.fulfill(json([])));
  await page.route(/\/api\/admin\/author-profiles\/user-candidates/, (route) => route.fulfill(json([
    { id: 12, username: 'ada.l', role: 'staff', linkedProfile: { id: 'profile-ada', akaName: 'Ada' } },
    { id: 31, username: 'adam.k', role: 'user', linkedProfile: null },
  ])));
  await page.route(/\/api\/admin\/authoring\/drafts\/d-bfs(\?|$)/, (route) => route.fulfill(json(workspaceDraft)));
  await page.route('**/api/admin/authoring/drafts/d-bfs/jobs', (route) => route.fulfill(json(jobs)));
  await page.route(/\/api\/admin\/authoring\/jobs\/[^/]+$/, (route) => {
    const id = route.request().url().split('/').pop();
    return route.fulfill(json((jobs as Array<{ id: string }>).find((j) => j.id === id) ?? null));
  });
  await page.route('**/api/admin/authoring/drafts/d-bfs/testcases', (route) =>
    route.fulfill(json({ revision: 14, testcases: workspaceTestcases })));
  await page.route('**/api/admin/authoring/drafts/d-bfs/assets', (route) =>
    route.fulfill(json([{ id: 'a1', filename: 'graph.png', sizeBytes: 84_000 }])));
  await page.route('**/api/admin/authoring/drafts/d-bfs/preview-context', (route) =>
    route.fulfill(json({ html: previewShell, assets: [{ id: 'a1', filename: 'graph.png' }] })));
  await page.route('**/api/admin/authoring/drafts/d-bfs/preview', (route) =>
    route.fulfill(json({ html: `<html><body><article id="statement">${statementHtml}</article></body></html>` })));
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
  { id: 'hp_vec04_erase', title: 'vector::erase', author: 'Ada', categories: ['Data Structures'], difficulty: 1200, problem_type: 'header',
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
  problem_type: 'header', submission_filename: 'student.h',
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

// --- Phase 5 Manage pages ---------------------------------------------------

const manageUsers = [
  { id: 1, username: 'Nonbangkok', role: 'admin', created_at: '2025-06-01T03:00:00Z', submissions_locked: false, last_active_at: '2026-09-16T01:40:00Z', solved_count: 212, xp: 9820, submission_count: 1404 },
  { id: 2, username: 'kru.somchai', role: 'staff', created_at: '2025-08-12T03:00:00Z', submissions_locked: false, last_active_at: '2026-09-15T11:05:00Z', solved_count: 87, xp: 3410, submission_count: 402 },
  { id: 3, username: 'nattapat', role: 'user', created_at: '2026-05-20T03:00:00Z', submissions_locked: false, last_active_at: '2026-09-16T01:58:00Z', solved_count: 41, xp: 1290, submission_count: 233 },
  { id: 4, username: 'ploy.s', role: 'user', created_at: '2026-05-20T03:00:00Z', submissions_locked: true, last_active_at: '2026-09-09T08:30:00Z', solved_count: 18, xp: 470, submission_count: 96 },
  { id: 5, username: 'tonkla', role: 'user', created_at: '2026-06-02T03:00:00Z', submissions_locked: false, last_active_at: null, solved_count: 0, xp: 0, submission_count: 0 },
  { id: 6, username: 'm42_07', role: 'user', created_at: '2026-09-01T03:00:00Z', submissions_locked: false, last_active_at: '2026-09-14T02:10:00Z', solved_count: 6, xp: 150, submission_count: 31 },
];

const manageProblems = [
  { id: 'interval', title: 'Interval merge', author: 'Ada', categories: ['Sorting'], difficulty: 1400, collection_id: 2, collection_name: 'Sorting basics', is_visible: true, contest_id: null, contest_status: null, problem_type: 'standard', time_limit_ms: 1000, memory_limit_mb: 256, testcase_count: 10, testcase_bytes: 2_400_000, submission_count: 214, type_locked: true, has_pdf: true, has_grader: false, accepted_count: 87, solver_count: 41 },
  { id: 'hp_vec04_erase', title: 'Vector erase', author: 'Ada', categories: ['Implementation'], difficulty: 1200, collection_id: null, collection_name: null, is_visible: true, contest_id: null, contest_status: null, problem_type: 'header', time_limit_ms: 1000, memory_limit_mb: 256, testcase_count: 10, testcase_bytes: 51_200, submission_count: 38, type_locked: true, has_pdf: true, has_grader: true, accepted_count: 9, solver_count: 7 },
  { id: 'twosum', title: 'Two sums', author: 'kru.somchai', categories: ['Two Pointers'], difficulty: 1100, collection_id: 2, collection_name: 'Sorting basics', is_visible: false, contest_id: null, contest_status: null, problem_type: 'standard', time_limit_ms: 2000, memory_limit_mb: 128, testcase_count: 0, testcase_bytes: 0, submission_count: 0, type_locked: false, has_pdf: false, has_grader: false },
  { id: 'graphwalk', title: 'Graph walk', author: 'Ada', categories: ['Graphs'], difficulty: 1800, collection_id: null, collection_name: null, is_visible: false, contest_id: 7, contest_status: 'scheduled', problem_type: 'standard', time_limit_ms: 1500, memory_limit_mb: 256, testcase_count: 15, testcase_bytes: 4_100_000, submission_count: 0, type_locked: false, has_pdf: true, has_grader: false },
];

const manageContests = [
  { id: 8, title: 'Mid-term practice', description: null, status: 'running', start_time: '2026-09-16T01:00:00Z', end_time: '2026-09-16T03:12:08Z', participant_count: '41', problem_count: 6, is_visible: true },
  { id: 7, title: 'Weekly 12', description: 'Round twelve: sorting and graphs.', status: 'scheduled', start_time: '2026-09-20T12:00:00Z', end_time: '2026-09-20T14:00:00Z', participant_count: '2', problem_count: 3, is_visible: true },
  { id: 5, title: 'Summer camp final', description: null, status: 'finished', start_time: '2026-08-02T03:00:00Z', end_time: '2026-08-02T06:30:00Z', participant_count: '64', problem_count: 8, is_visible: false },
];

const contestSevenProblems = [
  { id: 'graphwalk', title: 'Graph walk', author: 'Ada' },
  { id: 'interval2', title: 'Interval cover', author: 'Ada' },
  { id: 'primes', title: 'Prime sieve', author: 'kru.somchai' },
];

const overviewDay = (day: string, accepted: number, wrong: number, time: number, runtime: number, compilation: number, other = 0) => {
  const total = accepted + wrong + time + runtime + compilation + other;
  return { day, total, accepted, wrong, time, memory: 0, runtime, compilation, other };
};

const overviewAnalytics = {
  kpis: {
    submissions: { current: 1842, previous: 1640 },
    uniqueSubmitters: { current: 96, previous: 101 },
    accepted: { current: 812, previous: 690 },
    newUsers: { current: 14, previous: 9 },
    activeProblems: { current: 58, previous: 58 },
  },
  dailySeries: Array.from({ length: 14 }, (_, i) => overviewDay(
    `2026-09-${String(3 + i).padStart(2, '0')}`, 30 + ((i * 7) % 25), 18 + ((i * 5) % 14), 4 + (i % 5), 2 + (i % 3), 1 + (i % 2), i % 4 === 0 ? 1 : 0,
  )),
  verdictBreakdown: [
    { verdict: 'Accepted', count: 812 }, { verdict: 'Wrong Answer', count: 640 }, { verdict: 'Time Limit Exceeded', count: 201 },
    { verdict: 'Runtime Error', count: 112 }, { verdict: 'Compilation Error', count: 66 }, { verdict: 'Memory Limit Exceeded', count: 11 },
  ],
  topProblems: [
    { problemId: 'interval', title: 'Interval merge', submissions: 214, accepted: 88 },
    { problemId: 'twosum', title: 'Two sums', submissions: 160, accepted: 101 },
    { problemId: 'hp_vec04_erase', title: 'Vector erase', submissions: 38, accepted: 20 },
  ],
  topSubmitters: [
    { userId: 3, username: 'nattapat', submissions: 233, solved: 41 },
    { userId: 4, username: 'ploy.s', submissions: 96, solved: 18 },
    { userId: 6, username: 'm42_07', submissions: 31, solved: 6 },
  ],
  contestStats: [
    { contestId: 8, title: 'Mid-term practice', status: 'running', submissions: 402, participants: 41, avgScore: 212.4 },
    { contestId: 5, title: 'Summer camp final', status: 'finished', submissions: 1290, participants: 64, avgScore: 388.1 },
  ],
};

/** Admin session plus every Manage endpoint the phase 5 baselines touch. */
export async function mockManageApi(page: Page): Promise<void> {
  await page.clock.setFixedTime(fixedTime);
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, ...json({ message: `Unhandled visual fixture: ${route.request().url()}` }) })
  );
  await page.route('**/api/me', (route) =>
    route.fulfill(json({ isAuthenticated: true, user: { id: 1, username: 'Nonbangkok', role: 'admin' } })));
  await page.route('**/api/site-config', (route) =>
    route.fulfill(json({ accessMode: 'public', allowRegistration: true, passwordChangeEnabled: true })));

  // Users
  await page.route(/\/api\/admin\/users(\?|$)/, (route) =>
    route.fulfill(json({ users: manageUsers, total: manageUsers.length, page: 1, limit: 50 })));
  await page.route('**/api/admin/users/batch', (route) => route.fulfill(json({
    message: 'Created 3 users',
    users: [{ username: 'm43_01', password: 'kite-41-oak' }, { username: 'm43_02', password: 'moss-88-tin' }, { username: 'm43_03', password: 'reef-07-ash' }],
  })));

  // Problems
  await page.route(/\/api\/admin\/problems(\?|$)/, (route) => route.fulfill(json({
    problems: manageProblems, nextCursor: null, hasMore: false, authors: [{ name: 'Ada' }, { name: 'kru.somchai' }],
    total: 4, viewCounts: { all: 4, attention: 1, hidden: 1, in_contest: 1, header: 1 },
    hasUnauthoredProblems: false, bulkEligibleCount: 3,
  })));
  await page.route('**/api/admin/collections', (route) =>
    route.fulfill(json([{ id: 2, name: 'Sorting basics', problem_count: 2, status: 'partially_visible' }])));
  await page.route('**/api/admin/authors', (route) =>
    route.fulfill(json([{ id: 1, username: 'Ada' }, { id: 2, username: 'kru.somchai' }])));
  await page.route('**/api/admin/problems/interval', (route) => route.fulfill(json({
    id: 'interval', title: 'Interval merge', author: 'Ada', categories: ['Sorting'], difficulty: 1400,
    time_limit_ms: 1000, memory_limit_mb: 256, has_pdf: true, is_visible: true, contest_id: null,
    problem_type: 'standard', submission_filename: null, has_starter_files: false,
    collection_id: 2, testcase_count: 10, testcase_bytes: 2_400_000, submission_count: 214, type_locked: true,
  })));
  await page.route(/\/api\/admin\/problems\/interval\/testcases(\?|$)/, (route) => route.fulfill(json({
    testcases: Array.from({ length: 10 }, (_, i) => ({ case_number: i + 1, input_bytes: 90_000 + i * 6_000, output_bytes: 60_000 + i * 5_000 })),
    total: 10,
  })));

  // Contests
  await page.route('**/api/admin/contests', (route) => route.fulfill(json(manageContests)));
  await page.route('**/api/admin/contests/7/admin-problems', (route) => route.fulfill(json(contestSevenProblems)));
  await page.route('**/api/admin/contests/available-problems', (route) =>
    route.fulfill(json([{ id: 'twosum', title: 'Two sums', author: 'kru.somchai' }, { id: 'knapsack', title: 'Knapsack', author: 'Ada' }])));
  await page.route('**/api/admin/contests/7/problem-order', (route) => route.fulfill({ status: 204, body: '' }));

  // Analysis
  await page.route(/\/api\/analytics\/overview/, (route) => route.fulfill(json(overviewAnalytics)));

  // Settings
  await page.route('**/api/admin/settings/registration', (route) => route.fulfill(json({ enabled: true })));
  await page.route('**/api/admin/settings/password-change', (route) => route.fulfill(json({ enabled: false })));
  await page.route('**/api/admin/settings/site-access', (route) => route.fulfill(json({ accessMode: 'public' })));
  // Empty, so the sidebar's live-contest entry never races the screenshot.
  await page.route('**/api/contests', (route) => route.fulfill(json([])));
}

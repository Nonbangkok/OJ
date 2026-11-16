# UI Redesign Phase 2a — App Shell and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three top navbars with one left sidebar shell (plus the contest-only sidebar, auth shell and focus shell), a mobile tab bar, a ⌘K command palette, and one PageHeader + content width on every page.

**Architecture:** `RootLayout` in `App.tsx` picks a shell by route: `AuthShell` (/login, /register), `ContestShell` (/contests/:contestId/*), `FocusShell` (authoring editor, already outlet-only), otherwise `AppShell`. Shell components live in `src/components/shell/`; navigation items are data (one config filtered by role) so the sidebar, mobile tab bar and palette agree. Pages keep their content; only their title block becomes `<PageHeader>` and their own width caps are removed so the shell sets the width. Data components (tables, filters, verdict strips) are phase 2b; the Figma library is phase 2c.

**Tech Stack:** React 19, React Router 7 data router, CSS Modules + phase 1 tokens, `@phosphor-icons/react`, `cmdk` 1.1.1 (new), Jest + Testing Library, Playwright visual tests.

**Spec:** `docs/superpowers/specs/2026-11-15-ui-redesign-design.md` (§6 shell and navigation, §2 anti-goals, §10 phase 2). Phase 1 plan: `docs/superpowers/plans/2026-11-15-ui-redesign-phase1-foundation.md`.

## Global Constraints

- Branch `ui-redesign/phase2a-shell`, cut from `ui-redesign/phase1-foundation` (phase 1 is PR #27, not merged yet). The PR targets `main` once #27 merges; until then open it against `ui-redesign/phase1-foundation`.
- Sidebar 220px, collapsible to hidden; state remembered per browser in `localStorage` key `oj.sidebar.collapsed` (read/write in try/catch); default expanded.
- Mobile breakpoint: `max-width: 767px` → no sidebar, bottom tab bar (Home, Problems, Contests, Submissions, More); inside a contest: Problems / Mine / Scoreboard + countdown in the top bar.
- One content width for every page: `--content-max-width: 1040px`, page gutter `--page-gutter: 28px` (16px on mobile). Only the FocusShell (statement editor) is full-bleed.
- Manage group visibility (unchanged permissions): admin → Users, Problems, Contests, Analysis, Authoring, Settings; staff → Problems, Contests, Analysis, Authoring; user → none.
- Phosphor icons only, used for nav destinations and status; no emoji, no gradients, no resting shadows (design guards from phase 1 must stay green).
- Interim rule (spec §10): routes whose page still has its own left rail open with the global sidebar collapsed: `/problems/:problemId` and `/admin/authoring/:draftId` (+ its step sub-routes, not `/editor`). In ContestShell the contest sidebar stays expanded on `/contests/:id/problems/:pid` (the timer must stay visible); that page's own rail is removed in phase 4.
- UI copy stays English. Commits without `Co-Authored-By`.

## Review Focus

1. **Shortcuts while typing** — `[`, `/` and ⌘K/Ctrl+K must not fire (or must not swallow the key) inside `input`, `textarea`, `select`, `[contenteditable]` and the code editors; ⌘K may open from anywhere. → Task 4 and Task 6 tests type into a textbox and assert nothing toggled/opened.
2. **Role changes mid-session** — the sidebar, tab bar "More" sheet and palette must follow the live `user.role` (it is revalidated per request); a demoted staff member must lose Manage items without reload. → Task 3 test re-renders with a changed role.
3. **Contest clock edges** — no running contest, two running contests (pin the one ending soonest), a countdown reaching zero while viewing (label switches, no negative time), a scheduled contest starting. → Task 2 fake-timer tests.
4. **Deep link into a contest problem** — "Leave contest view" must always go to `/contests`, never `navigate(-1)` (a fresh tab has no history). → Task 5 test.
5. **Narrow desktop (768–1100px) with the sidebar open** — wide tables must scroll inside their own container, not push the page sideways. → Task 4 guard: the shell's main column has `min-width: 0`; Task 9 manual check at 800px.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/shell/navItems.ts` | Nav destinations as data + `navItemsFor(role, opts)` filter. |
| `src/components/shell/useCountdown.ts`, `useLiveContest.ts` | Ticking countdown; the pinned running contest. |
| `src/components/shell/Sidebar.tsx` (+ `.module.css`) | Global sidebar: brand, search trigger, groups, live contest, account. |
| `src/components/shell/AppShell.tsx` (+ css) | Layout grid, collapse state, collapsed strip, mobile top bar + tab bar. |
| `src/components/shell/MobileTabBar.tsx` (+ css) | Bottom tab bar and "More" drawer. |
| `src/components/shell/ContestShell.tsx`, `ContestSidebar.tsx` (+ css) | Contest-only sidebar (back, title, countdown, A/B/C list, links). |
| `src/components/shell/AuthShell.tsx` (+ css) | Logo + 360px column for login/register. |
| `src/components/shell/CommandPalette.tsx` (+ css), `CommandPaletteContext.tsx` | cmdk palette inside the existing `Dialog`; open/close from anywhere. |
| `src/components/ui/PageHeader.tsx` (+ css) | Breadcrumb, H1, description/meta, actions, optional tabs slot. |
| `src/App.tsx` | Route → shell selection; drop `MainLayout`/`Navbar`. |
| `src/layouts/admin/AdminLayout.tsx` | Role guard only; renders `<Outlet/>` (shell comes from RootLayout). |
| Delete | `components/navbar/Navbar.*`, `layouts/admin/AdminNavbar.*`, `layouts/contest/ContestNavbar.*`, `layouts/contest/ContestLayout.tsx`, their tests and `tests/styles/adminNavbarLayout.test.ts`. `NavbarUserMenu` moves to `components/shell/AccountMenu.tsx`. |

---

### Task 1: Layout tokens and the cmdk dependency

**Files:** Modify `frontend/src/index.css` (`:root`, the `.container` rule ~line 392, `@media (max-width: 767px)`), `frontend/package.json`; Test `frontend/src/tests/design/designGuards.test.ts` (`describe('shell tokens')`)

**Interfaces:** Produces CSS variables `--sidebar-width`, `--content-max-width`, `--page-gutter`, `--tabbar-height`, `--topbar-height`.

- [ ] **Step 1: Write the failing tests:** `:root` defines `--sidebar-width: 220px`, `--content-max-width: 1040px`, `--page-gutter: 28px`, `--tabbar-height: 56px`, `--topbar-height: 52px`; a `@media (max-width: 767px)` block sets `--page-gutter: 16px`; `.container` uses `max-width: var(--content-max-width)` and `padding: 24px var(--page-gutter)`; `package.json` dependencies has `"cmdk": "1.1.1"` (exact, no caret).
- [ ] **Step 2: Run** `npx jest src/tests/design -t "shell tokens"` — Expected: FAIL.
- [ ] **Step 3: Implement** the tokens and `.container` change; `npm install cmdk@1.1.1 --save-exact`.
- [ ] **Step 4: Run** `npx jest src/tests/design` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shell): layout tokens and cmdk`

---

### Task 2: `useCountdown` and `useLiveContest`

**Files:** Create `src/components/shell/useCountdown.ts`, `src/components/shell/useLiveContest.ts`; Test `src/tests/components/shell/useCountdown.test.tsx`, `useLiveContest.test.tsx`

**Interfaces:**
- Produces `formatRemaining(ms: number): string` — `ms <= 0` → `'00:00:00'`; under 24h → `'HH:MM:SS'`; otherwise `'Nd HH:MM'`.
- Produces `useCountdown(target: string | Date | null): { remainingMs: number; label: string; done: boolean }` — ticks every 1000ms while `target` is in the future; `null` → `{ remainingMs: 0, label: '', done: true }`.
- Produces `useLiveContest(): Contest | null` — from `contestService.getAll()`; the `status === 'running'` contest with the earliest `end_time`; refetch every 60_000ms and on window focus; errors → `null`; only when a user is logged in.

- [ ] **Step 1: Write the failing tests:** `formatRemaining(0)` → `'00:00:00'`; `(3_723_000)` → `'01:02:03'`; `(90_061_000)` → `'1d 01:01'`; `(-5)` → `'00:00:00'`. With fake timers: target now+2s → label `'00:00:02'`, after 2s `done === true` and label `'00:00:00'`, no negative values after 5s. `useLiveContest` with a mocked `contestService.getAll` returning two running contests (ends +3h and +1h) and one scheduled → returns the +1h one; returning none running → `null`; rejecting → `null`; advancing 60s triggers a second fetch.
- [ ] **Step 2: Run** `npx jest src/tests/components/shell` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** both hooks (interval cleared on unmount and when done).
- [ ] **Step 4: Run** `npx jest src/tests/components/shell` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shell): countdown and live-contest hooks`

---

### Task 3: Nav items and the global Sidebar

**Files:** Create `src/components/shell/navItems.ts`, `Sidebar.tsx`, `Sidebar.module.css`, `AccountMenu.tsx` (+css, moved from `components/navbar/NavbarUserMenu.tsx`, opening upward); Test `src/tests/components/shell/Sidebar.test.tsx`, `navItems.test.ts`; move `src/tests/components/NavbarUserMenu.test.tsx` → `src/tests/components/shell/AccountMenu.test.tsx`

**Interfaces:**
- Produces `type NavItem = { key: string; label: string; to: string; icon: Icon; group: 'practice' | 'contests' | 'manage' }` and `navItemsFor(role: UserRole | null, opts: { privateMode: boolean }): NavItem[]`. Practice: Home `/` (house), Problems `/problems` (list-checks), Submissions `/submissions` (paper-plane-tilt), Ranking `/scoreboard` (ranking). Contests: All contests `/contests` (calendar-blank). Manage per Global Constraints: Users `/admin/users` (users), Problems `/admin/problems` (books), Contests `/admin/contests` (flag-banner), Analysis `/admin/analysis` (chart-line), Authoring `/admin/authoring` (pencil-ruler), Settings `/admin/settings` (gear-six). Guests: Home + Problems only in public mode, none in private mode.
- Produces `<Sidebar onCollapse={() => void} onOpenSearch={() => void} />`: brand (`GraderLogo` 24 + "Grader" wordmark, link `/`), collapse button (`sidebar-simple` icon, `aria-label="Collapse sidebar"`), search trigger button showing "Search" + `⌘K` (calls `onOpenSearch`), groups with headings "Contests"/"Manage" (Practice has no heading), the live contest from `useLiveContest` as the first Contests item (`/contests/:id`, label = title, trailing mono countdown `HH:MM`), active item = `NavLink` with `aria-current="page"` styled per the mockup (`docs/superpowers/specs/2026-11-15-ui-redesign/navigation-final.html`), bottom: `AccountMenu` (avatar, username, `Lv.N` from the existing profile progression if already fetched by AuthContext, else omitted) or, for guests, "Log in" (primary) and "Create account" (only when `registrationEnabled`).
- Consumes `useLiveContest` (Task 2), `GraderLogo` (phase 1).

- [ ] **Step 1: Write the failing tests:** `navItemsFor('user')` has no manage items; `'staff'` manage keys = `[problems, contests, analysis, authoring]`; `'admin'` = `[users, problems, contests, analysis, authoring, settings]`; `navItemsFor(null, {privateMode:true})` is empty. Sidebar: renders `navigation` landmark named "Main"; for a user no "Manage" heading; re-render with role changed to `staff` (AuthContext mock updated) shows "Manage" and "Authoring" without remount; the current route link has `aria-current="page"`; a mocked live contest renders its title and a countdown; clicking the search button calls `onOpenSearch`; guest in public mode shows "Log in" and, with registration disabled, no "Create account".
- [ ] **Step 2: Run** `npx jest src/tests/components/shell` — Expected: FAIL.
- [ ] **Step 3: Implement** `navItems.ts`, `Sidebar`, and move `NavbarUserMenu` to `AccountMenu` (same menu items: profile, theme toggle, change password when enabled, logout; menu opens above the trigger; keep its focus handling).
- [ ] **Step 4: Run** `npx jest src/tests/components/shell` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shell): role-aware sidebar and account menu`

---

### Task 4: AppShell — layout, collapse, mobile

**Files:** Create `src/components/shell/AppShell.tsx`, `AppShell.module.css`, `MobileTabBar.tsx`, `MobileTabBar.module.css`, `src/hooks/useMediaQuery.ts`; Test `src/tests/components/shell/AppShell.test.tsx`, `MobileTabBar.test.tsx`; `designGuards.test.ts` (`describe('shell layout')`)

**Interfaces:**
- Produces `useMediaQuery(query: string): boolean` (matchMedia, SSR-safe default `false`).
- Produces `<AppShell>{children}</AppShell>`: desktop grid `var(--sidebar-width) minmax(0, 1fr)`; main column `<main>` with `min-width: 0` and the page container inside; collapsed → sidebar removed and a 44px top strip with logo, an "Expand sidebar" button and a search button; `[` toggles collapse unless focus is in `input, textarea, select, [contenteditable], .cm-editor, [data-code-editor]`; initial state = stored value, else `defaultCollapsed(pathname)` = true for `/problems/:id` and `/admin/authoring/:draftId(/*)` (not `/editor`), else false. A user toggle on a default-collapsed route is not persisted as the global preference.
- Produces `<MobileTabBar items={NavItem[]} onOpenSearch />`: 4 primary tabs (Home, Problems, Contests→`/contests`, Submissions) + More (opens existing `Drawer` listing Ranking, Manage items for the role, account actions).
- Consumes `Sidebar`, `navItemsFor`, `CommandPalette` opener (Task 6 provides `useCommandPalette().open`; until then pass a no-op prop).

- [ ] **Step 1: Write the failing tests:** desktop (matchMedia false for mobile query): sidebar visible; click "Collapse sidebar" hides it, shows "Expand sidebar", writes `localStorage['oj.sidebar.collapsed'] = 'true'`; reload (remount) stays collapsed; pressing `[` on body toggles; pressing `[` while typing in a `textbox` does not toggle and the character reaches the input; at `/problems/abc` with no stored value the sidebar starts collapsed; mobile (matchMedia true): no sidebar, a `navigation` named "Primary" with 5 tabs, "More" opens a dialog containing "Ranking" (and "Authoring" for staff). Guard: `AppShell.module.css` main column rule contains `min-width: 0`.
- [ ] **Step 2: Run** `npx jest src/tests/components/shell src/tests/design -t "shell"` — Expected: FAIL.
- [ ] **Step 3: Implement** `useMediaQuery`, `AppShell`, `MobileTabBar`, styles per the mockups (`navigation-final.html`, `b-plus-d.html` mobile).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shell): app shell with collapsible sidebar and mobile tab bar`

---

### Task 5: ContestShell

**Files:** Create `src/components/shell/ContestShell.tsx`, `ContestSidebar.tsx`, `ContestSidebar.module.css`; Test `src/tests/components/shell/ContestShell.test.tsx`; Delete `src/layouts/contest/ContestLayout.tsx`, `ContestNavbar.tsx`, `ContestNavbar.module.css`

**Interfaces:**
- Produces `problemLetter(index: number): string` — 0→`A`, 25→`Z`, 26→`AA`.
- Produces `<ContestShell />` (route element for `/contests/:contestId`, renders `<Outlet/>`): fetches `contestService.getById` and `contestService.getProblems` (problems are `ProblemSummary`-shaped: `best_score`, `submission_count`); refetches problems when a submission event for this contest arrives through the existing `realtimeService` subscription if available, else every 30s.
- `ContestSidebar` content (mockup `navigation-de.html` contest frame): "Leave contest view" link to `/contests` (never history back); contest title; countdown box — running: `useCountdown(end_time)` + "Live" tag; scheduled: "Starts in" + `useCountdown(start_time)`; finishing: "Judging"; finished: "Ended"; problem list (API order) with letter, status icon (score 100 → check/ok; attempted with score < 100 → x/bad; untried → circle/none) and best score (mono, only when attempted), linking to `/contests/:id/problems/:pid`; then "My submissions" (only `is_participant`) and "Scoreboard"; the problem list and My submissions follow today's ContestNavbar rule (hidden when the contest is `finished`).
- Mobile: top bar with back arrow, contest title, mono countdown; tab bar Problems / Mine / Scoreboard.

- [ ] **Step 1: Write the failing tests:** `problemLetter` cases; with mocked services (running, ends in 90 min, participant, problems scored 100 / 40 / untried): renders "Leave contest view" with `href="/contests"`, title, `01:30:00`-style countdown and "Live", rows "A", "B", "C" with accessible names containing the title, score "100" and "40", links to the right paths; non-participant → no "My submissions"; finished → no problem list, shows "Ended"; mobile → navigation "Contest" with 3 tabs.
- [ ] **Step 2: Run** `npx jest src/tests/components/shell/ContestShell.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**; wire `/contests/:contestId` route element to `<PrivateRoute><ContestShell/></PrivateRoute>` in `App.tsx`.
- [ ] **Step 4: Run** `npx jest src/tests/components/shell src/tests/pages` — Expected: PASS (update contest page tests that rendered `ContestNavbar`).
- [ ] **Step 5: Commit** — `feat(shell): contest sidebar shell`

---

### Task 6: Command palette (⌘K)

**Files:** Create `src/components/shell/CommandPalette.tsx`, `CommandPalette.module.css`, `CommandPaletteContext.tsx`; Test `src/tests/components/shell/CommandPalette.test.tsx`

**Interfaces:**
- Produces `CommandPaletteProvider` (wraps the router tree inside `App`) and `useCommandPalette(): { open(): void; close(): void; isOpen: boolean }`.
- Opening: ⌘K / Ctrl+K anywhere (preventDefault); `/` when focus is not in an editable element (same rule as Task 4); the sidebar/top-bar/tab-bar search buttons.
- Content (cmdk `<Command>` rendered inside the existing `components/ui/Dialog`, not `Command.Dialog`): input placeholder "Search problems, contests, pages…"; groups in order: "Go to" (`navItemsFor` for the current role), "Problems" (`submissionService.searchProblems(q)` debounced 200ms when `q.trim().length ≥ 1`; item shows title + mono id; select → `/problems/:id`), "Contests" (`contestService.getAll()` once per open, filtered by title client-side; select → `/contests/:id`), "Users" (staff/admin only; `submissionService.searchUsers(q)`; select → `/profile/:username`), "Actions" ("Toggle theme"). Empty state "No results". Selecting closes the palette. Escape closes (Dialog already handles it).
- Consumes `navItemsFor` (Task 3), `useDebouncedValue` (existing hook).

- [ ] **Step 1: Write the failing tests:** Ctrl+K opens a dialog named "Search"; `/` while a textbox is focused does not open and the slash is typed; typing "vec" calls `searchProblems('vec')` once after 200ms and shows "vector::erase" with id; Enter navigates to `/problems/hp_vec04_erase` and closes; a `user` sees no "Users" group, `staff` does; "Toggle theme" calls `toggleTheme`.
- [ ] **Step 2: Run** `npx jest src/tests/components/shell/CommandPalette.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**; connect the Sidebar, collapsed strip, mobile top bar and tab bar search buttons to `open()`; add `cmdk` to `transformIgnorePatterns` in `jest.config.cjs` only if Jest cannot parse it.
- [ ] **Step 4: Run** `npx jest src/tests/components/shell` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shell): command palette`

---

### Task 7: PageHeader and one content width on every page

**Files:** Create `src/components/ui/PageHeader.tsx`, `PageHeader.module.css` (export from `components/ui/index.ts`); Test `src/tests/components/ui/PageHeader.test.tsx`, `designGuards.test.ts` (`describe('page headers')`). Modify the title block of: `pages/problem/Problems.tsx` ("Problems"), `features/submission/SubmissionsView.tsx` (its `title` prop), `pages/scoreboard/Scoreboard.tsx` ("Ranking"), `pages/contest/Contests.tsx` ("Contests"), `pages/contest/ContestProblems.tsx`, `ContestScoreboard.tsx`, `ContestSubmissions.tsx` (via SubmissionsView), `pages/admin/Admin.tsx` ("Manage"), `features/admin/users/UserManagement.tsx` ("Users"), `features/admin/problems/ProblemManagement.tsx` ("Problems"), `features/admin/contests/ContestManagement.tsx` ("Contests"), `features/admin/analysis/AnalysisPage.tsx` ("Analysis"), `features/admin/settings/Settings.tsx` ("Settings"), `features/admin/authoring/ProblemAuthoring.tsx` ("Authoring", "Author profiles"), `features/admin/authoring/AiDocs.tsx` ("AI docs"), `pages/notfound/NotFound.tsx` (keep its h1 text). Remove per-page `max-width` caps and title styles on these pages (e.g. `Home.module.css` 880/640, `UserProfile.module.css` 920/720, `ProblemDetail.module.css` 900, `Problems.module.css` 1200, `Contests.module.css` 1200, `Admin.module.css` 1200).

**Interfaces:**
- Produces `PageHeader(props: { title: ReactNode; description?: ReactNode; meta?: ReactNode; actions?: ReactNode; breadcrumb?: Array<{ label: string; to?: string }>; tabs?: ReactNode }): JSX.Element` — `<header>` with optional `<nav aria-label="Breadcrumb">`, one `<h1>` (22px / 600), description line, meta row (13px muted), actions right-aligned (wrap below title on mobile), tabs slot under it.

- [ ] **Step 1: Write the failing tests:** PageHeader renders a level-1 heading with the title, a breadcrumb nav with links for items with `to`, the actions node, and the tabs node; without breadcrumb no nav. Guard `describe('page headers')`: each file in the list above imports `PageHeader` and contains no `<h1` of its own (NotFound and Home excepted — Home keeps its hero until phase 3); none of the listed CSS files sets a `max-width` above 600px outside `@media` blocks.
- [ ] **Step 2: Run** `npx jest src/tests/components/ui/PageHeader.test.tsx src/tests/design -t "page headers"` — Expected: FAIL.
- [ ] **Step 3: Implement** PageHeader and adopt it (existing buttons beside titles move into `actions` unchanged). Titles exactly as listed above; ProblemDetail's title stays in its rail until phase 3.
- [ ] **Step 4: Run** `npx jest src/tests` — Expected: PASS (update tests asserting old heading text such as "All Problems", "Problem Management", "User Management", "Admin Settings", "Admin Panel").
- [ ] **Step 5: Commit** — `feat(ui): PageHeader and a single content width`

---

### Task 8: Route → shell wiring; remove the old navbars; AuthShell

**Files:** Modify `src/App.tsx`, `src/layouts/admin/AdminLayout.tsx`, `src/pages/auth/Login.tsx`, `Register.tsx` (if they set their own container); Create `src/components/shell/AuthShell.tsx` (+css); Delete `src/components/navbar/` (after moving NavbarUserMenu in Task 3), `src/layouts/admin/AdminNavbar.*`, `src/tests/Navbar.test.tsx`, `src/tests/layouts/admin/AdminNavbar.test.tsx`, `src/tests/styles/adminNavbarLayout.test.ts`; Test `src/tests/App.shell.test.tsx` (memory router over `appRoutes`), update `src/tests/layouts/admin/AdminLayout.test.tsx`, `src/tests/pages/NotFound.test.tsx`

**Interfaces:**
- `RootLayout`: `/login`, `/register` → `AuthShell` (logo + 360px column, no sidebar); `/contests/:contestId/*` → route element already is `ContestShell` (no AppShell around it); `/admin/authoring/:draftId/editor` → no shell (FocusShell = bare outlet, as today); everything else → `AppShell`. `ScrollRestoration` stays. `CommandPaletteProvider` wraps all shells.
- `AdminLayout`: keeps the loading and role guard; returns `<Outlet/>`; no navbar, no container (AppShell provides it).

- [ ] **Step 1: Write the failing tests** (`App.shell.test.tsx`, mocked auth/services): `/problems` renders navigation "Main" and no `banner` from the old navbar; `/login` renders no navigation "Main"; `/contests/3/scoreboard` renders "Leave contest view" and not navigation "Main"; `/admin/problems` as staff renders navigation "Main" with "Manage" and `aria-current` on Problems under Manage; `/admin/authoring/x/editor` renders neither sidebar; `/nope` renders "Page not found" inside the shell. Design guard: no source file imports `components/navbar/` or `layouts/contest/ContestNavbar` or `AdminNavbar`.
- [ ] **Step 2: Run** `npx jest src/tests/App.shell.test.tsx src/tests/design` — Expected: FAIL.
- [ ] **Step 3: Implement** the wiring, AuthShell, deletions.
- [ ] **Step 4: Run** `npm run validate` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shell): route pages through the new shells; remove the old navbars`

---

### Task 9: Verification and PR

- [ ] **Step 1:** `npm run build` — Expected: success + CSP check passes.
- [ ] **Step 2:** `npm run test:visual` — Expected: diffs (navbar → sidebar). Update `tests/visual/admin-shell.spec.ts` only where it asserted the old navbar (it should now assert navigation "Main" with Manage › Authoring current), then `npm run test:visual:update`; open every regenerated PNG and confirm: sidebar, collapsed/mobile tab bar where captured, content width 1040, no horizontal scroll.
- [ ] **Step 3: Local stack** (`docker compose -p oj up --build -d frontend` from the repo root): check at 1440, 1024, 800 and 390px in both themes — Home, Problems, a problem (sidebar starts collapsed), Submissions, Contests, a contest scoreboard (contest sidebar), Admin Problems and Authoring as admin and as a `user` account (no Manage), ⌘K search for a problem, `[` toggle, mobile More sheet. No page scrolls horizontally.
- [ ] **Step 4:** Commit snapshot updates — `test(visual): baselines for the app shell`; push and open a PR titled `UI redesign phase 2a: app shell and navigation` (base `main` if PR #27 has merged, else `ui-redesign/phase1-foundation`).

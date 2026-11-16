# Grader UI redesign — design

Date: 2026-11-15 · Status: draft for approval
Reference mockups: `docs/superpowers/specs/2026-11-15-ui-redesign/` (open the `.html` files in a browser).
Page-by-page audit with evidence: `docs/superpowers/specs/2026-11-15-ui-redesign/audit.md`.

## 1. Intent

Grader is used every day by students solving problems, and by TAs (role `staff`) and admins who run contests and author problems. Today it looks like an untouched Bootstrap template, every page is built differently (content widths of 880, 920, 1096 and 1160px; three different page-header patterns; three separate navbars), and on a phone the top navigation overflows so Contests and Admin are unreachable and tables hide their action columns off-screen.

The redesign has two jobs:

1. **Make it one consistent, modern product** across all ~29 routes, desktop and mobile, light and dark.
2. **Get students back into solving faster and keep them motivated**, without the product reading as generated or gimmicky.

## 2. Goals, non-goals, anti-goals

**Goals**
- One app shell, one content width, one page-header pattern, one table pattern, on every page.
- Every page usable on a 375–390px phone without horizontal scrolling.
- Light and dark themes from one token set.
- The logged-in Home sends a student straight back to the problem they were working on and shows small goals they can reach today.
- Verdicts are always readable without colour (text + icon), and per-testcase results are visible everywhere a verdict is shown.
- TAs/admins manage problems, contests and users from the same sidebar as the student side, with safer destructive actions.

**Non-goals**
- No change of UI language: copy stays English (problem statements stay as authored, often Thai).
- No change to judging, scoring rules (IOI sum, tie by earliest last improvement), or permissions.
- No CSS framework switch: stay on CSS Modules + CSS custom properties.
- No new features beyond what the redesigned pages need (the backend additions in §9 exist only to feed agreed UI).

**Anti-goals — the redesign has failed if it ends up with any of these, even if it "works"**
- "AI slop" look: gradients (in fills, text or buttons), glassmorphism/backdrop blur, floating cards with soft drop shadows, gradient or pill CTAs, hype copy ("Level up your coding journey"), sparkle/rocket/brain style icons.
- Decorative icons. An icon must carry meaning (a status, an action, a nav destination). The current flame streak icon and the medal tints are examples to remove.
- Emoji anywhere in the UI.
- Bootstrap's look: `#0d6efd`/`#007bff` blue, colour-coded action buttons (green create, teal edit, blue view).
- Two left rails on one screen.
- Stacked navigation bars (a second nav row under the top nav) — rejected during design.

## 3. Constraints

- React 19 + Vite + CSS Modules; shared primitives already in `frontend/src/components/ui/` (Dialog, Button, ActionMenu, SegmentedControl, Drawer, StatusBadge, OverflowTable). Their public APIs stay; their internals may move onto the headless libraries in §5.1.
- Icons: `@phosphor-icons/react` (already installed). No second icon set.
- Production deploys go through the CD gate (green push to `main` → approval → `scripts/cd-deploy.sh`). Every phase must be shippable on its own; there is an active contest calendar.
- CSP: no inline scripts in the built `index.html` (the build already fails on this). The CSP in `frontend/nginx.conf` and `nginx-proxy/*.conf` already allows Google Fonts (`style-src https://fonts.googleapis.com`, `font-src https://fonts.gstatic.com`), which `index.css` uses today for Inter/Inconsolata, so the new fonts can load the same way; self-hosting is also acceptable.
- Tests: frontend coverage gate on `src/services/*.ts`; Playwright visual baselines in `frontend/tests/visual/` must be regenerated per phase (`npm run test:visual:update`) and reviewed.
- Backend changes follow the repo rules: new numbered migrations only, Zod validation, raw SQL in services.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Foundation first, then page groups, one PR per phase | Each phase ships through CD and is reviewable; for a while some pages are redesigned and some are not, but after phases 1–2 every page already uses the new tokens and sidebar, so the mix is mild. |
| B | Everything on one long-lived branch, merged once | Consistent at launch, but weeks of drift and conflicts, and one huge deploy that is hard to debug during a contest season. |
| C | Design every screen in Figma first, then implement | A complete Figma source of truth, but a second full design pass over decisions already settled in HTML mockups. |

Chosen: **A**, because it fits the CD gate and contest calendar, and most of the look is already settled. Figma is used inside A (see §8).

## 5. Visual system (decided)

Mockups: `mood-directions.html` (direction chosen: B, with D as its dark mode), `b-plus-d.html`.

- **Character:** neutral and dense. Thin 1px borders, no drop shadows except on floating menus/dialogs, no brand accent colour. Primary button is solid near-black (`zinc-900`) in light mode and near-white in dark mode. Red is reserved for destructive actions and failing verdicts; amber for "stale" and TLE; green for pass.
- **Light palette:** zinc scale (`#ffffff`, `#fafafa`, `#f4f4f5`, `#e4e4e7`, `#a1a1aa`, `#71717a`, `#18181b`); pass `#16a34a`, fail `#dc2626`, warn `#b45309`.
- **Dark palette:** GitHub-dark tones (`#0d1117` page, `#010409` sidebar, `#161b22` hover, `#21262d` lines, `#e6edf3` text, `#8b949e` muted); pass `#3fb950`, fail `#f85149`, warn `#d29922`.
- **Activity green scale (4 levels + empty):** the same colour tokens as the existing profile heatmap (`--heatmap-*`), reused for the Home week strip (what each counts is defined per surface, see §7.1).
- **Type:** IBM Plex Sans Thai for all UI text (it has Thai glyphs; Inter does not, so Thai currently falls back to the OS font). JetBrains Mono for ids, numbers, verdicts, timers and code — one mono stack replacing the 5–6 in use today.
- **Scale:** page title 22px/600, section label 12px uppercase muted, body 14px, metadata 13px. Exact spacing scale left to the builder, but every page uses the same page padding and header offset.
- **Verdicts:** mono uppercase text — `ACCEPTED`, `WRONG 6/10`, `TIME LIMIT 8/10`, `MEMORY LIMIT`, `RUNTIME ERROR`, `COMPILATION ERROR`, `NOT RUN` — always paired with a Phosphor status mark (check / x / timer / circle). Never colour alone.
- **Testcase strip:** one small segment per testcase (green pass, red fail, amber TLE, grey not reached). Used in Home, Problems list, problem header, submission detail, contest pages. When a problem has more cases than fit (e.g. >20), the builder decides a compact form; the default case count in content is 10.
- **Logo:** keep the existing three-crescent logo. Convert `src/assets/logo512*.png` to a single SVG that follows `currentColor`, used in the sidebar, favicon and 404.
- **Icons:** Phosphor regular weight for nav/actions, bold for status marks. No emoji; remove the ~10 existing emoji (8 files) and the emoji in modals/contest pages.
- **Content width:** one max content width for all pages (mockups use 1040px inside the shell). Full-bleed exceptions: the statement editor (FocusShell).

### 5.1 Libraries (decided)

The owner offered a list of UI libraries to use at Claude's discretion. Only unstyled/headless ones fit: the look is ours, styled with CSS Modules and the tokens above.

| Library | Use | Why |
|---|---|---|
| **Base UI** (`@base-ui/react`, 1.9.x, React 19) | Accessible behaviour for Dialog, Menu (row `⋯`), Popover, Tooltip, Tabs, Select, Combobox (problem picker, user search), Toast ("Saved", job finished) | One actively maintained headless package covering every overlay/menu we need; replaces hand-rolled focus traps and positioning. Existing `components/ui` wrappers keep their APIs. |
| **cmdk** (1.1.x) | ⌘K command palette | Purpose-built, unstyled, fuzzy matching and keyboard handling. |
| **NumberFlow** (`@number-flow/react`) | Animated digits only where a number changes live: scoreboard totals, XP after an award, countdowns if smooth | Gives the "alive" feel without decoration; disabled under `prefers-reduced-motion`. Not for static numbers. |

Not used: **shadcn/ui** (built on Tailwind; we keep CSS Modules), **Radix** (covered by Base UI; one headless library only), **Sonner** (Base UI Toast covers it), **Vaul** (no release since 2024-12; existing Drawer + Base UI cover sheets), **Magic UI, Aceternity UI, RareUI, Beautiful UI, 21st.dev** (animated gradient/glow/marketing components — the anti-goals in §2), **pick-ui-library skill** (choice made here).

## 6. Shell and navigation (decided)

Mockups: `navigation-final.html` (main sidebar on a problem page), `navigation-de.html` (option D: contest sidebar), `key-pages.html` §3.

- **AppShell — one left sidebar on every page** (220px, collapsible to hidden via a button next to the logo and the `[` key; the choice is remembered per browser, default expanded):
  - Logo + "Grader", search field showing `⌘K`.
  - Practice: Home, Problems, Submissions, Ranking.
  - Contests: the running contest pinned with a live countdown (if any), then "All contests".
  - Manage (staff/admin only): Users, Problems, Contests, Authoring, Analysis, Settings.
  - Bottom: avatar, username, `Lv.N` → profile menu (profile, theme, log out).
- **The sidebar does not change on problem pages.** Problem detail has no left rail of its own; its info moves into the page header (§7.3).
- **ContestShell — the only place the sidebar changes.** Inside `/contests/:id/*` for a participant during a contest: "Leave contest view" back link, contest title, a countdown box with a Live tag, the contest's problems as A, B, C… with status mark and best score, then My submissions and Scoreboard, and the user's total points at the bottom. This change is deliberate so a student always knows they are in a contest.
- **FocusShell:** only the full-screen statement editor (`/admin/authoring/:id/editor`); hides the sidebar, slim top bar.
- **AuthShell:** login, register, and the private-mode landing; logo + a 360px column, no sidebar.
- **Mobile (<768px):** the sidebar becomes a bottom tab bar — Home, Problems, Contests, Submissions, More (More holds Ranking, Manage, profile). In ContestShell the tab bar is Problems / Mine / Scoreboard and the countdown sits in the top bar. Search opens from a magnifier icon.
- **⌘K command palette** (also `/`): jump to a problem by title or id, a collection, a contest, a user (staff), and actions ("Random unsolved", and for staff "New problem", "New contest", "Create users in batch", "Edit <problem> in authoring"). Results show status marks for problems.
- Remove the three existing navbars (`components/navbar/Navbar.tsx`, `layouts/admin/AdminNavbar.tsx`, `layouts/contest/ContestNavbar.tsx`) and the separate admin layout chrome.

## 7. Pages

Each subsection: what the page must do, and the decided layout. "Builder" marks details left to the implementer. Full problem lists per page are in `audit.md`.

### 7.1 Home (logged in) — mockup `home-merged.html`
- Header: date line + "Continue where you left off". No hero, no quote, no flame, no "Browse Problems" button.
- Left: **Continue block** — the most recently attempted unsolved problem (logic exists in `Home.tsx`): id, title, testcase strip, verdict, attempts, last tried, a Continue button (Enter key). If nothing to continue: "Start with" + 3 easiest unsolved problems.
- Left, below: **Within reach** — up to 3 concrete goals, each linking to the problem that completes it: "One more to finish <collection> 9/10" (needs §9 B1), "<n> XP to Level <L+1>" + a problem whose XP covers it, "Solve one today to make it a <n+1>-day run". Show only goals that apply.
- Right column: Level (tier, bar, `340 / 500 XP`), This week (7 day cells, today dashed, count on hover, legend), Collections (progress bars), and the running/upcoming contest if any.
- **Week strip metric:** a day's count is the number of distinct problems the user got Accepted on that day (re-solves of an already-solved problem count for that day; several ACs on one problem count once). Levels: 0 = empty, 1, 2, 3–4, 5+. It uses the heatmap's colour scale but not its meaning: the profile heatmap keeps counting all submissions per day and its legend says so. The "N-day run" keeps its current definition (days with any Accepted submission).
- Mobile: single column, Continue button full width.

### 7.2 Problems — mockup `key-pages.html` §1
- Header "Problems" + `142 problems · 38 solved`.
- Toolbar: search; segmented All / Unsolved / Attempted / Solved with counts; dashed "add filter" buttons for Difficulty, Category, Collection that become removable chips when set; sort control. Filters live in the URL (as today).
- Dense table, whole row clickable: status mark, id (mono), title, difficulty (mono, right), Best (strip + score), Last tried (relative). Categories stay hidden until revealed (spoiler-safe behaviour kept).
- Keyset "Show more" stays.
- Mobile: two-line rows (title / id or strip + score + time), one Filters button + sort.
- Server-side status filter needs §9 B2; until then the builder may filter loaded rows client-side only if counts stay correct.

### 7.3 Problem detail — mockup `key-pages.html` §2
- Breadcrumb (Problems › collection), H1 title, meta line: id, `1000 ms · 256 MB`, languages / header filename, author.
- Header right: best testcase strip + score, Starter button (header problems only), Open PDF.
- Tabs: Statement / Submit / Submissions (count).
- Statement: PDF viewer at content width with a loading state and a "Can't preview — open PDF" fallback.
- Submit: code editor or file drop (header problems state the required filename), Submit button (⌘Enter). **After submitting, the result appears inline under the form** and updates live (SSE as today): big verdict, `6/10 · 60 pts`, submission id/time, strip, "stopped at case 7", case table (#, verdict, time vs limit with a small bar, memory vs limit), first failing case highlighted, cases after a stop shown as NOT RUN, actions "View submitted code" and "Edit & resubmit". Compilation errors show the full sanitized compiler log.
- Mobile: header wraps, tabs become a sticky bar.

### 7.4 Submissions + submission detail
- List: header + toolbar (Mine/All, problem, verdict, user for staff); table: id, when (relative), user, problem, verdict + strip, score, max time / memory, language. Row opens the detail. No per-row buttons.
- Detail: its own route or a wide right drawer (builder's choice; it must be linkable). Same verdict header and case table as §7.3, plus collapsible code (JetBrains Mono, copy) and "Edit & resubmit".

### 7.5 Ranking (global scoreboard)
- **Ranked by total XP** (owner decision). Ties share a rank with competition ranking (1, 2, 2, 4); the profile's "global rank" uses the same rule, so both always agree (today the profile uses `DENSE_RANK` over XP and `/scoreboard` uses sum of best scores — both change).
- Segmented **All time / This week**; This week = XP awarded in the last 7 days (`user_problem_rewards.awarded_at`), in scope for phase 3.
- Dense table: rank (mono, right), user (avatar + name, linked), tier · Lv, solved, XP (mono). Top 3 in bold only — no tints or medals. The viewer's row highlighted and pinned at the bottom when off-screen. Pagination at 50.
- Contest scoreboards keep IOI scoring (sum of best scores, tie by earliest last improvement) and also display competition ranking.

### 7.6 Profile
- Header: avatar, name, joined, tier · Lv, XP bar with "x to Lv n+1", global rank. One stat row: Solved, Attempted, Submissions, Current run / Best run (mono, no icons).
- Heatmap full width, anchored right so the newest weeks show on mobile.
- Categories: a **radar** (owner decision 2026-11-16, kept because it reads well) beside a solved / total / % list, mockup `phase3-pages.html` §1. Colours come from theme tokens only: area and dots `--accent-primary` (12% fill), rings and spokes `--border-color`, labels `--text-secondary`, percentages `--text-muted`. Categories with no problems stay off the radar. The radar is `aria-hidden`; the list carries the numbers. Hovering a point or a list row highlights both. Below that: Recently solved (+XP, date) | Verdict breakdown and Languages as horizontal bars.
- Achievements: compact list, unlocked with dates, locked with progress; show next 3 + "Show all".

### 7.7 Contests
Mockups: `phase4-contests.html` (list, lobby, running not joined, running joined + dark, finishing, finished recap, contest problem after the end, phones), `key-pages.html` §3 (scoreboard), `navigation-de.html` (ContestShell).
- **Which shell:** ContestShell only for a participant while the contest is running or finishing (and on its problem pages). The list, lobby, running-not-joined page and finished recap use the normal AppShell.
- **List:** sections Live / Upcoming / Past; rows with title, mono time window, mono countdown, `n joined · n problems`, one right-aligned action (Join / Enter / Registered → lobby / Results). Staff see a `HIDDEN` tag on hidden contests. Plain-text empty state.
- **Lobby (scheduled):** title + SCHEDULED tag, large countdown, rules facts (window, duration, problem count, scoring "IOI · sum of best scores · ties by earliest last improvement"), registered roster, Join → Registered. Auto-enters when the countdown hits zero.
- **Running, not joined:** problem letters only (titles stay hidden server-side) + Join; joining lands on problem A.
- **Running, joined:** ContestShell; `/contests/:id` lands on the contest problem table (letter, title, best strip, score, tries); the header meta shows `points / max`. Letters follow the admin's order (B4), not problem ids. Phones: two-line rows (letter, mark, title, score / strip, tries).
- **Finishing:** "Judging final submissions…", timer at 00:00:00.
- **Finished:** recap (final rank of N, points of max, solved of total, then per-problem best strip, score, tries) and a Scoreboard button, reachable by everyone (today non-participants are redirected away). Non-participants see the problem table and Scoreboard only. Problem titles link to the practice problem, since problems return to the practice set after the contest.
- **Contest problem page:** same as §7.3 with the letter in the header; when the contest ends the Submit tab becomes "Contest ended — submissions closed" without waiting for a server rejection.
- **Contest scoreboard** — mockup `key-pages.html` §3: header Scoreboard + LIVE/FINAL tag + "updated Ns ago" with a live dot only while SSE is connected; columns rank, participant (linked), Total with `last hh:mm:ss` under it, one column per problem headed A, B, C… (linked, full title on hover). Cells: 100 = green text on faint green, partial = plain, 0 = muted, untried = "—". Viewer row highlighted (2px left rule); a "You · #14" bar sticks to the bottom when it is off-screen. Rank uses competition ranking consistent with the global ranking. Mobile: rank/name/total fixed, problem columns scroll.
- Contest submissions default to Mine (staff: All).

### 7.8 Manage (staff/admin)
Shared rules for every Manage page:
- PageHeader with title, one-line description, at most one black primary action, secondary actions, and a `⋯` for rare page-level actions.
- DataTable with left-aligned text, right-aligned mono numbers, row click opens the edit surface, a trailing `⋯` row menu with destructive items last and red after a separator.
- BulkBar appears inline above the table only when rows are selected; at most 3–4 visible actions, the rest in overflow; destructive actions always confirm.
- Status values (visibility, contest status, lock) are a dot + text and are **never clickable toggles**.
- **Edit-surface rule:** 1–3 fields or a confirmation → Dialog; create/edit with context and fewer than ~8 fields → right Drawer; multi-part objects TAs revisit → full page with its own URL and tabs.
- **Confirm tiers:** reversible → plain confirm; destructive → red button naming the object and counts; cascading/irreversible → type the object's name. Button labels are verbs ("Delete user"), not "Confirm".

Pages (mockups: Problems list `key-pages.html` §4; everything else `phase5-manage.html`):
- **Mockup decisions (phase 5 gate):**
  - **Users:** the primary action is "Create users" (batch, Drawer); single "Add user" sits in the header `⋯`. The edit Drawer holds role, lock submissions and Reset password.
  - **Problem page:** header actions are "View as student" and Save. General shows the difficulty → XP hint, and visibility as a dot + Hide/Show button.
  - **Contest page:** "Open contest page" in the header. The Problems tab is a draggable ordered list with letters and a remove ✕.
  - **Settings:** shows a "✓ Saved" indicator in the header.
- **`/admin`:** removed as a hub; redirects to Problems (staff) or the last-used Manage page.
- **Users:** filters (search, role segmented, locked); columns username (→ profile), role, status, solved, joined, last active (§9 B5), `⋯`; bulk lock/unlock/role/export; batch create in a Drawer whose result view offers Download CSV + Copy and warns passwords won't be shown again; edit in a Drawer; delete is type-to-confirm and states how many submissions go with it.
- **Problems:** header actions Import ZIP, `⋯` (Manage collections), New problem. Filters as chips + "12 of 146". Columns id, title, type tag (header only), difficulty, tests (§9 B6), TL/ML, collection (blank if none), visibility dot (or "In contest"), `⋯` (Edit, Testcases, Rejudge, Show/Hide, Copy link, Delete). Scope actions ("Show all N matching") carry the count. **Edit is a full page `/admin/problems/:id`** with tabs General / Statement / Testcases / Grader files (header only) / Danger zone; "type locked · N submissions" shown up front (§9 B6). Testcases tab: summary line, table, drop zone; replacing the whole set confirms with old vs new counts and offers a rejudge. Create = small dialog (id, title) that lands on the page.
- **Contests:** status segmented filter; columns title (→ detail), status dot (+ live remaining), starts, duration, participants, problems, visibility, `⋯`. **Edit is a full page `/admin/contests/:id`** with tabs Settings / Problems (ordered list, add via searchable picker, drag to reorder — §9 B4) / Participants (read-only list: user, joined at, score; no add/remove in this redesign). Create in a Drawer: title, description, start date+time (free entry or 15-min steps), duration presets, visibility, and an explicit "Times are Asia/Bangkok (UTC+7)" note.
- **Analysis:** range selector in the header; tabs become routes (`/admin/analysis/{overview,users,problems,contests,submissions}` with ids/compare in the URL); KPI strip with neutral ▲/▼ deltas labelled "vs prev. 30d"; drop the verdict pie; chart colours come from the verdict tokens; standard tables with CSV export. Fix the mobile horizontal overflow.
- **Settings:** two flat lists of SettingsRows (label + help left, control right, also on mobile): Access (site visibility, registration, password changes) and Data (export; Danger zone → "Replace database…" dialog with drop zone and the existing type-to-confirm). Switching to Private asks for confirmation and warns if a contest is running. Show a saved indicator.

### 7.9 Authoring (staff/admin)
- Authoring has sub-tabs under its PageHeader: Drafts · Author profiles · AI docs.
- **Draft list:** columns id (link), title, author, readiness dots (Statement / Solution / Testcases / PDF / Verified — needs §9 B7) + status, updated, `⋯`. Mobile: two-line rows.
- **Author profiles:** table (avatar + AKA, real name, language, country, linked user, drafts using it — §9 B8, `⋯`); edit in a Drawer; link a user by searching usernames (§9 B8).
- **Draft workspace:** the global sidebar stays; the draft's own left rail is removed. Draft header: breadcrumb, title, status, save state in mono ("Saved · rev 14" / "Saving…" / "Unsaved"), one contextual primary (Verify when unverified, Publish when ready, none while a job runs), running-job pill. **Step tabs** under it: Metadata · Statement · Solution · Generator · Testcases · Verify & publish, each with a status glyph — done / to do / stale (amber) / failed (red) — computed in the frontend from data already loaded. History and AI docs are right-aligned links, not steps.
- **Metadata:** two-column form with units and inline field errors; categories as toggle chips.
- **Statement:** read-only rendered preview + "Edit statement"; one-line PDF row with Rebuild/Open; assets via FileDrop table.
- **Full-screen editor (FocusShell):** shared code editor (line numbers, highlighting), Fit-to-width preview default, save state always visible (separate "Published · live unchanged" badge), Preview/PDF toggle, ⌘S hint; mobile shows source and preview as tabs.
- **Solution / Generator:** editor + result panel with the last compile at this revision; theme-aware editor; "Generate inputs" lives on Generator.
- **Testcases:** summary line, compact table with `⋯` (Inspect, Replace, Delete), one FileDrop, "Replace all from ZIP" with confirm; mobile view-only.
- **Verify & publish:** ReadinessList — one row per gate (Metadata, Statement, Solution compiles at rev N, Testcases, PDF current, Verified rev N) with state and an inline fix link to the right tab; footer with Verify (secondary) and Publish (primary) and the blocking reason next to a disabled Publish.
- **History:** timeline table, log in a Drawer; profile sync runs move to Author profiles.
- Mobile policy: lists and views everywhere, light edits on Metadata only; editors and uploads show "Best edited on a larger screen".

### 7.10 Auth, guest, 404
- **Login / Register (AuthShell):** H1, fields with hints ("At least 3 characters"), `autocomplete` attributes, show-password toggle, `role="alert"` form errors, field errors under fields, pending state on the button. After register → `/login?registered=1` with a notice.
- **Guest home, public mode:** AppShell with Practice items and Log in / Create account at the sidebar bottom; header "Grader" + one plain sentence; recent problems table and running/upcoming contests. No hero.
- **Guest home, private mode:** AuthShell with "This Grader is private" above the login form.
- **404:** inside AppShell; mono "404", H1 "Page not found", the requested path in mono, Go home + Search.

## 8. Figma

The file "Grader Design" (`https://www.figma.com/design/1LcruSmMzO1hBruNrGWate/Grader-Design`) is empty today. After phase 2, push the real tokens (light + dark variables) and the shared components from code into it as a library. The owner's Figma plan is Starter tier, so Code Connect (Organization/Enterprise only) is not used; component names in Figma match the React component names instead. Pages not yet mocked in HTML — Profile, contest lobby/finished recap, Users/Contests editors, Analysis, Settings, the authoring workspace — are designed in Figma from that library. **This is a gate (owner decision):** before each of phases 3–6 starts, Claude puts that phase's un-mocked pages in Figma and the owner approves them; implementation of those pages waits for the approval. Pages already settled in the HTML mockups do not need a Figma pass. HTML mockups remain acceptable for quick explorations.

Phase 5 status (2026-11-16): the gate uses an HTML mockup, `phase5-manage.html`, awaiting approval.

Phase 4 status (2026-11-16): per the owner's earlier decision, the gate uses an HTML mockup, `phase4-contests.html`, awaiting approval.

Phase 3 status (2026-11-16): Submissions, Submission detail, Ranking, Profile, Log in, Register, private-site login, guest home and 404 are drafted on the Figma page "Phase 3 · Review". The Figma MCP tool limit on the Starter plan stopped the phone views, so (owner decision) the rest is an HTML mockup, `phase3-pages.html`: Profile with the radar (light + dark) and phone views of Submissions, Ranking and Profile. For later gates, prefer HTML mockups and keep Figma for the library.

## 9. Backend additions the UI needs

Each lands in the phase that consumes it. All are additive (new fields/endpoints/params; new migrations where a column is needed).

- **B1** Per-collection solved/total for the current user (Home "within reach", Home collections, Problems collection chip).
- **B2** Server-side status filter on the problem list (`solved` / `attempted` / `unsolved`) compatible with the keyset pagination, plus counts per status for the segmented control.
- **B3** Global ranking by total XP with competition ranking (shared with the profile's global rank); a weekly window (XP awarded in the last 7 days); the viewer's own rank row regardless of page.
- **B4** Contest problem order/letter: a `position` on `contest_problems` (migration) set by the admin reorder UI; contest pages derive letters from it.
- **B5** Admin users list: last active, solved count, XP; bulk role change.
- **B6** Admin problems list: testcase count, problem type, submission count / `type_locked` flag; bulk rejudge endpoint (the frontend loop shipped in PR #26 is acceptable until then).
- **B7** Authoring draft list readiness fields: testcase pair counts, latest PDF revision, solution present, latest job outcome per job type.
- **B8** Staff-callable user search by username (for linking author profiles); drafts-per-profile count.
- **B9** Running contest scoreboard: per-problem attempts and time of best score.
- **Optional** server time for countdown skew; judge queue / system-error metrics for an admin "needs attention" view.

## 10. Phases

Each phase is one PR (or a small stack) to `main`, shippable through CD, with visual baselines regenerated and reviewed.

1. **Foundation:** tokens (light/dark) replacing the Bootstrap values and legacy aliases in `src/index.css`; IBM Plex Sans Thai + JetBrains Mono; SVG logo; emoji removed; Button/StatusBadge restyled; CodeEditor theme-aware. Every page shifts to the new palette with no layout change.
2. **Shells + shared components:** (Interim rule: pages that still have their own left rail — problem detail incl. the contest problem page until phases 3/4, the authoring workspace until phase 6 — open with the global sidebar collapsed, so production never shows two rails side by side.) add Base UI and cmdk; move Dialog/ActionMenu/Drawer internals onto Base UI with unchanged APIs; AppShell (sidebar, collapse, mobile tab bar), ContestShell, FocusShell, AuthShell, ⌘K palette (cmdk), PageHeader, FilterBar, DataTable (+ mobile two-line mode), BulkBar, VerdictText + TestcaseStrip + StatusMark, Countdown (+ `useCountdown`, contest-state helper), ProgressBar, EmptyState / InlineError / InlineNotice, Field + FormError, FileDrop, ConfirmDialog tiers, StatusDot, SettingsRow, Drawer usage rules. Old navbars removed; all existing pages render inside the new shell with the new PageHeader. Then push tokens + components to Figma (§8).
3. **Student pages:** Home, Problems, Problem detail + inline result, Submissions + detail, Ranking, Profile, Auth, guest home, 404. Backend B1, B2, B3.
4. **Contest pages:** list, lobby/states, contest problem table, contest problem page, scoreboard, submissions. Backend B4, B9.
5. **Manage:** Users, Problems (+ full-page editor), Contests (+ full-page editor), Analysis, Settings, `/admin` redirect. Backend B5, B6.
6. **Authoring:** draft list, author profiles, workspace header + step tabs, all step tabs, editor, verify & publish. Backend B7, B8.

## 11. Decisions made by Claude during design (owner may override)

- Phosphor only (not Lucide too), so icons stay consistent.
- IBM Plex Sans Thai + JetBrains Mono.
- 1040px content width in mockups; one value everywhere (builder may tune ±).
- Sidebar 220px, collapsible, remembered per browser.
- Stepped green levels rather than a continuous gradient for the week strip (owner asked for "gradient by count"; implemented as the existing 4-level heatmap scale).
- UI stays English.
- CSS Modules stay; no Tailwind.
- Problem/contest editing moves from modals to full pages with URLs.
- Week strip counts distinct problems Accepted per day (levels 1 / 2 / 3–4 / 5+); profile heatmap keeps counting submissions.
- Until a page's own left rail is removed, the global sidebar starts collapsed on that page.
- Contest Participants tab is read-only.
- No Code Connect (Figma Starter plan); Figma component names mirror React names.
- Libraries: Base UI + cmdk + NumberFlow; the rest of the offered list declined (§5.1).

Owner decisions recorded during review: Ranking by XP with a weekly view (§7.5); Figma approval gate before phases 3–6 (§8).

## 12. Left to the builder

- Exact spacing/radius scale and the type ramp beyond the sizes in §5.
- Component APIs and file layout under `src/components/`.
- Whether submission detail is a route or a linkable drawer.
- Testcase strip compact form for problems with many cases.
- How each phase is split into commits, and test strategy within the repo's existing rules.

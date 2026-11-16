# Grader UI audit — 2026-11-15

Screenshots: 87 captures (desktop light/dark 1440, mobile 390) of every route, local stack, admin account, small dev DB.
Taken against the design direction agreed in brainstorming (B base + D dark, sidebar nav "D" variant, home B+A).

## Measured cross-page problems
- Content width differs per page: Home 880, Profile 920, Problems 1096, Submissions/Scoreboard 1160, Admin hub 1096 vs admin tables 1160, Contests 1120 (160–1280), contest scoreboard 1160; problem detail = 232px rail + iframe.
- H1 offset drifts (y 103–143); problem detail title is h2; Settings and Author profiles use other header patterns. Three header patterns in admin alone.
- Mobile: global top nav overflows on every page (page 455px wide at 390), Contests/Admin unreachable; tables cut off their Actions column; authoring tables wrap one character per line.
- Table cells centred everywhere; per-row coloured buttons (green "New", blue "View Code", blue "Problems", orange gradient Join).
- Bootstrap blue #0d6efd in buttons, toggles, active tabs, links, chart palette; Inter not Thai-capable; 5–6 mono stacks; CodeEditor always atom-one-dark + Fira.
- Two hand-rolled modals (ProblemModal, ContestModal) beside shared Dialog; window.confirm / alert() in places; emoji in modals and contest pages (⚠️ ✅ ❌ ⏱️ 🏅 🔑).
- Status as clickable pills (visibility toggles with one click); medal tints on scoreboards; decorative icons (flame, arrows).
- Loading/empty/error states invented per page (bare <p>, h3, full-page spinner, quote on home, PDF iframe with no fallback).

## Per page — problem → proposal (priority)
### Student
- Home (H): hero with 4 type styles, blue flame, duplicate CTA, quote. → agreed B+A layout. Collection progress needs backend aggregate.
- Problems (H): 92px shadow cards, green "New" button per row means nothing, no status filter. → PageHeader + Toolbar (search, All/Unsolved/Attempted/Solved, Difficulty/Category/Collection/Sort chips) + dense table (status, id, title, difficulty, best strip+score, last tried); spoiler-safe categories kept. Server status filter = backend.
- Problem detail (H): 232px rail stack, blue tabs, PDF iframe only, mobile rail 232 of 390. → page header (breadcrumb, title, id, limits, languages, best strip, Starter) + tabs Statement/Submit/Submissions; PDF loading + fallback; result inline after submit.
- Submissions + modal (H): blue "View Code" per row, colour-only statuses, centred, no time/mem, Apply-button filters; modal lacks summary and limits. → toolbar + table (id, when, user, problem, verdict mono + strip, score, time/mem, lang), row opens detail route/drawer with verdict header, clickable strip, case table vs limits, compile log, code with copy + resubmit.
- Scoreboard/Ranking (M): tinted top-3, medals, centred, you not shown. → dense table, bold top 3 only, your row pinned (backend for off-page rank), weekly = backend.
- Profile (M): 7 card styles, radar clipped, 17-row empty category list, 8 locked achievement cards, mobile heatmap shows oldest months. → header (tier, Lv, XP bar, rank), one stat row, right-anchored heatmap, recent solves + verdicts / category bars + languages, compact achievements.

### Contest (scoring is IOI sum, tie by last improvement time; no penalty/freeze; no problem order column)
- List (H): cards with orange gradient buttons, no grouping/countdown, finishing = dead end, emoji. → Live / Upcoming / Past sections, rows with window, countdown, counts, one action; HIDDEN tag for staff.
- Detail/lobby (H): countdown not live, "Soon remaining" bug, alert() on join, no lobby, finished contests unreachable. → lobby with big countdown, rules, roster; running-not-joined shows letters + Join; finished recap for everyone.
- Problems (M): no letters, redundant Action column and badges. → contest landing table A/B/C with strip/score/attempts. Letter order needs backend position column.
- Scoreboard (H): ranks by row index (differs from global), raw problem ids, not linked users, medal tints. → LIVE/FINAL header, rank, user, total + last-improvement time, A/B/C cells, sticky, your row highlighted. Attempts while running = backend.
- Submissions (M): defaults to all. → Mine by default, verdict mono + strip, join-to-see empty state.
- Contest problem detail (H): no timer (navbar never polls), Submit stays open after end, navigate(-1) back. → contest sidebar (agreed), header with letter, Submit closes at end.

### Manage
- Admin hub (M): six cards repeating the nav. → remove; /admin redirects (optional "needs attention" list, backend).
- Users (H): 2 columns, always-on bulk buttons, batch form under table, passwords left on page, delete cascades with plain confirm. → header actions, role segmented filter, columns (status, solved, joined, last active=backend), row ⋯, inline bulk bar, batch-create drawer with CSV download, edit drawer, type-to-confirm delete.
- Problems (H): blue, centred, visibility pill toggles, fixed 7-button selection bar, hand-rolled modal with emoji and raw inputs, type lock only learned from 409. → table (id, title, type, difficulty, tests=backend, TL/ML, collection, visibility dot), row ⋯, inline bulk bar, full-page editor /admin/problems/:id with General/Statement/Testcases/Files/Danger tabs, create = small modal.
- Contests (H): blue Problems button, pink badge, no links, modal a11y issues, no timezone, 30-min steps, minDate blocks past fix. → table + segmented status, full-page editor with Settings/Problems(ordered)/Participants, create drawer with duration presets and "Asia/Bangkok (UTC+7)".
- Analysis (M; mobile overflow H): card wrapper, state not in URL, red deltas, duplicate pie, Bootstrap chart palette. → range in header, tabs as routes, KPI strip, shared verdict tokens, standard tables.
- Settings (M): different header, instant apply incl. Private with no confirm, blue toggles, pink danger box. → SettingsRow lists (Access, Data + danger zone dialog), confirm going Private (warn if contest running), saved indicator.

### Authoring
- Draft list (H): mobile one-char wrap, duplicate headers, sub-pages as buttons, status lacks reasons. → PageHeader + sub-tabs Drafts/Author profiles/AI docs, readiness dots (backend fields).
- Author profiles (M): header mismatch, link user by numeric id. → table, drawer edit, username picker (staff user-search endpoint = backend).
- Workspace + metadata (H): flat 8-link rail, unlabeled badges, inverted label/input sizes. → keep global sidebar, draft header (status, save state rev, one contextual primary), step tabs with done/todo/stale/failed glyphs (computable in frontend), two-column metadata.
- Statement tab (M): shows no statement. → read-only paper preview + Edit, one-line PDF row with Rebuild, FileDrop assets.
- Full-screen editor (H): bare textarea, preview clipped, crowded bar, save state hidden after publish, mobile overlap. → FocusShell (hides sidebar), shared code editor, Fit zoom, always-visible save state, mobile tabs.
- Solution/Generator (M): editor always dark, compile output elsewhere. → result panel under editor, theme-aware, Generate inputs here.
- Testcases (H): 3-deep headers, 30 buttons for 10 cases, mobile one-char wrap. → summary line, compact table with ⋯, FileDrop, mobile view-only.
- Verify & publish (H): contradictory checklist, three equal blue buttons, no reason when publish disabled. → ReadinessList with inline fix links + footer with Publish and blocking reason.
- History / AI docs (L): → timeline + log drawer; AI docs as Authoring sub-tab.

### Auth & guest
- Login/Register (H): shadow card, browser-blue link, nav overflow, no role=alert/aria-invalid/autocomplete, button not disabled while pending, rules hidden. → AuthShell (logo + 360px column), field hints, pending state, show-password.
- Guest home (M): misaligned hero. → public: sidebar shell + recent problems + contests; private: AuthShell.
- 404 (L): → inside AppShell, mono 404 + path, Go home / Search.

## Shared components the redesign introduces
AppShell (sidebar) / ContestShell / FocusShell / AuthShell; PageHeader; Toolbar/FilterBar (URL-synced); DataTable (left text, right mono numbers, row click, ⋯ menu, two-line mobile collapse, skeleton/empty/error); BulkBar (inline sticky); VerdictText + TestcaseStrip + ScoreCell + StatusMark; Countdown (+useCountdown, ContestState helper); ProgressBar; EmptyState/InlineError/InlineNotice; StepTabs + ReadinessList; Field + FormError; FileDrop; ConfirmDialog tiers (plain / destructive / type-to-confirm); StatusDot; SettingsRow; CodeEditor (light+dark, JetBrains Mono); Drawer/Dialog/full-page rule (1–3 fields → dialog, <8 fields with context → drawer, multi-part revisited objects → page with URL).

## Confirmed bugs (verified in source)
1. Admin Problems bulk Rejudge rejudges only selectedProblemIds[0] while saying "N selected" — features/admin/problems/ProblemManagement.tsx:459.
2. Contest detail in finishing state shows "Soon remaining" — pages/contest/ContestDetail.tsx:15,87,95.
3. Authoring Generate inputs ignores the seed field, always '12345' — features/admin/authoring/DraftWorkspace.tsx:143 (state at :256).
4. Verify checklist: Solution "add it" link goes to Testcases — DraftWorkspace.tsx:407.
5. "1 months ago" pluralisation — utils/formatters.ts:23.
Reported, not yet verified: register success message never visible; auth submit not disabled while pending; statement editor hides save state for previously published drafts.

## Backend gaps
Per-collection solved/total; server-side problem status filter; weekly ranking + viewer's own rank row; contest problem position/letter; per-problem attempts + solve time on running scoreboard; optional server time; admin users last-active/solved/XP + bulk role; admin problems testcase count/type/submission count + type_locked flag + bulk rejudge; authoring draft list readiness fields; staff user-search endpoint; drafts-per-profile count; judge queue / system-error metrics.

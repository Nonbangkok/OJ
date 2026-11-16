# UI Redesign Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page switches to the new neutral visual system (tokens, fonts, logo, icons, code colours, buttons, badges) with no layout change.

**Architecture:** Nearly all colours already flow through CSS custom properties in `frontend/src/index.css` (`:root` and `[data-theme='dark']`, toggled by `ThemeContext` setting `data-theme` on `<html>`). Phase 1 changes token *values*, adds a few tokens, and removes the places that bypass tokens (literal font stacks, gradients, emoji, hardcoded hex in TS, the highlight.js theme import, PNG logos). A Jest "design guard" suite reads source files and fails on regressions, so later phases cannot reintroduce them.

**Tech Stack:** React 19, Vite 8, CSS Modules, Jest (jsdom, `identity-obj-proxy` for CSS modules), Playwright visual tests, `@phosphor-icons/react`, highlight.js 11.

**Spec:** `docs/superpowers/specs/2026-11-15-ui-redesign-design.md` (§5 visual system, §10 phase 1).

## Global Constraints

- No layout changes in this phase: sizes, grids, page structure and copy stay as they are (except removing emoji and the gradient/medal decoration listed below).
- Keep every existing CSS variable name working (other files reference them); change values, add new names, delete only the variables this plan names.
- Fonts: IBM Plex Sans Thai (400, 500, 600) for UI; JetBrains Mono (400, 500) for ids/numbers/code. Loaded from Google Fonts in `index.css` (CSP already allows `fonts.googleapis.com` / `fonts.gstatic.com`).
- Icons: `@phosphor-icons/react` only. No emoji in `src/` outside `src/tests/`.
- Colours must meet WCAG AA: text ≥ 4.5:1 on the background it sits on.
- No `linear-gradient(` / `radial-gradient(` anywhere in `src/`.
- Commits: no `Co-Authored-By` trailer (owner is sole author). Run frontend tests with `npx jest <file>` for one file and `npm run validate` before the last commit.
- Work on a branch cut from `design/ui-redesign` (or `main` once the design doc is merged).

## Review Focus

1. **Theme switched at runtime** — every colour token defined in `:root` that a component uses must resolve to a readable value in dark mode too; a token defined only in `:root` silently stays light. → Task 1 test "every themed token has a dark value".
2. **Thai text in bold/medium** — problem titles and statements are Thai; if only weight 400 of IBM Plex Sans Thai loads, 500/600 Thai fall back to faux-bold or the OS font. → Task 2 test asserts the font URL requests 400;500;600.
3. **Fonts blocked or offline** — the stack must fall back to a Thai-capable system font, not a Latin-only one. → Task 2 test asserts the sans stack contains `'Noto Sans Thai'` and `Tahoma` after IBM Plex Sans Thai.
4. **Syntax-highlighted code in light mode** — today code is always on a dark editor; once light, keyword/string colours must stay readable on the light editor background. → Task 3 contrast cases for every `--code-*` token in both themes.
5. **Keyboard focus** — with a near-black primary button and no blue, the focus ring must still be visible on both themes. → Task 1 contrast case `--action-focus-ring` vs `--background-primary` ≥ 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/index.css` | Token values (light + dark), font imports, new tokens (`--font-family-mono`, `--logo-accent`, `--code-*`). |
| `frontend/src/styles/codeHighlight.css` (new) | highlight.js token colours bound to `--code-*`; replaces `atom-one-dark.css`. |
| `frontend/src/components/brand/GraderLogo.tsx` (new) | The three-crescent mark as inline SVG. |
| `frontend/public/favicon.svg` (new) | Same mark for the browser tab. |
| `frontend/src/tests/design/tokenUtils.ts` (new) | Test helpers: parse token blocks, resolve `var()`, contrast ratio. |
| `frontend/src/tests/design/designGuards.test.ts` (new) | Source-scanning guards + token contrast cases; each task adds its `describe` block. |
| CSS modules / TSX listed per task | Remove literal fonts, gradients, emoji, hex; restyle Button and StatusBadge. |

---

### Task 1: Token palette (light + dark) with contrast tests

**Files:**
- Create: `frontend/src/tests/design/tokenUtils.ts`, `frontend/src/tests/design/designGuards.test.ts`
- Modify: `frontend/src/index.css` (`:root` block lines ~18–243, `[data-theme='dark']` block lines ~245–345)
- Modify: `frontend/src/features/scoreboard/ScoreboardTable.module.css` (rank-1/2/3 tints)

**Interfaces:**
- Produces (test helpers, used by Tasks 2–3):
  - `readSource(relPath: string): string` — file under `frontend/src`.
  - `listSourceFiles(exts: string[]): string[]` — all files under `frontend/src` excluding `src/tests/`.
  - `parseTokenBlock(css: string, selector: ':root' | "[data-theme='dark']"): Record<string, string>` — first block for that selector, `--name → raw value`.
  - `resolveColor(name: string, theme: 'light' | 'dark'): string` — resolves `var()` chains (dark falls back to `:root`), returns `#rrggbb`; `rgba()` composited over `--background-primary` of that theme.
  - `contrast(a: string, b: string): number` — WCAG ratio.

- [ ] **Step 1: Write the failing tests** in `designGuards.test.ts` → `describe('tokens')`:
  - `it.each` contrast cases, both themes, each `≥ 4.5` unless noted:
    `--text-primary`/`--background-primary`, `--text-primary`/`--background-secondary`, `--text-muted`/`--background-primary`, `--text-muted`/`--background-secondary`, `--action-primary-foreground`/`--action-primary-background`, `--action-destructive-foreground`/`--action-destructive-background`, `--verdict-accepted`/`--background-primary`, `--verdict-wrong`/`--background-primary`, `--verdict-time`/`--background-primary`, `--status-success`/`--background-primary`, `--status-danger`/`--background-primary`, `--action-focus-ring`/`--background-primary` (≥ 3).
  - `it('every themed token has a dark value')`: every `:root` token whose resolved light value is a colour and whose name is not in `THEME_CONSTANT = ['--statement-paper', '--statement-stripe-a', '--statement-stripe-b', '--statement-page-number', '--statement-separator', '--statement-empty', '--statement-continued', '--action-button-foreground', '--contest-action-foreground', '--text-on-primary', '--action-primary-foreground', '--action-destructive-foreground']` either is overridden in the dark block or resolves through `var()` to one that is.
  - `it('no Bootstrap palette in source')`: no file from `listSourceFiles(['.css', '.ts', '.tsx'])` contains (case-insensitive) any of `#007bff #0056b3 #0069d9 #0d6efd #0b5ed7 #3d8bfd #6ea8fe #005fcc #17a2b8 #138496 #28a745 #218838 #6c757d #545b62 #495057 #212529 #f8f9fa #e9ecef #dee2e6`.

- [ ] **Step 2: Run** `npx jest src/tests/design/designGuards.test.ts` — Expected: FAIL (contrast of `--verdict-accepted` `#48bb78` ≈ 2.4, Bootstrap hexes present in `index.css`, `analysisCharts.ts`, `StatementEditor.tsx`).

- [ ] **Step 3: Rewrite token values in `index.css`.** Core values (spec §5; success text darkened from the spec's `#16a34a` to `#15803d` to pass AA on white — `#16a34a` is kept for fills via `--status-success-bg`):

  | Token | Light | Dark |
  |---|---|---|
  | `--background-primary` | `#ffffff` | `#0d1117` |
  | `--background-secondary` | `#fafafa` | `#161b22` |
  | `--background-tertiary` | `#f4f4f5` | `#21262d` |
  | `--border-color` | `#e4e4e7` | `#30363d` |
  | `--text-primary` / `--text-secondary` / `--text-muted` | `#18181b` / `#3f3f46` / `#71717a` | `#e6edf3` / `#c9d1d9` / `#8b949e` |
  | `--accent-primary` / `--accent-primary-hover` | `#18181b` / `#3f3f46` | `#e6edf3` / `#c9d1d9` |
  | `--action-primary-background` / `-foreground` | `#18181b` / `#ffffff` | `#e6edf3` / `#0d1117` |
  | `--action-focus-ring` | `#18181b` | `#e6edf3` |
  | `--button-danger-bg` / `--button-danger-hover` | `#dc2626` / `#b91c1c` | `#da3633` / `#f85149` |
  | `--status-success` / `-danger` / `-warning` / `-info` | `#15803d` / `#dc2626` / `#b45309` / `#52525b` | `#3fb950` / `#f85149` / `#d29922` / `#8b949e` |
  | `--status-success-bg` (fills) | `#16a34a` | `#238636` |
  | `--verdict-accepted` / `-wrong` / `-time` / `-memory` / `-runtime` / `-compilation` / `-pending` | `#15803d` / `#dc2626` / `#b45309` / `#c2410c` / `#9a3412` / `#71717a` / `#71717a` | `#3fb950` / `#f85149` / `#d29922` / `#db6d28` / `#f0883e` / `#8b949e` / `#8b949e` |
  | `--box-shadow`, `--surface-elevation`, `--shadow-hover` | `none` | `none` |
  | `--box-shadow-lg` (menus/dialogs only) | `0 12px 32px -10px rgba(0,0,0,.25)` | `0 12px 32px -10px rgba(0,0,0,.6)` |
  | `--radius-sm` / `--radius-md` / `--radius-lg` | `4px` / `6px` / `8px` | same |
  | `--logo-accent` (new) | `#a6a6a6` | `#a6a6a6` |

  Then map the remaining families onto these (no new hues):
  - `--status-info*`, `--feedback-info-*`, `--contest-badge-scheduled-*`, `--contest-badge-finished-*`, `--migrationProblemItem-background`, `--navbar-slider-background`, `--action-edit-*`, `--action-problems-*`, `--action-neutral-button-*`, `--action-create-*` → neutral zinc values (light: bg `#f4f4f5`, fg `#3f3f46`, border `#e4e4e7`; dark: bg `#21262d`, fg `#c9d1d9`, border `#30363d`). Coloured management buttons become neutral (spec §2 anti-goal).
  - `--contest-badge-running-*`, `--feedback-success-*`, `--success-tint-*`, `--background-success` → green tint (light bg `#f0fdf4`, fg `#15803d`, border `#bbf7d0`; dark bg `#0f2a19`, fg `#3fb950`, border `#1f6f37`).
  - `--contest-badge-finishing-*`, `--warning-tint-*`, `--status-warning-bg`, `--text-warning`, `--warning-color` → amber (light bg `#fffbeb`, fg `#b45309`, border `#fde68a`; dark bg `#2b2111`, fg `#d29922`, border `#6e5313`).
  - `--feedback-error-*`, `--danger-tint-bg`, `--error-bg`, `--background-error`, `--error-text` → red (light bg `#fef2f2`, fg `#dc2626`, border `#fecaca`; dark bg `#2d1214`, fg `#f85149`, border `#6e2b2b`).
  - Delete `--contest-action-*-from/-to` tokens (Task 5 removes their only user) and `--medal-*` (this task removes their user).
  - Keep `--heatmap-*` and `--difficulty-band-*` as they are (already AA, reused by later phases).
  - Editor tokens become theme-following: `--editor-bg` `#fafafa`/`#0d1117`, `--editor-surface` `#f4f4f5`/`#161b22`, `--editor-border` `#e4e4e7`/`#30363d`, `--editor-border-strong` `#d4d4d8`/`#484f58`, `--editor-text` `#18181b`/`#e6edf3`, `--editor-gutter-text` and `--editor-gutter-muted` `#a1a1aa`/`#6e7681`, `--editor-focus` `#18181b`/`#e6edf3`. Same for `--editor-chrome-*` (toolbar follows theme: bg = `--background-secondary`, text = `--text-primary`, muted = `--text-muted`, button bg = `--background-tertiary`, border = `--border-color`).
  - In `ScoreboardTable.module.css` delete the rank-1/2/3 background tints and their `:global([data-theme='dark'])` variants; keep `font-weight: 600` on ranks 1–3.

- [ ] **Step 4: Run** `npx jest src/tests/design/designGuards.test.ts -t tokens` — Expected: contrast and dark-value cases PASS; the Bootstrap case still FAILS only for `analysisCharts.ts` and `StatementEditor.tsx` (fixed in Task 3).

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): neutral light and dark token palette"`

---

### Task 2: Fonts — IBM Plex Sans Thai + one mono stack

**Files:**
- Modify: `frontend/src/index.css` (lines 1–3 imports; `--font-family-sans-serif` line ~111; `code {}` rule line ~369)
- Modify (replace every literal `font-family` with `var(--font-family-mono)`): `features/problem/ProblemCard.module.css:272`, `features/problem/submission/CodeSubmissionForm.module.css:8,33`, `features/problem/submission/SubmissionModal.module.css:131`, `features/admin/problems/ProblemFilesSection.module.css:88,107`, `features/admin/authoring/Authoring.module.css:93,210,1161,1231,1249`, `features/admin/authoring/AiDocs.module.css:141,156`, `pages/home/Home.module.css:160`, `pages/problem/ProblemDetail.module.css:148,353,406`, `pages/user/UserProfile.module.css:141,226,244,308,337,483,601`, `components/styles/CodeEditor.module.css:8`
- Modify (inline `fontFamily: '"Fira code", "Fira Mono", monospace'` → `'var(--font-family-mono)'`): `features/admin/authoring/CodeEditor.tsx:67`, `features/problem/submission/CodeSubmissionForm.tsx:75`, `features/problem/submission/SubmissionModal.tsx:138`
- Test: `frontend/src/tests/design/designGuards.test.ts` (`describe('fonts')`)

**Interfaces:**
- Consumes: `readSource`, `listSourceFiles`, `parseTokenBlock` (Task 1).
- Produces: CSS variable `--font-family-mono` (used by Task 3's code theme and all later phases).

- [ ] **Step 1: Write the failing tests** (`describe('fonts')`):
  - `index.css` imports exactly one Google Fonts URL containing `family=IBM+Plex+Sans+Thai:wght@400;500;600` and `family=JetBrains+Mono:wght@400;500`, and no `Inter` / `Inconsolata`.
  - `--font-family-sans-serif` starts with `'IBM Plex Sans Thai'` and contains `'Noto Sans Thai'` and `Tahoma` before the generic `sans-serif`.
  - `--font-family-mono` starts with `'JetBrains Mono'` and ends with `monospace`.
  - No file from `listSourceFiles(['.css'])` has a `font-family:` declaration whose value is not `inherit` or starts with `var(--font-family-`.
  - No file from `listSourceFiles(['.ts', '.tsx', '.css'])` contains `Fira` or `Inconsolata` or `source-code-pro`.

- [ ] **Step 2: Run** `npx jest src/tests/design/designGuards.test.ts -t fonts` — Expected: FAIL (Inter import, ~30 literal stacks).

- [ ] **Step 3: Implement.** One `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');`. Tokens: `--font-family-sans-serif: 'IBM Plex Sans Thai', 'Noto Sans Thai', 'Leelawadee UI', Tahoma, system-ui, sans-serif;` and `--font-family-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`. Replace each listed declaration; the `code {}` rule uses the mono variable.

- [ ] **Step 4: Run** `npx jest src/tests/design/designGuards.test.ts -t fonts` — Expected: PASS. Then `npx jest src/tests/features/admin src/tests/components/CodeSubmissionForm.test.tsx src/tests/components/SubmissionModal.test.tsx src/features/admin/authoring` — Expected: PASS (inline style changes do not affect assertions; fix any test asserting the old font string).

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): IBM Plex Sans Thai and a single JetBrains Mono stack"`

---

### Task 3: Theme-aware code colours; no hardcoded hex in TS

**Files:**
- Create: `frontend/src/styles/codeHighlight.css`
- Modify: remove `import 'highlight.js/styles/atom-one-dark.css';` from `features/admin/authoring/CodeEditor.tsx:4`, `features/problem/submission/SubmissionModal.tsx:5`, `hooks/useCodeSubmission.ts:6`; import `./styles/codeHighlight.css` once from `frontend/src/index.tsx`, right after `import './index.css';`
- Modify: `frontend/src/index.css` (add `--code-*` tokens in both blocks)
- Modify: `frontend/src/features/admin/analysis/analysisCharts.ts:8-31` (palette constants)
- Modify: `frontend/src/features/admin/authoring/StatementEditor.tsx:85-95` (inline button styles)
- Test: `designGuards.test.ts` (`describe('code colours')`), plus existing analysis/StatementEditor tests

**Interfaces:**
- Consumes: Task 1 helpers; `--font-family-mono` (Task 2).
- Produces: tokens `--code-text, --code-comment, --code-keyword, --code-string, --code-number, --code-title, --code-type, --code-meta` (both themes).

- [ ] **Step 1: Write the failing tests** (`describe('code colours')`):
  - `it.each` over the 8 `--code-*` tokens × both themes: contrast vs `--editor-bg` ≥ 4.5.
  - No source file imports from `highlight.js/styles/`.
  - `codeHighlight.css` defines colours only through `var(--code-` (no hex), and styles `.hljs-comment`, `.hljs-keyword`, `.hljs-string`, `.hljs-number`, `.hljs-title`, `.hljs-type`, `.hljs-meta`, `.hljs-built_in`, `.hljs-literal`.
  - (Task 1's Bootstrap guard now passes for all files.)

- [ ] **Step 2: Run** `npx jest src/tests/design/designGuards.test.ts -t "code colours"` — Expected: FAIL (tokens undefined, imports present).

- [ ] **Step 3: Implement.**
  - Code tokens — light (on `#fafafa`): text `#18181b`, comment `#6b7280`, keyword `#9d174d`, string `#166534`, number `#9a3412`, title `#1d4ed8`, type `#7c2d12`, meta `#52525b`. Dark (on `#0d1117`): text `#e6edf3`, comment `#8b949e`, keyword `#ff7b72`, string `#a5d6ff`, number `#79c0ff`, title `#d2a8ff`, type `#ffa657`, meta `#8b949e`. (Syntax colours are the one place hue is allowed; they never appear outside code.) `.hljs` background is `transparent` so the editor's own `--editor-bg` shows.
  - `analysisCharts.ts`: light `{ text: '#71717a', grid: '#e4e4e7', series: ['#18181b', '#16a34a', '#dc2626', '#b45309', '#71717a', '#9a3412', '#a1a1aa', '#3f3f46'] }`, dark `{ text: '#8b949e', grid: '#30363d', series: ['#e6edf3', '#3fb950', '#f85149', '#d29922', '#8b949e', '#f0883e', '#6e7681', '#c9d1d9'] }`; verdict map uses the verdict values from Task 1's table (light set; dark set when the existing code chooses the dark palette).
  - `StatementEditor.tsx` preview-tab buttons: replace the inline style object with CSS-module classes in `Authoring.module.css` using `--border-color`, `--background-tertiary`, `--text-primary`, and the active state `--action-primary-background` / `--action-primary-foreground`. Keep the function's return shape if tests depend on it; otherwise return a `className`.

- [ ] **Step 4: Run** `npx jest src/tests/design src/tests/analysis src/features/admin/authoring/StatementEditor.test.tsx src/tests/components/SubmissionModal.test.tsx src/tests/components/CodeSubmissionForm.test.tsx` — Expected: PASS (update any assertion on the old hex values to the new ones).

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): theme-aware code colours and token-based chart palette"`

---

### Task 4: Grader logo as SVG

**Files:**
- Create: `frontend/src/components/brand/GraderLogo.tsx`, `frontend/public/favicon.svg`
- Modify: `components/navbar/Navbar.tsx:7-8,18`, `layouts/admin/AdminNavbar.tsx:4-5,19`, `layouts/contest/ContestNavbar.tsx:8-9,19`, `components/shared/LoadingPage.tsx:3-4` (replace the PNG pair + theme switch with `<GraderLogo />`), `frontend/index.html:5` (add `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` before the `.ico` link, keep the `.ico` as fallback)
- Delete: `frontend/src/assets/logo512.png`, `frontend/src/assets/logo512_darkmode.png` (public PNGs used by `manifest.json` stay)
- Test: `frontend/src/tests/components/GraderLogo.test.tsx`, `designGuards.test.ts` (`describe('logo')`)

**Interfaces:**
- Produces: `GraderLogo(props: { size?: number; className?: string; title?: string }): JSX.Element` — default `size` 24, `title` `"Grader"`; renders `<svg role="img" aria-label={title} width={size} height={size} viewBox="0 0 512 512">`.

- [ ] **Step 1: Write the failing tests:**
  - `GraderLogo.test.tsx`: renders `getByRole('img', { name: 'Grader' })`; `size={32}` sets `width="32"`; the svg contains exactly 3 crescent shapes (`container.querySelectorAll('[data-crescent]').length === 3`); two have `fill="currentColor"`, one has `fill="var(--logo-accent)"`.
  - `describe('logo')`: no source file imports `assets/logo512`.

- [ ] **Step 2: Run** `npx jest src/tests/components/GraderLogo.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `GraderLogo`.** Each crescent is a circle minus a "bite" circle, drawn with an SVG `<mask>` (white outer circle, black bite circle) applied to a filled circle. Geometry measured from `logo512.png` (pixel IoU 0.999), viewBox 512:

  | Crescent | Fill | Outer circle (cx, cy, r) | Bite circle (cx, cy, r) |
  |---|---|---|---|
  | top-right | `currentColor` | 368.2, 148.2, 123.1 | 351.7, 272.8, 92.4 |
  | left | `currentColor` | 145.4, 314.9, 130.9 | 213.8, 405.4, 98.3 |
  | bottom-right | `var(--logo-accent)` | 400.4, 365.9, 101.1 | 466.6, 392.5, 66.6 |

  Mask ids must be unique per instance (`useId`). `favicon.svg` is the same markup with `currentColor` replaced by `#18181b` and the accent by `#a6a6a6`. Call sites pass the size they render today (navbar logos are ~32px — read each module's CSS).

- [ ] **Step 4: Run** `npx jest src/tests/components/GraderLogo.test.tsx src/tests/design src/tests/Navbar.test.tsx src/tests/layouts` — Expected: PASS (update any navbar test that queried the logo by `alt` text to the new accessible name `Grader`).

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): Grader logo as a theme-aware SVG"`

---

### Task 5: Remove emoji, gradients and decorative glyphs

**Files:**
- Modify (emoji → Phosphor icon with `aria-hidden="true"`, or removed):
  - `components/shared/ThemeToggleButton.tsx:13` — `🌙`/`☀️` → `<Moon size={18} />` / `<Sun size={18} />`; update `src/tests/components/ThemeToggleButton.test.tsx` to assert the accessible label only (labels unchanged).
  - `features/admin/problems/ProblemModal.tsx:60,75,76` — `⚠️` → `<Warning />`; `✅ Upload finished!` → `<CheckCircle />` + `Upload finished.`; `❌ Upload failed.` → `<XCircle />` + `Upload failed.`
  - `features/admin/contests/ContestModal.tsx:41,122` — `⚠️` → `<Warning />`; `⏱️` → `<Timer />`.
  - `pages/contest/Contests.tsx:35` — `⚠️` → `<Warning />`.
  - `features/contest/ContestCard.tsx:84` — `🔑 Login to Join` → `Log in to join` (no icon).
  - `features/contest/ContestList.tsx:8` and `pages/problem/Problems.tsx:393` — delete the emoji icon element (and its now-unused CSS class).
  - `features/problem/submission/SubmissionModal.tsx:122` — `'✓'` → `<Check size={18} aria-hidden="true" />`.
- Modify (gradients → solid tokens):
  - `features/contest/ContestCard.module.css:136-161` — the four gradient button variants become solid: enter/join → `--action-primary-background`/`-foreground` (hover `--action-primary-hover-background`); scoreboard/login → `--action-secondary-*` with a 1px `--border-color` border.
  - `components/shared/LoadingPage.module.css:39,120` — remove the radial glow and dotted background (plain `--background-primary`).
  - `pages/user/UserProfile.module.css:283,295` — gradient fills → solid `--text-primary`.
- Test: `designGuards.test.ts` (`describe('decoration')`), updated component tests

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests** (`describe('decoration')`):
  - No file from `listSourceFiles(['.ts', '.tsx', '.css'])` matches `/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{FE0F}]/u`.
  - No file from `listSourceFiles(['.css', '.ts', '.tsx'])` contains `gradient(`.
  - `ThemeToggleButton.test.tsx`: light theme renders a button labelled `Switch to dark mode` that contains an `svg`; dark theme labelled `Switch to light mode`.

- [ ] **Step 2: Run** `npx jest src/tests/design -t decoration src/tests/components/ThemeToggleButton.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** the replacements listed above.

- [ ] **Step 4: Run** `npx jest src/tests/design src/tests/components src/tests/features/admin src/tests/pages` — Expected: PASS (update assertions that matched emoji text, e.g. `'✅ Upload finished!'` → `'Upload finished.'`, `'🔑 Login to Join'` → `'Log in to join'`).

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): remove emoji and gradients"`

---

### Task 6: Button and StatusBadge restyle

**Files:**
- Modify: `frontend/src/components/ui/Button.module.css`, `frontend/src/components/ui/StatusBadge.module.css`
- Test: existing `src/tests/components/ui/Button*.test.tsx`, `src/tests/components/ui/StatusBadge.test.tsx` (behaviour unchanged) + visual baselines in Task 7

**Interfaces:** `Button` and `StatusBadge` props unchanged.

- [ ] **Step 1: Restyle `Button.module.css`:** radius `var(--radius-md)` (6px); `font-weight: 500`; `default` size `min-height: 2.25rem; padding: 0.5rem 0.875rem`; `compact` `padding: 0.3125rem 0.625rem`; `secondary` = `--background-primary` fill + 1px `--border-color` border, no `box-shadow`, hover `--background-tertiary`; `neutral` = `--background-tertiary`, hover `--border-color`; `destructive` unchanged tokens; focus `outline: 2px solid var(--action-focus-ring); outline-offset: 2px`; transitions only on `background-color, border-color` at `0.15s`.
- [ ] **Step 2: Restyle `StatusBadge.module.css`:** `font-size: 12px; font-weight: 500; border-radius: var(--radius-sm); padding: 1px 6px; border: 1px solid`; tones use the tint triplets from Task 1 (neutral → zinc, info → zinc, success → green, warning → amber, danger → red); `soft` keeps the tint background and drops the border.
- [ ] **Step 3: Run** `npx jest src/tests/components/ui` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "feat(ui): neutral Button and StatusBadge styles"`

---

### Task 7: Full verification, visual baselines, PR

**Files:**
- Modify: `frontend/tests/visual/*-snapshots/*.png` (regenerated)

- [ ] **Step 1:** `cd frontend && npm run validate` — Expected: type-check, lint and all Jest suites PASS (including `src/tests/design`).
- [ ] **Step 2:** `npm run build` — Expected: success, and the CSP check reports no inline script.
- [ ] **Step 3:** `npm run test:visual` — Expected: FAIL with diffs (palette changed). Then `npm run test:visual:update` and open every regenerated PNG under `frontend/tests/visual/*-snapshots/`; check each one shows: zinc/near-black UI, no blue, IBM Plex text, SVG logo, readable dark variants. Re-run `npm run test:visual` — Expected: PASS.
- [ ] **Step 4: Manual check on the local stack** (`docker compose -p oj up --build -d` from the repo root, app at `http://localhost`): log in and open Home, Problems, a problem (Submit tab code editor in light and dark), Submissions modal, a contest card, Admin Problems, Authoring statement editor, Analysis. Confirm: Thai problem text renders in IBM Plex Sans Thai (DevTools → Computed → Rendered fonts), syntax colours readable in both themes, no console CSP errors for fonts.
- [ ] **Step 5:** Commit snapshots — `git commit -m "test(visual): baselines for the phase 1 palette"`; push the branch and open a PR to `main` titled `UI redesign phase 1: foundation` describing the token, font, logo, code-colour, emoji/gradient and Button/Badge changes, with before/after screenshots of Problems and a problem page in both themes.

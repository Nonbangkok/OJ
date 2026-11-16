# UI Redesign Phase 2b — Shared Data Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared components phases 3–6 need (verdict/testcase strip, tables, filters, bulk bar, states, confirm tiers, file drop, settings rows, countdown, progress, toast) and move the overlay primitives onto Base UI — without changing any page yet.

**Architecture:** New components live in `frontend/src/components/ui/` beside the existing primitives and are exported from `components/ui/index.ts`. They are presentation-only (props in, callbacks out) except `useUrlFilters` (search params) and `ToastProvider`. Pages adopt them in phases 3–6; this phase ships them with unit tests only. `ActionMenu`, `Dialog` and `Drawer` keep their public props and existing tests while their internals move onto `@base-ui/react`.

**Tech Stack:** React 19, CSS Modules + phase 1 tokens, `@phosphor-icons/react`, `@base-ui/react` 1.9.0 (new, exact), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-15-ui-redesign-design.md` (§5 verdicts/strip, §5.1 libraries, §7.8 shared rules for tables/bulk/confirm/edit surfaces, §10 phase 2).

## Global Constraints

- Branch `ui-redesign/phase2b-components`, cut from `ui-redesign/phase2a-shell` (2a and phase 1 are unmerged PRs).
- No page changes in this phase (except imports needed by the Base UI swap).
- Verdict text is mono uppercase and always paired with a status mark: `ACCEPTED`, `WRONG n/N`, `TIME LIMIT n/N`, `MEMORY LIMIT n/N`, `RUNTIME ERROR n/N`, `COMPILATION ERROR`, `PENDING`, `COMPILING`, `RUNNING`, `NOT RUN`; never colour alone.
- Tables: left-aligned text, right-aligned mono numbers, 1px row dividers, no centred cells, no per-row coloured buttons; row actions through a trailing `⋯` (`ActionMenu`), destructive items last and red.
- Status values (`StatusDot`) are never clickable.
- Confirm tiers: `plain` (reversible), `destructive` (red verb button, object name and counts in the copy), `typed` (type the object's name to enable).
- All new components meet the phase 1 design guards (tokens only, AA contrast, visible `:focus-visible`, no emoji/gradients).
- `@base-ui/react` pinned exactly to `1.9.0`; it is the only headless library (spec §5.1).

## Review Focus

1. **Many test cases** — a strip for a problem with 60 cases must stay one line and still say how many passed. → Task 1 test with 60 results.
2. **Keyboard-only table use** — rows that open something must be reachable and activatable with Tab/Enter without stealing clicks from links/buttons inside the row. → Task 4 tests.
3. **Typed confirm with look-alike input** — leading/trailing spaces or a different case must not enable a destructive action. → Task 7 test.
4. **Drop of the wrong file type / several files when one is allowed** — FileDrop must reject with a visible message, not silently pass it on. → Task 8 test.
5. **Overlay regressions from the Base UI swap** — Escape, focus trap, focus restore and outside-click must behave as the existing tests describe in every one of the 18 Dialog call sites. → Task 11 keeps the existing Dialog/Drawer/ActionMenu tests unchanged and runs the full suite.

---

### Task 1: Verdict primitives — `StatusMark`, `VerdictText`, `TestcaseStrip`, `ScoreCell`

**Files:** Create `src/components/ui/verdict.ts`, `Verdict.tsx`, `Verdict.module.css`; Test `src/tests/components/ui/Verdict.test.tsx`

**Interfaces:**
- `type VerdictTone = 'pass' | 'fail' | 'limit' | 'pending' | 'none'`.
- `verdictTone(status: string | null | undefined): VerdictTone` — Accepted→pass; Wrong Answer/Runtime Error/Compilation Error→fail; Time Limit Exceeded/Memory Limit Exceeded→limit; Pending/Compiling/Running→pending; Skipped/empty→none.
- `verdictLabel(status, results?: TestCaseResult[]): string` — `ACCEPTED`; `WRONG 6/10` (passed/total from results when given, else `WRONG`); `TIME LIMIT 8/10`; `MEMORY LIMIT 8/10`; `RUNTIME ERROR 3/10`; `COMPILATION ERROR`; `PENDING`/`COMPILING`/`RUNNING`; `Skipped` → `NOT RUN`; unknown → the status upper-cased.
- `<StatusMark tone={VerdictTone} size?={14} />` — check (pass, bold), x (fail, bold), timer (limit), circle-notch (pending), circle (none); `aria-hidden`.
- `<VerdictText status results? />` — StatusMark + mono label with the tone colour (`--verdict-*`).
- `<TestcaseStrip results={TestCaseResult[]} size?: 'sm' | 'lg' />` — one segment per case (pass/fail/limit/none colours), `role="img"` with `aria-label="6 of 10 test cases passed"`; when `results.length > 20` render a single proportional bar (passed / limit / failed / not run widths) with the same label.
- `<ScoreCell score={number|null} attempted={boolean} />` — `—` when not attempted; mono number; 100 → pass colour.

- [ ] **Step 1: Write the failing tests** (labels for each status incl. results counting `Accepted` cases; strip renders 10 segments and the label; 60 results → one bar element `[data-strip="bar"]` and label "45 of 60…"; ScoreCell variants).
- [ ] **Step 2: Run** `npx jest src/tests/components/ui/Verdict.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS; `npx jest src/tests/design` PASS.
- [ ] **Step 5: Commit** — `feat(ui): verdict text, status mark and testcase strip`

### Task 2: `Countdown`, `ProgressBar`, `StatusDot`

**Files:** Create `src/components/ui/Countdown.tsx`, `ProgressBar.tsx`, `StatusDot.tsx` (+ one `Indicators.module.css`); Test `src/tests/components/ui/Indicators.test.tsx`

**Interfaces:**
- `<Countdown contest={Pick<Contest,'status'|'start_time'|'end_time'>} />` — mono; running → `ENDS IN 01:42:17`; scheduled → `STARTS IN …`; finishing → `JUDGING`; finished → `ENDED`. Uses `useCountdown` (components/shell). `aria-live="off"`; `title` with the absolute time.
- `<ProgressBar value max label? tone?: 'neutral'|'pass' />` — `role="progressbar"` with `aria-valuenow/min/max` and `aria-label`; clamps to 0..max.
- `<StatusDot tone: 'neutral'|'pass'|'warn'|'fail' label />` — dot + text, plain span.

- [ ] Steps 1–5 as Task 1 (tests: each contest state's text; progress clamps 120/100 → 100 and exposes aria values; StatusDot renders text and no button). Commit `feat(ui): countdown, progress bar and status dot`.

### Task 3: `EmptyState`, `InlineError`, `InlineNotice`

**Files:** Create `src/components/ui/States.tsx`, `States.module.css`; Test `src/tests/components/ui/States.test.tsx`

**Interfaces:** `<EmptyState title description? action? />` (text-first, no illustration); `<InlineError message onRetry? />` (`role="alert"`, "Try again" button when `onRetry`); `<InlineNotice tone: 'neutral'|'warning'|'danger'|'success' title? children />` (1px border, tint background, icon by tone: info/warning/x-circle/check-circle).

- [ ] Steps 1–5 (tests: alert role, retry callback, tone class/icon). Commit `feat(ui): empty, error and notice states`.

### Task 4: `DataTable`

**Files:** Create `src/components/ui/DataTable.tsx`, `DataTable.module.css`; Test `src/tests/components/ui/DataTable.test.tsx`

**Interfaces:**
```ts
export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';          // right = mono numbers
  width?: string;
  sortable?: boolean;
  mobile?: 'primary' | 'meta' | 'hidden'; // two-line phone layout
}
export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;                    // visually hidden, names the table
  onRowClick?: (row: T) => void;      // whole row activatable
  rowHref?: (row: T) => string;       // alternative: row is a link
  rowActions?: (row: T) => ActionMenuItem[];
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
  sort?: { key: string; direction: 'asc' | 'desc'; onChange: (key: string) => void };
  loading?: boolean;                  // 5 skeleton rows
  error?: { message: string; onRetry?: () => void };
  empty?: ReactNode;                  // shown when rows=[] and not loading
  highlightKey?: string;              // e.g. "you" row
}
```
- Desktop: `<table>` with sticky header; sortable headers are buttons with `aria-sort`; selection column with a header checkbox (indeterminate when partial); row click/Enter activates `onRowClick` unless the event started on an interactive descendant (`a, button, input, select, label`); `rowHref` renders the primary cell as a link and the row click follows it.
- Phone (`useMediaQuery('(max-width: 639px)')`): a `<ul>` list; each item shows the `primary` cells on line 1 and the `meta` cells joined with ` · ` on line 2; checkbox and `⋯` stay visible; no horizontal scroll.

- [ ] Steps 1–5 (tests: header/align classes; sort button toggles + aria-sort; select-all/indeterminate; Enter on a focused row calls onRowClick, clicking a button inside the row does not; ⋯ menu lists actions with destructive last; loading/empty/error states; phone mode renders list items with two lines). Commit `feat(ui): DataTable`.

### Task 5: `FilterBar` and `useUrlFilters`

**Files:** Create `src/components/ui/FilterBar.tsx`, `FilterBar.module.css`, `src/hooks/useUrlFilters.ts`; Test `src/tests/components/ui/FilterBar.test.tsx`, `src/tests/hooks/useUrlFilters.test.tsx`

**Interfaces:**
- `useUrlFilters<K extends string>(keys: readonly K[]): { values: Record<K, string>; set(key: K, value: string | null): void; clear(): void }` — reads/writes `useSearchParams`, removes empty values, replaces history (no new entry per keystroke).
- `<FilterBar search?={{ value, onChange, placeholder }} segments?={ReactNode} filters?={FilterChip[]} resultCount?={ReactNode} trailing?={ReactNode} />` with `FilterChip = { key; label; value?: string; options: {value,label}[]; onChange(value|null) }` — unset chip = dashed "+ Label" button opening an `ActionMenu`-style option list; set chip = solid "Label: Value ×"; phones collapse chips behind one "Filters · n" button that opens a `Drawer`.

- [ ] Steps 1–5 (tests: URL round-trip and empty-value removal; chip set/clear; phone collapse shows count). Commit `feat(ui): FilterBar and URL-synced filters`.

### Task 6: `BulkBar`

**Files:** Create `src/components/ui/BulkBar.tsx`, `BulkBar.module.css`; Test `src/tests/components/ui/BulkBar.test.tsx`

**Interfaces:** `<BulkBar count onClear actions={Array<{key,label,onClick,destructive?}>} />` — renders nothing at 0; "N selected · Clear"; first 3 non-destructive actions as secondary buttons, the rest (and all destructive) in a `⋯` overflow; `role="region" aria-label="Bulk actions"`; sticky top inside its container (not fixed).

- [ ] Steps 1–5. Commit `feat(ui): BulkBar`.

### Task 7: `ConfirmDialog` tiers

**Files:** Create `src/components/ui/ConfirmDialog.tsx`; Test `src/tests/components/ui/ConfirmDialog.test.tsx`

**Interfaces:** `<ConfirmDialog open tier: 'plain'|'destructive'|'typed' title body confirmLabel confirmText?: string onConfirm onCancel busy? />` — uses `Dialog`; destructive/typed confirm buttons use `Button variant="destructive"`; typed shows "Type <b>{confirmText}</b> to confirm" and an input; the button enables only when the input **exactly** equals `confirmText` (no trimming, case-sensitive); `busy` disables both buttons and shows the Button loading label.

- [ ] Steps 1–5 (tests: typed stays disabled for `' name'`, `'Name'`, enables for exact; Enter in the input confirms only when enabled; cancel closes). Commit `feat(ui): confirm dialog tiers`.

### Task 8: `FileDrop`

**Files:** Create `src/components/ui/FileDrop.tsx`, `FileDrop.module.css`; Test `src/tests/components/ui/FileDrop.test.tsx`

**Interfaces:** `<FileDrop label hint? accept?: string[] (extensions like '.zip','.h') multiple? maxBytes? disabled? onFiles(files: File[]) />` — a labelled button-like zone (click or Enter/Space opens the native picker; drag-over state); rejects wrong extensions, too many files, or oversize with a visible `role="alert"` message naming the reason and does not call `onFiles`.

- [ ] Steps 1–5 (tests: accepted drop calls onFiles; `.exe` rejected with message; 2 files when `multiple` is false rejected; oversize rejected; keyboard opens the picker via the hidden input click). Commit `feat(ui): FileDrop`.

### Task 9: `SettingsRow`

**Files:** Create `src/components/ui/SettingsRow.tsx` (+css); Test `src/tests/components/ui/SettingsRow.test.tsx`

**Interfaces:** `<SettingsRow label help? control htmlFor? status?: 'saving'|'saved'|null danger? />` — label + help left, control right (also on phones), small "Saved" mono text with check when `status==='saved'`, `danger` gives the red-tinted row for danger zones.

- [ ] Steps 1–5. Commit `feat(ui): SettingsRow`.

### Task 10: Base UI dependency and `ToastProvider`

**Files:** Modify `frontend/package.json` (`@base-ui/react` exact `1.9.0`); Create `src/components/ui/Toast.tsx` (+css); Modify `src/App.tsx` (wrap with `ToastProvider`); Test `src/tests/components/ui/Toast.test.tsx`; `designGuards.test.ts` pins the exact version.

**Interfaces:** `ToastProvider` and `useToast(): { show(message: string, opts?: { tone?: 'neutral'|'success'|'danger' }): void }` built on Base UI Toast; bottom-right on desktop, bottom above the tab bar on phones; auto-dismiss 4s; `role="status"`.

- [ ] Steps 1–5 (tests: show() renders the message in a status region; it disappears after 4s with fake timers). Commit `feat(ui): toast on Base UI`.

### Task 11: Move `ActionMenu`, `Dialog`, `Drawer` internals onto Base UI

**Files:** Modify `src/components/ui/ActionMenu.tsx`, `Dialog.tsx`, `Drawer.tsx` (+ their CSS); delete `focusTrap.ts`/`useModalFocus.ts` only if nothing else imports them; Tests: the existing `src/tests/components/ui/{ActionMenu,Dialog,Drawer}.test.tsx` **unchanged** are the contract.

- [ ] **Step 1:** Run the three existing test files — Expected: PASS (baseline).
- [ ] **Step 2:** Re-implement each with Base UI (`Menu` for ActionMenu, `Dialog` for Dialog, `Dialog` with a side-anchored popup for Drawer), keeping props, accessible names, Escape/outside-click/focus-restore behaviour and CSS classes used by callers.
- [ ] **Step 3: Run** the three files — Expected: PASS without editing them. If a test encodes behaviour Base UI cannot provide, stop that component's swap, keep the old implementation, and ledger a ruling.
- [ ] **Step 4: Run** `npm run validate` — Expected: PASS.
- [ ] **Step 5: Commit** — `refactor(ui): overlays on Base UI`

### Task 12: Verification and PR

- [ ] `npm run validate`, `npm run build`, `npm run test:visual` (baselines should be unchanged except overlays if their pixels moved — review any diff before updating).
- [ ] Local stack smoke: open a Dialog (change password), an ActionMenu (admin problems ⋯), the More drawer on a phone, ⌘K — Escape, focus return, outside click.
- [ ] Push, PR `UI redesign phase 2b: shared data components` against `ui-redesign/phase2a-shell` (or `main` once earlier phases merge).

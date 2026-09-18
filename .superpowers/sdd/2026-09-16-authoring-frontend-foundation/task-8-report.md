# Task 8 Report: Deterministic Authoring Visual Regression Coverage

## Status

Complete. The committed visual harness covers the authoring shell and author-profile surface in Chromium at desktop (1280 × 720) and mobile (390 × 844) viewports.

## Implementation

- Added `@playwright/test` and installed Chromium, plus `test:visual` and `test:visual:update` npm scripts.
- Added the CRA Playwright web server on `127.0.0.1:3100`, with light color scheme, reduced motion, desktop and mobile projects, non-parallel test-file execution, and CI retries/reporting.
- Added deterministic fixtures for a complete authenticated `/api/me` response, complete authoring draft records, and complete author-profile records. All fixture IDs, dates, and long author data are fixed; profile images are explicitly absent so no remote image can affect a screenshot.
- `mockAdminApi(page)` freezes the browser clock at `2026-09-16T09:00:00+07:00` before navigation. Its deliberate `**/api/**` 404 safety route is registered first; Playwright selects the most recently registered matching route, so the subsequent `/me`, drafts, and profiles routes override it. This prevents accidental real-backend traffic.
- Added real-browser assertions for authenticated roles/links, desktop full navigation, mobile Menu behavior, route interaction, document-width overflow, and profile-row geometry. The existing `data-profile-identity` hook from Task 7 was preserved and used for stable measurement.
- Added light shell/profile snapshots for desktop and mobile, plus a desktop dark-profile snapshot after the UI theme toggle. Each screenshot waits for app fonts and disables animations/transitions.
- Added `test-results/` and `playwright-report/` to `.gitignore`; only the five expected baseline PNGs are tracked.

## Routing Ruling

Author Profiles is not a standalone route in the current product. The profile visual spec starts at `/admin/authoring`, clicks the existing `Author profiles` toggle, and waits for the fixture rows. This preserves the current route model rather than inventing a new route for the test.

## TDD Evidence

### Discovery

```bash
cd frontend && npx playwright test --list
```

Result: PASS. Both specs were discovered in both projects: 4 executions total.

### RED

The initial sandboxed no-update run could not bind CRA to port 3100 (`listen EPERM`), so the same local-only command was rerun with the required port-binding approval:

```bash
cd frontend && npm run test:visual -- --reporter=list
```

Result: expected failure, 4 failed. Every browser assertion executed successfully; each failure was solely a missing baseline snapshot. Playwright wrote actual PNG attachments for desktop/mobile shell and profile coverage, including the desktop dark profile state.

### GREEN

```bash
cd frontend && npm run test:visual:update
```

Result: PASS, 4 passed. This generated exactly five approved baseline PNGs: desktop/mobile shell, desktop/mobile light profiles, and desktop dark profiles.

```bash
cd frontend && npm run test:visual
```

Result: PASS, 4 passed against the generated baselines without updates.

## Visual Inspection

All five generated PNGs were opened and reviewed individually:

- `admin-authoring-shell-desktop-darwin.png` — full desktop navigation is readable and contained; no page-level horizontal overflow.
- `admin-authoring-shell-mobile-darwin.png` — compact header/menu control and responsive authoring actions are contained without navigation overlap.
- `author-profiles-desktop-darwin.png` — long profile identities remain readable; Edit controls stay compact and aligned.
- `author-profiles-dark-desktop-darwin.png` — dark background, primary text, secondary text, controls, borders, and link contrast remain readable.
- `author-profiles-mobile-darwin.png` — long identity data wraps within the three-column row, with compact Edit controls rather than full-width row buttons; no document-wide overflow or clipping is visible.

No baseline was accepted with clipped text, overlapping navigation, full-width profile-row controls, document-wide horizontal overflow, missing visible focus styles in the affected controls, or unreadable dark-theme contrast.

## Verification

```bash
cd frontend && npm run type-check
```

PASS — `tsc --noEmit` exited 0.

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/styles/cssModuleIsolation.test.ts
```

PASS — 1 suite, 1 test.

```bash
cd frontend && CI=true npm test -- --watchAll=false
```

PASS — 75 suites, 392 tests, 0 failures.

```bash
git diff --check
```

PASS — no whitespace errors.

## Files Changed

- `.gitignore`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/playwright.config.ts`
- `frontend/tests/visual/fixtures.ts`
- `frontend/tests/visual/admin-shell.spec.ts`
- `frontend/tests/visual/author-profiles.spec.ts`
- `frontend/tests/visual/admin-shell.spec.ts-snapshots/admin-authoring-shell-desktop-darwin.png`
- `frontend/tests/visual/admin-shell.spec.ts-snapshots/admin-authoring-shell-mobile-darwin.png`
- `frontend/tests/visual/author-profiles.spec.ts-snapshots/author-profiles-desktop-darwin.png`
- `frontend/tests/visual/author-profiles.spec.ts-snapshots/author-profiles-dark-desktop-darwin.png`
- `frontend/tests/visual/author-profiles.spec.ts-snapshots/author-profiles-mobile-darwin.png`
- `.superpowers/sdd/2026-09-16-authoring-frontend-foundation/task-8-report.md`

## Self-Review

- Confirmed the catch-all API fixture is registered before specific routes and returns a deliberate 404 for every unexpected `/api/**` request.
- Confirmed the browser clock is fixed before every navigation and snapshot.
- Confirmed test fixtures include all fields used by draft-list and profile components, including IDs, dates, image state, linked user IDs, revisions, limits, and author metadata.
- Confirmed no authoring route, component behavior, or the Task 7 identity measurement hook was changed.
- Confirmed mobile geometry asserts `button < 160`, `identity > 120`, and `row <= 390`; desktop asserts compact button and viable identity width while retaining its wider layout.
- Confirmed the dark snapshot is made only after the real theme-toggle UI changes `data-theme` to `dark`.
- Confirmed ignored reports/results are not staged and that the committed images are only the five intentional baselines.

## Concerns

No blocking concerns. Playwright snapshot filenames include the current macOS platform suffix (`-darwin`), which is Playwright's standard platform-specific baseline behavior. CRA emits existing webpack-dev-server deprecation warnings during the visual runs; they do not affect the results.

## Fix Round 1

### RED

Updated the visual specs first to use real Tab navigation to focus the desktop Logout button/mobile Menu button in the authoring shell and the long-profile Edit button in Author Profiles. Each focused target asserts `toBeFocused()` plus a computed non-zero outline or non-`none` box-shadow before capturing a dedicated focus baseline. The mobile profile spec also calls `scrollIntoViewIfNeeded()` on the deliberately long second profile before its captures.

```bash
cd frontend && npm run test:visual -- --reporter=list
```

Result: expected failure (4 failed). The profile focus assertions passed and failed only on missing focus snapshots; the shell run additionally exposed that the desktop Authoring link has no explicit focus ring, so the shell target was corrected to the shared Button-based Logout/Menu controls. No production code was changed.

### GREEN

```bash
cd frontend && npm run test:visual:update
cd frontend && npm run test:visual
```

Result: baseline update PASS (4 passed) and verification PASS (4 passed). Four new focus-state PNGs were generated, covering desktop/mobile shell and desktop/mobile author profiles.

### Visual Inspection

Opened and reviewed each changed PNG individually:

- `admin-authoring-shell-focus-desktop-darwin.png` — visible blue focus ring around Logout.
- `admin-authoring-shell-focus-mobile-darwin.png` — visible blue focus ring around Menu.
- `author-profiles-focus-desktop-darwin.png` — visible blue focus ring around the second profile’s Edit control.
- `author-profiles-focus-mobile-darwin.png` — visible blue focus ring around the second profile’s Edit control, with the long profile scrolled into the captured viewport.

No clipped focus ring, overlap, or unreadable content was observed. The existing `-darwin` platform suffix policy is retained: including the project name already separates desktop/mobile baselines, while removing the platform token would make future OS-specific rendering share a filename and risk cross-platform baseline collisions; no duplicate baselines are introduced.

### Verification

```bash
cd frontend && npm run type-check
cd frontend && CI=true npm test -- --watchAll=false src/tests/styles/cssModuleIsolation.test.ts
git diff --check
```

Result: all PASS.

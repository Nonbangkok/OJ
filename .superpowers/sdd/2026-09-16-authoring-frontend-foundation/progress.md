# SDD ledger — plan: docs/superpowers/plans/2026-09-16-authoring-frontend-foundation.md

## Setup

- Existing linked worktree verified at `/Users/nonbangkok/Documents/Workspace/VS_code/OJ/.worktrees/local-dev-foundation` on branch `authoring`.
- Starting HEAD: `2611711` (`docs: plan authoring frontend foundation`).
- Baseline: `CI=true npm test -- --watchAll=false` — 63 suites, 326 tests passed, 0 failures.
- Binding spec: `docs/superpowers/specs/2026-09-16-authoring-frontend-redesign-design.md`.

## Task ledger

- [x] Task 1: Lock down CSS-module isolation and remove the global button leak
- [x] Task 2: Add typed action and field primitives
- [x] Task 3: Generalize status and overflow-surface primitives
- [x] Task 4: Add an accessible Dialog and migrate ConfirmationModal
- [x] Task 5: Add an accessible Drawer foundation
- [x] Task 6: Replace the overlapping Admin navigation with a responsive menu
- [x] Task 7: Stabilize the current Authoring surface on desktop and mobile
- [x] Task 8: Add deterministic desktop and mobile visual regression coverage
- [x] Task 9: Run the full foundation verification gate

## Pre-flight consistency scan

### Task self-consistency

| Task | Produces/tests | Finding |
|---|---|---|
| 1 | Static CSS-module isolation guard, scoped form/settings/modal selectors, auth regression tests | Internally consistent, but the source-level selector guard conflicts with the test rubric's warning against source-text tests. See Ruling 1. |
| 2 | Button, Field, Input, Select, Textarea, theme tokens, direct component tests | Internally consistent; typed native-compatible controls and ARIA behavior line up with the listed files and tests. |
| 3 | Generic StatusBadge adapter and contained OverflowTable | Internally consistent; old contest API remains compatible while new primitives are independently testable. |
| 4 | Portal Dialog and backward-compatible ConfirmationModal adapter | Internally consistent; focus, Escape, pending, and restoration requirements are all represented in tests and implementation steps. |
| 5 | Drawer plus private shared focus-trap utility | Internally consistent; explicitly requires regression coverage for Dialog after extracting shared focus logic. |
| 6 | Responsive normal-flow Admin navbar and tests | Internally consistent; JSDOM owns behavior and Playwright is explicitly deferred for media-query rendering. |
| 7 | Current Authoring migration to primitives and responsive profile rows | The proposed class-name assertion conflicts with the behavior-first test rubric and duplicates the browser-level layout protection in Task 8. See Ruling 2. |
| 8 | Playwright config, fixtures, visual tests, snapshots | Internally consistent; uses intercepted API fixtures and exact viewports, with manual baseline inspection required before acceptance. |
| 9 | Static, unit, build, and visual verification gate | Internally consistent; it consumes all earlier outputs and adds no production behavior. |

### Shared-file and shared-interface pairs

| Tasks | Producer → consumer | Finding |
|---|---|---|
| 1 → 7 | Scoped legacy form/button CSS → Authoring primitive migration | Clean: Task 7 no longer has to override a leaked full-width `button` rule. |
| 1 → 9 | CSS isolation/auth regression tests → final verification | Clean. |
| 2 → 3 | `components/ui/index.ts` and theme tokens → status/overflow exports | Clean: Task 3 extends the same barrel without changing Task 2 contracts. |
| 2 → 4 | Button primitive and `components/ui/index.ts` → Dialog/Confirmation actions | Clean. |
| 2 → 5 | `components/ui/index.ts` → Drawer export | Clean. |
| 2 → 6 | `index.css` action/focus/surface tokens → responsive Admin shell tokens/reset | Clean if Task 6 preserves Task 2 variables and only adds the global box-sizing reset. |
| 2 → 7 | Button and form primitives → current Authoring actions | Clean; Task 7 consumes rather than forks the styles. |
| 2 → 9 | New primitive tests/type contracts → final verification | Clean. |
| 3 → 7 | OverflowTable → saved-draft table | Clean. |
| 3 → 9 | Status/overflow tests → final verification | Clean. |
| 4 → 5 | Dialog focus logic → private `focusTrap.ts` extracted by Drawer task | Clean; Task 5 must rerun Dialog tests after extraction. |
| 4 → 9 | Dialog/legacy confirmation behavior → final verification | Clean. |
| 5 → 9 | Drawer/focus-trap behavior → final verification | Clean. |
| 6 → 8 | Responsive Admin navigation → real-browser desktop/mobile assertions | Clean; Task 8 is the CSS/media-query acceptance layer Task 6 cannot provide in JSDOM. |
| 6 → 9 | Navbar/layout tests → final verification | Clean. |
| 7 → 8 | `data-profile-identity` and responsive profile layout → browser geometry assertion/screenshots | Clean; Task 7 must add the stable semantic measurement hook Task 8 names. |
| 7 → 9 | Authoring/profile component regressions → final verification | Clean. |
| 8 → 9 | `test:visual`, Playwright config, fixtures, and snapshots → final visual gate | Clean. |

## Rulings

1. Ruling: Keep Task 1's static CSS selector guard, treating it as an architectural lint test rather than a textual change detector — the binding spec explicitly forbids unscoped element selectors in CSS modules, JSDOM does not apply the emitted CSS, and the later Playwright test covers user-visible behavior — cost if wrong: the regex may create false positives when valid selector syntax expands, requiring the guard to be replaced with a parser.
2. Ruling: Do not add Task 7's CSS-module class-name assertion; assert semantic action/region structure in Jest and reserve row-width/flex behavior for Task 8's real-browser geometry test — this follows the behavior-first test rubric without weakening the final acceptance criterion — cost if wrong: the Task 7 commit has a temporary layout-regression gap until Task 8 lands.
3. Ruling: For Task 6's shrinkable desktop-grid fix, permit a narrow CSS-contract regression test before Task 8 provides real-browser geometry coverage — JSDOM cannot calculate CSS grid layout and the approved sequence installs Playwright later — cost if wrong: the test is coupled to the chosen grid declaration and may need replacement when the Admin shell design evolves.

## Execution record

- Task 1: fix round 1/5 (1 Important finding addressed, 0 open — guard now rejects every bare standard HTML element selector and Submissions anchor rules are scoped; commits `8dc5beb..3889228`).
- Task 1: complete (commits `2611711..3889228`, review clean).
- Task 2: minor (deferred): custom `loadingLabel` implementation branch lacks direct test coverage; final whole-branch review must triage whether this public-API branch should be covered before merge.
- Task 2: fix round 1/5 (3 original Important contrast findings addressed, 1 new Important danger-background regression open; commits `56bfc74..744f629`).
- Task 2: fix round 2/5 (1 Important danger-background regression addressed, 0 open — error text and danger background now use separate tokens; commits `744f629..241e2ad`).
- Task 2: complete (commits `3889228..241e2ad`, review clean with 1 deferred minor).
- Task 3: fix round 1/5 (1 Important badge-tone contrast finding addressed, 0 open — all five tones meet 4.5:1 in light and dark themes; commits `a8b4bf9..c695a92`).
- Task 3: complete (commits `241e2ad..c695a92`, review clean).
- Cross-task verification finding for Task 9: repository-wide lint reports three errors introduced in earlier foundation files (`Button.tsx` and `OverflowTable.tsx` noninteractive `tabIndex`; `cssModuleIsolation.test.ts` unnecessary escape). They are outside Task 4's diff but must be resolved before the final lint gate.
- Task 4: fix round 1/5 (2 Important findings addressed, 0 open — all pending confirmation dismissal paths are guarded and outside-focus Tab re-entry is symmetric; commits `047e09b..7b7cb44`).
- Task 4: complete (commits `c695a92..7b7cb44`, review clean).
- Task 5: complete (commits `7b7cb44..6337688`, review clean; first reviewer attempt produced no verdict due to usage limit, retry approved).
- Task 6: fix round 1/5 (1 Important desktop-grid overflow finding addressed, 0 open — side tracks are shrinkable; commits `b1e6150..9b3fcda`).
- Task 6: complete (commits `6337688..9b3fcda`, review clean; real-browser geometry remains assigned to Task 8).
- Task 7: fix round 1/5 (2 Important findings addressed, 0 open — JobHistory table overflow is restored and focused tests are semantic; commits `797869d..b8c2956`).
- Task 7: complete (commits `9b3fcda..b8c2956`, review clean; mobile editor-action geometry remains Task 8 browser coverage).
- Task 8: minor (deferred): mobile profile baseline does not scroll the second deliberately long profile fully into the 844px screenshot; final review should decide whether an extra targeted screenshot is warranted.
- Task 8: minor (deferred): only macOS (`-darwin`) snapshot baselines are committed; final review should decide whether the project needs cross-platform snapshot naming/policy for Linux CI.
- Task 8: fix round 1/5 (1 Important focus-visibility coverage gap addressed, 0 open — keyboard focus is asserted and captured for shell/profile desktop and mobile; commits `2a53bdd..3dc4200`).
- Task 8: complete (commits `b8c2956..3dc4200`, review clean with 2 deferred minors).
- Task 9: complete — all static checks, 75 unit/component suites (392 tests), production build, and 4 Playwright visual tests pass after a focused accessibility/lint and formatting correction; commit message `fix: complete authoring foundation verification`.
- Final whole-branch review: minor 1 (loadingLabel coverage) — resolved by direct tests for the explicit-label precedence and generic fallback branches (commit `f229e3c`).
- Final whole-branch review: minor 2 (mobile long-profile baseline clip) — resolved. The old `scrollIntoViewIfNeeded()` on the Edit button was a no-op (button already in view), leaving the row's attribution text 69px past the 844px fold. The spec now scrolls the whole row into view (`block: 'end'`); measured row bottom = 844 = fully captured. Mobile baselines regenerated; full visual suite 4/4 green.
- Final whole-branch review: minor 3 (darwin-only snapshot baselines) — deferred with rationale. The repo has no CI pipeline at all (no .github/workflows), so a Linux baseline would have no runner to consume it. The -darwin suffix is Playwright's platform isolation working as designed; when Linux CI is introduced, that change owns generating and committing -linux baselines (or adopting a cross-platform snapshot policy). Not a merge blocker.

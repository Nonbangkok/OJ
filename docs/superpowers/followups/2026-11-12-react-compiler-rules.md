# React Compiler lint rules (react-hooks v7) — fully adopted

Step 5 of the toolchain upgrade moved the frontend to ESLint 9 with
`eslint-plugin-react-hooks` v7. That plugin ships a set of React Compiler
rules that flag patterns the compiler cannot optimise. All five are now
**enforced** (`'error'`) in `frontend/eslint.config.mjs`.

| Rule | State | Findings |
| --- | --- | --- |
| `react-hooks/immutability` | on (`error`) | 0 (2 fixed) |
| `react-hooks/preserve-manual-memoization` | on (`error`) | 0 (2 fixed) |
| `react-hooks/use-memo` | on (`error`) | 0 (1 fixed) |
| `react-hooks/set-state-in-effect` | on (`error`) | 0 (38 cleared, 13 of them by a justified disable) |
| `react-hooks/refs` | on (`error`) | 0 (31 cleared, no disables) |

All 74 original findings are cleared.

## Fixed (2026-11-13)

- `useContestDetail.ts` — `preserve-manual-memoization` (**real bug**).
  `fetchContestData` listed `contest?.status` as a dependency, so every status
  change (including the first load, `undefined` -> real status) recreated it
  and restarted the polling effect, which re-fetched immediately with
  `isInitial = true`. Result: every mount fetched twice, and each status change
  seen by a poll (e.g. scheduled -> running) fired an extra request and flashed
  the full-page `LoadingPage`. The last fetched status now lives in a ref read
  by the callback; deps are `[contestId, navigate]`. Covered by new tests in
  `src/tests/hooks/useContestDetail.test.tsx` (failed before the fix: 2 and 4
  `getById` calls instead of 1 and 2).
- `useTestcaseFiles.ts` (2) — `immutability`, "accessed before it is
  declared": the revision-reset effect called `setConfirmation`, and `mutate`
  called the hoisted `resetFiles`, both declared further down the hook. Not a
  runtime bug (both run after render and only touch stable setters), but it
  hides `resetFiles` from the compiler's dependency analysis. The file-selection
  state and `resetFiles` now sit above their first use; no logic change.
- `Problems.tsx` — `preserve-manual-memoization`, "dependency may be modified
  later": `categoryQueryValue` was derived from a fresh `selectedCategories`
  array each render, which the compiler treats as possibly mutated later. Not a
  bug (the dependency is a joined string). `selectedCategories` is now
  memoised on the raw `category` search param.
- `ProblemAuthoring.tsx` — `use-memo`: `useMemo(readPrefs, [])` passed a
  function reference instead of an inline function. Not a bug; now
  `useState(readPrefs)`, which guarantees the one-time read of the saved view
  preferences.

## Cleared (2026-11-13, `refactor/react-compiler-rules`)

The remaining 69 were worked through with behaviour kept identical (same
requests and timing, same loading states, same modal reset-on-open). 18 tests
were added to pin the behaviour that was restructured.

- **Latest-value / latest-callback refs** (Dialog, Drawer, useAutocomplete,
  useInfiniteScroll, useAuthoringDraft, useTestcaseFiles, useProblemSelection):
  the `ref.current = value` write moved from render into a deps-less
  `useLayoutEffect`. Ctrl/Cmd+S handlers in DraftWorkspace and StatementEditor
  use `useEffectEvent`.
- **Render-time ref reads** (Problems.tsx `hasLoadedRef`, LivePreview,
  DraftWorkspace, AuthorProfiles): replaced by sticky state set during render,
  or read through effect dependencies.
- **Reset-on-change effects** (modals, URL->input mirrors, ActionMenu,
  ChangePasswordDialog, XpToast, useSubmissionModal, UserProfile, PdfEmbed,
  selection pruning): the "adjust state while rendering" pattern, so the reset
  lands in the same render instead of one stale commit later.
- **Fetch-on-mount hooks** in the admin area: `loading` starts `true`, so the
  effect no longer sets it synchronously; refresh and dependency changes still do.

### Justified disables (13, `set-state-in-effect` only)

Each carries an inline reason. They are effects that synchronise with an
external system, where restructuring would change timing:

- `frontend/src/context/AuthContext.tsx:69` — bootstrap /me fetch; checkLoggedIn only sets state after its await resolves
- `frontend/src/context/SettingsContext.tsx:78` — bootstrap /site-config fetch; fetchSettings only sets state after its await resolves
- `frontend/src/features/admin/authoring/AuthorProfiles.tsx:59` — mount fetch; load()'s leading setLoading(true)/setListError('') are no-ops against the initial state
- `frontend/src/features/admin/authoring/StatementEditor.tsx:191` — one-shot restore from sessionStorage once the draft loads; the notice must flip in the same step as restoreStatement
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:294` — the 'dirty' status flips in the same step that (re)arms the debounce timer below, so it can never disagree with a pending autosave
- `frontend/src/features/admin/authoring/useTestcaseFiles.ts:98` — a new revision must clear the preview in the same step that bumps inspectionRequest; resetting during render would let an in-flight inspection land a stale preview before this effect invalidates it
- `frontend/src/hooks/useCodeSubmission.ts:67` — restores the cached draft from localStorage (external store) when problem/language changes, or clears the editor when there is none
- `frontend/src/hooks/useContestDetail.ts:65` — contestId-keyed initial fetch + poll; the initial fetch flips the full-page loading state
- `frontend/src/hooks/useContestScoreboard.ts:97` — contestId-keyed fetch that flips loading before its request starts
- `frontend/src/hooks/useContests.ts:26` — mount fetch; its only synchronous setState is setLoading(true), already the initial value
- `frontend/src/hooks/useProblems.ts:57` — fetch keyed on contestId/enabled/difficulty that flips loading before its request starts (or, when disabled, clears loading and error)
- `frontend/src/hooks/useScoreboard.ts:34` — contestId-keyed fetch that flips loading on before its request starts
- `frontend/src/hooks/useSubmissions.ts:96` — deps-keyed list fetch; fetchData only sets state after its await resolves

When adding code, prefer the patterns above; add a disable only with a concrete reason.

## How to regenerate

In `frontend/`, run
`npx eslint src` (both rules are on in the normal config).

# React Compiler lint rules (react-hooks v7) — partly adopted

Step 5 of the toolchain upgrade moved the frontend to ESLint 9 with
`eslint-plugin-react-hooks` v7. That plugin ships a set of React Compiler
rules that flag patterns the compiler cannot optimise. Of the five rules,
three are now **enforced** (`'error'`) in `frontend/eslint.config.mjs` after
their findings were fixed; two remain **off**.

| Rule | State | Findings |
| --- | --- | --- |
| `react-hooks/immutability` | on (`error`) | 0 (2 fixed) |
| `react-hooks/preserve-manual-memoization` | on (`error`) | 0 (2 fixed) |
| `react-hooks/use-memo` | on (`error`) | 0 (1 fixed) |
| `react-hooks/set-state-in-effect` | off | 38 |
| `react-hooks/refs` | off | 31 |

69 findings remain (originally 74).

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

## Why the other two are still off

Satisfying `set-state-in-effect` and `refs` means restructuring effects and
render-time ref reads/writes across many components (the deliberate
`hasLoadedRef` pattern in `Problems.tsx`, latest-callback refs, modal
reset-on-open effects). That is a separate change with its own risk and
testing; these are mostly stylistic or compiler-optimisation hints rather than
likely bugs.

## How to regenerate

In `frontend/`, run
`npx eslint src --rule 'react-hooks/set-state-in-effect: error' --rule 'react-hooks/refs: error' -f json`.

## Remaining findings (`file:line rule`)

- `frontend/src/components/ui/ActionMenu.tsx:143 react-hooks/set-state-in-effect`
- `frontend/src/components/ui/Dialog.tsx:43 react-hooks/refs`
- `frontend/src/components/ui/Dialog.tsx:44 react-hooks/refs`
- `frontend/src/components/ui/Dialog.tsx:45 react-hooks/refs`
- `frontend/src/components/ui/Drawer.tsx:30 react-hooks/refs`
- `frontend/src/components/ui/Drawer.tsx:31 react-hooks/refs`
- `frontend/src/components/user/ChangePasswordDialog.tsx:37 react-hooks/set-state-in-effect`
- `frontend/src/components/user/XpToast.tsx:36 react-hooks/set-state-in-effect`
- `frontend/src/context/AuthContext.tsx:69 react-hooks/set-state-in-effect`
- `frontend/src/context/SettingsContext.tsx:78 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/analysis/OverviewTab.tsx:58 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/AuthorProfiles.tsx:41 react-hooks/refs`
- `frontend/src/features/admin/authoring/AuthorProfiles.tsx:61 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/DraftWorkspace.tsx:62 react-hooks/refs`
- `frontend/src/features/admin/authoring/DraftWorkspace.tsx:210 react-hooks/refs`
- `frontend/src/features/admin/authoring/LivePreview.tsx:17 react-hooks/refs`
- `frontend/src/features/admin/authoring/StatementEditor.tsx:112 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/StatementEditor.tsx:191 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/StatementEditor.tsx:212 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:46 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:47 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:57 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:281 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:286 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/useTestcaseFiles.ts:43 react-hooks/refs`
- `frontend/src/features/admin/authoring/useTestcaseFiles.ts:98 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:54 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:55 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:56 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:57 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:175 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/shared/ConfirmationModal.tsx:49 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/users/ResetPasswordModal.tsx:35 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/users/UserManagement.tsx:57 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useContestManagement.tsx:34 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useContestModal.ts:16 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useEditUserModal.ts:11 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useProblemMigrationModal.ts:33 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useProblemModal.ts:39 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useProblemSelection.ts:34 react-hooks/refs`
- `frontend/src/hooks/admin/useProblemSelection.ts:36 react-hooks/refs`
- `frontend/src/hooks/admin/useProblemSelection.ts:42 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useProblemSelection.ts:112 react-hooks/refs`
- `frontend/src/hooks/admin/useUserManagement.ts:49 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useAutocomplete.ts:30 react-hooks/refs`
- `frontend/src/hooks/useAutocomplete.ts:31 react-hooks/refs`
- `frontend/src/hooks/useCodeSubmission.ts:67 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useContestDetail.ts:65 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useContestScoreboard.ts:97 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useContests.ts:26 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useInfiniteScroll.ts:24 react-hooks/refs`
- `frontend/src/hooks/useProblems.ts:57 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useScoreboard.ts:34 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useSubmissionModal.ts:30 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useSubmissions.ts:96 react-hooks/set-state-in-effect`
- `frontend/src/layouts/admin/AdminNavbar.tsx:28 react-hooks/set-state-in-effect`
- `frontend/src/pages/problem/Problems.tsx:44 react-hooks/set-state-in-effect`
- `frontend/src/pages/problem/Problems.tsx:45 react-hooks/set-state-in-effect`
- `frontend/src/pages/problem/Problems.tsx:103 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:209 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:209 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:209 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:210 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:210 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:210 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:210 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:211 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:211 react-hooks/refs`
- `frontend/src/pages/user/UserProfile.tsx:53 react-hooks/set-state-in-effect`

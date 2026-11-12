# React Compiler lint rules (react-hooks v7) — deferred

Step 5 of the toolchain upgrade moved the frontend to ESLint 9 with
`eslint-plugin-react-hooks` v7. That plugin ships a set of React Compiler
rules that flag patterns the compiler cannot optimise. They are **turned off**
in `frontend/eslint.config.mjs` (only `rules-of-hooks` and `exhaustive-deps`
are enforced, as before).

## Why they are off

The spec (Step 5) puts behavioural refactors out of scope for the upgrade:
satisfying these rules means restructuring effects, refs and memoization in
components, which is a separate change with its own risk and testing. Turning
them on would have made `lint:check` fail on 74 existing findings.

## Counts (74 total)

| Rule | Findings |
| --- | --- |
| `react-hooks/set-state-in-effect` | 38 |
| `react-hooks/refs` | 31 |
| `react-hooks/immutability` | 2 |
| `react-hooks/preserve-manual-memoization` | 2 |
| `react-hooks/use-memo` | 1 |

**Look at first — most likely real bugs:** `immutability` and
`preserve-manual-memoization` (4 findings). The rest are mostly stylistic or
compiler-optimisation hints.

## How to regenerate

Set the five rules to `'error'` in `frontend/eslint.config.mjs` and run
`npx eslint . -f json` in `frontend/`.

## All findings (`file:line rule`)

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
- `frontend/src/features/admin/authoring/DraftWorkspace.tsx:210 react-hooks/refs`
- `frontend/src/features/admin/authoring/DraftWorkspace.tsx:62 react-hooks/refs`
- `frontend/src/features/admin/authoring/LivePreview.tsx:17 react-hooks/refs`
- `frontend/src/features/admin/authoring/ProblemAuthoring.tsx:77 react-hooks/use-memo`
- `frontend/src/features/admin/authoring/StatementEditor.tsx:157 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/StatementEditor.tsx:178 react-hooks/refs`
- `frontend/src/features/admin/authoring/StatementEditor.tsx:97 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:281 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:286 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:46 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:47 react-hooks/refs`
- `frontend/src/features/admin/authoring/useAuthoringDraft.ts:57 react-hooks/refs`
- `frontend/src/features/admin/authoring/useTestcaseFiles.ts:135 react-hooks/immutability`
- `frontend/src/features/admin/authoring/useTestcaseFiles.ts:43 react-hooks/refs`
- `frontend/src/features/admin/authoring/useTestcaseFiles.ts:75 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/authoring/useTestcaseFiles.ts:78 react-hooks/immutability`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:175 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:54 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:55 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:56 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/problems/ProblemManagement.tsx:57 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/shared/ConfirmationModal.tsx:49 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/users/ResetPasswordModal.tsx:35 react-hooks/set-state-in-effect`
- `frontend/src/features/admin/users/UserManagement.tsx:57 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useContestManagement.tsx:34 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useContestModal.ts:16 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useEditUserModal.ts:11 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useProblemMigrationModal.ts:33 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useProblemModal.ts:39 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useProblemSelection.ts:112 react-hooks/refs`
- `frontend/src/hooks/admin/useProblemSelection.ts:34 react-hooks/refs`
- `frontend/src/hooks/admin/useProblemSelection.ts:36 react-hooks/refs`
- `frontend/src/hooks/admin/useProblemSelection.ts:42 react-hooks/set-state-in-effect`
- `frontend/src/hooks/admin/useUserManagement.ts:49 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useAutocomplete.ts:30 react-hooks/refs`
- `frontend/src/hooks/useAutocomplete.ts:31 react-hooks/refs`
- `frontend/src/hooks/useCodeSubmission.ts:67 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useContestDetail.ts:23 react-hooks/preserve-manual-memoization`
- `frontend/src/hooks/useContestDetail.ts:60 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useContestScoreboard.ts:97 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useContests.ts:26 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useInfiniteScroll.ts:24 react-hooks/refs`
- `frontend/src/hooks/useProblems.ts:57 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useScoreboard.ts:34 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useSubmissionModal.ts:30 react-hooks/set-state-in-effect`
- `frontend/src/hooks/useSubmissions.ts:96 react-hooks/set-state-in-effect`
- `frontend/src/layouts/admin/AdminNavbar.tsx:28 react-hooks/set-state-in-effect`
- `frontend/src/pages/problem/Problems.tsx:102 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:208 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:208 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:208 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:209 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:209 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:209 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:209 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:210 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:210 react-hooks/refs`
- `frontend/src/pages/problem/Problems.tsx:43 react-hooks/set-state-in-effect`
- `frontend/src/pages/problem/Problems.tsx:44 react-hooks/set-state-in-effect`
- `frontend/src/pages/problem/Problems.tsx:80 react-hooks/preserve-manual-memoization`
- `frontend/src/pages/user/UserProfile.tsx:53 react-hooks/set-state-in-effect`

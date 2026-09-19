# System Upgrade Progress — 2026-09-20

> Permanent state file. If this session dies, the next person/agent reads this
> and continues. Branch: `upgrade/system-wide-2026-09`, worktree:
> `.claude/worktrees/system-upgrade` (do NOT touch `authoring-ux` worktree).

## Ground rules (from mission)

1. Never touch `.claude/worktrees/authoring-ux` or its locks.
2. DB has real user data — no `init_db.ts`, no DROP/TRUNCATE. Schema changes
   via new numbered migrations only. Test data INSERTs must use a clear prefix.
3. Commits: no `Co-Authored-By` Claude lines.
4. Never merge to master ourselves — push branch `upgrade/system-wide-2026-09`
   to origin, wait for user approval.
5. Work only in this worktree.
6. Stack runs at http://localhost:8080 (HTTP_PORT=8080; port 80 is taken).
   Rebuild test: `HTTP_PORT=8080 docker-compose up --build -d backend frontend`.

## Phase 1: Baseline & Audit — IN PROGRESS

### Baseline test results (2026-09-20, commit d1df313)

| Suite | Result |
|---|---|
| Backend `npx tsc --noEmit` | ✅ clean |
| Backend `npm test` | ✅ 58 suites passed, 16 skipped (DB-gated); 529 tests passed, 137 skipped |
| Frontend `npm run validate` (type-check + lint + test:ci) | ✅ 90 suites / 478 tests passed; services coverage 95.12% stmts / 100% branches |

Noted during baseline:
- `submissions` table has **no indexes at all** (only authoring/contest tables
  have some) — big gap for analytics + profile queries. (Phase 2 candidate.)
- Test output is noisy: `adminDatabaseService.ts:85` console.log fires on every
  import-related test ("Dropping existing tables before import...").
- Visual regression suite `npm run test:visual` not yet run in this session
  (needs the stack; will run during Phase 4).

### Audit findings

(Being filled in by parallel audit agents — backend & frontend.)

#### Backend audit

_Pending._

#### Frontend audit

_Pending._

## Backlog

_To be prioritized after audits land._

## Decisions needed from user (do not decide alone)

- Major DB schema changes beyond additive indexes.
- Removing features or swapping core dependencies.

## Phase status

- [ ] Phase 1: Baseline & Audit (in progress)
- [ ] Phase 2: Sustainability & Code Quality
- [ ] Phase 3: Security & Reliability
- [ ] Phase 4: UX/UI Upgrade
- [ ] Phase 5: New Features
- [ ] Phase 6: Final Sweep

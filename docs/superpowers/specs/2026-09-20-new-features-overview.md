# New Features Batch — Overview & Implementation Order

Date: 2026-09-20. Branch: `worktree-new-feature`.
Status: specs written for handoff to implementing agents.

This batch contains five independent feature specs. Each spec is self-contained
and can be handed to a separate implementing agent. Read `CLAUDE.md` at the
repo root before starting any of them.

| # | Feature | Spec | New migration? | Touches judge pipeline? |
|---|---------|------|----------------|-------------------------|
| 1 | Problem difficulty | `2026-09-20-problem-difficulty-design.md` | Yes (`0013`) | No |
| 2 | Python language support | `2026-09-20-python-language-support-design.md` | No | Yes |
| 3 | Batch rejudge | `2026-09-20-batch-rejudge-design.md` | No | Yes (reuses) |
| 4 | Streak & achievements | `2026-09-20-streak-achievements-design.md` | No | No |
| 5 | SSE real-time updates | `2026-09-20-sse-realtime-updates-design.md` | No | Emits only |

## Recommended order

1. **Problem difficulty** — smallest, fully independent, no shared surface.
2. **Python language support** — touches the judge pipeline; land before
   rejudge so rejudge can be tested against both languages.
3. **Batch rejudge** — reuses the pipeline from #2; its SSE note depends on #5
   only optionally (pipeline emits regardless once #5 lands).
4. **Streak & achievements** — reads submission history only; the `polyglot`
   achievement becomes meaningful once Python exists.
5. **SSE real-time updates** — adds emit points inside the submission
   pipeline; landing it last means #2/#3 changes are already in place and the
   emit points are written once.

## Shared conventions across all specs

- All backend magic values go in `backend/constants/index.ts`; frontend
  mirrors go in `frontend/src/config/constants.ts` (UI timing) or
  `frontend/src/utils/constants.ts` (domain values mirroring the backend).
- Request validation belongs in Zod schemas (`backend/schemas/requestSchemas.ts`),
  applied via `validateRequest` middleware — never ad-hoc in controllers.
- New endpoints follow the existing layering: `controllers/ → services/ → db.ts`.
- Logging goes through `backend/utils/logger.ts`, never raw `console.*`.
- Verify with `cd backend && npm test` and `cd frontend && npm run validate`
  before claiming done.

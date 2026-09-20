# Streak & Achievements — Design

Date: 2026-09-20. Branch: `worktree-new-feature`.
Status: approved by user (chat, 2026-09-20).

## Problem

The system tracks per-user activity (an admin-facing `ActivityHeatmap`
exists, fed by `analyticsQueryService`), but users themselves get no
engagement feedback: no streak, no milestones. The user wants user-facing
streak and achievement features that celebrate consistency.

## Design decisions (from the user conversation)

- **A day counts toward the streak when the user gets at least one Accepted
  (AC) verdict that day** (any problem, standalone or contest pool).
- Streaks are **computed from submission history**, not stored in new state:
  the profile query derives `current_streak`, `longest_streak`, and the
  last-AC date in one pass. This means historical data is honored instantly
  and there is nothing to backfill or keep consistent.
- Achievements are a **fixed catalog in constants**, unlocked purely by
  derivable statistics (solved counts, streak milestones, language usage,
  contest participation). No new tables, no write-path changes, no admin
  management UI — the achievement set is code.

## Scope of changes

### Streak computation — `backend/services/userProfileQueryService.ts`

Extend the existing `getUserProfileStats` CTE chain (it already unions
`submissions` + `contest_submissions` into `user_submissions`). Add:

1. A `ac_days` CTE: `SELECT DISTINCT submitted_at::date AS day FROM
   user_submissions WHERE overall_status = 'Accepted'` (timezone: the
   `submitted_at TIMESTAMPTZ` cast uses the DB session timezone — set it to
   `Asia/Bangkok` for this query, matching the contest scheduler's
   convention, so "a day" means a day in Thailand).
2. From the sorted day list, compute:
   - `current_streak`: consecutive days ending today or yesterday (a streak
     survives until the day fully ends — today counts if AC already, else
     yesterday's streak is still "current").
   - `longest_streak`: max run of consecutive days.
   - `last_ac_date`.
   
   Implement the streak walk either in SQL (window functions + gaps-and-
   islands) or in TypeScript over the fetched day list — prefer whichever is
   more readable/testable; the day list is small (≤ a few thousand rows).

3. Expose on the profile response: `current_streak: number`,
   `longest_streak: number`, `last_ac_date: string | null`.

Types: extend `UserProfileStatsRow` (`backend/types/models.ts` or the
service's local interface) and the frontend profile types.

### Achievement catalog — `backend/constants/index.ts`

```ts
export const ACHIEVEMENTS = [
  { id: 'first_solve',   name: 'First Solve',        description: 'Solve your first problem',            check: (s) => s.problemsSolved >= 1 },
  { id: 'ten_solves',    name: 'Getting Started',    description: 'Solve 10 problems',                   check: (s) => s.problemsSolved >= 10 },
  { id: 'fifty_solves',  name: 'Problem Grinder',    description: 'Solve 50 problems',                   check: (s) => s.problemsSolved >= 50 },
  { id: 'hundred_solves',name: 'Century',            description: 'Solve 100 problems',                  check: (s) => s.problemsSolved >= 100 },
  { id: 'streak_7',      name: 'On Fire',            description: '7-day AC streak',                     check: (s) => s.longestStreak >= 7 },
  { id: 'streak_30',     name: 'Unstoppable',        description: '30-day AC streak',                    check: (s) => s.longestStreak >= 30 },
  { id: 'polyglot',      name: 'Polyglot',           description: 'Solve a problem in 2+ languages',     check: (s) => Object.keys(s.languagesSolvedIn).length >= 2 },
  { id: 'contester',     name: 'Contester',          description: 'Participate in your first contest',   check: (s) => s.contestsJoined >= 1 },
] as const;
```

(Names/descriptions above are a starting catalog — the implementing agent
may refine wording but must keep the structure: id, name, description, pure
`check` over a serializable stats object.)

`AchievementStats` input shape (derived in the profile query):
`problemsSolved`, `longestStreak`, `currentStreak`, `languagesSolvedIn:
Record<string, number>` (distinct languages with ≥1 AC), `contestsJoined`
(count of `contest_participants` rows).

### Unlocking — `userProfileQueryService.getUserProfileStats`

After computing stats, map `ACHIEVEMENTS` through `check` and return
`unlocked: Array<{ id, name, description }>` plus the stats needed for
progress display (e.g. for "Century": `problemsSolved: 37/100`). Keep the
progress payload minimal: `{ unlocked, stats: { problemsSolved,
currentStreak, longestStreak } }`.

### Frontend — user profile page

`frontend/src/pages/user/UserProfile.tsx` and
`frontend/src/pages/user/UserProfile.module.css`:

1. **Streak panel**: current streak (flame-adjacent styling, no emoji —
   CSS-drawn or icon font if the project has one) with "longest streak" as
   secondary text. Place it near the existing stats/heatmap section.
2. **Achievements grid**: one card per catalog achievement — locked cards
   dimmed with a lock state, unlocked cards in full color with the name and
   description. Locked cards show progress where natural
   (`37/100 problems`).
3. `frontend/src/types/` — extend the profile response type.
4. `frontend/src/services/userService.ts` — no new endpoint needed (data
   rides the existing profile response).

No new endpoints, no new tables, no scheduler, no auth changes.

## Testing plan

- **Streak unit tests** (the biggest risk — boundary logic): today-AC,
  yesterday-AC-today-none, gap days, month/year boundaries, empty history,
  single-day history. If the walk is in SQL, test via integration against
  seeded submissions; if TypeScript, plain unit tests.
- **Achievement tests**: each catalog entry unlocks at exactly its threshold;
  `polyglot` requires ≥2 languages **with AC** (not just submissions).
- **Profile integration**: response includes streaks + unlocked list;
  timezone pinned to Asia/Bangkok.
- **Frontend**: render streak panel and achievement grid from a fixture
   profile; locked/unlocked states.

## Acceptance criteria

1. `GET /users/:username/profile` returns `current_streak`,
   `longest_streak`, `last_ac_date`, and `unlocked` achievements.
2. Streak counts days with ≥1 AC verdict; a streak with today's AC already
   banked counts today; a streak last touched yesterday is still current.
3. Day boundaries follow Asia/Bangkok.
4. The profile page shows a streak panel and an achievements grid (locked
   vs unlocked visually distinct, WCAG AA contrast in both themes).
5. No new tables, endpoints (beyond the extended response), or background
   jobs.
6. All tests pass (`backend npm test`, `frontend npm run validate`).

## Out of scope

Points/rewards, rarity tiers, notification toasts on unlock, admin-managed
achievement configuration, per-contest achievements.

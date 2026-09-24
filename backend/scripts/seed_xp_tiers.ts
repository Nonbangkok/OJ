import 'dotenv/config';
import { pool } from '../db';

/**
 * Seeds demo users spanning every tier and interesting level boundary so the
 * profile progression UI can be reviewed at a glance. Idempotent: users and
 * rewards are keyed by username/(user, problem) so reruns are no-ops.
 *
 * The demo problems are synthetic ids (e.g. "demo-l3-a") with a difficulty
 * snapshot baked into each reward — user_problem_rewards deliberately has no
 * FK to problems, so these need no problems rows. Real problems are mixed in
 * for a couple of users so the Recent XP list shows real titles too.
 *
 * All demo accounts share the password Verify#2026.
 *
 * Run inside the backend container after building:
 *   docker cp dist/scripts/seed_xp_tiers.js <backend>:/usr/src/app/dist/scripts/
 *   docker exec <backend> node dist/scripts/seed_xp_tiers.js
 */
const PASSWORD_HASH = '$2b$10$xi4NMhV7K4l1EYETwVknUeiexy25E0xgopFV/Jy2CR8EuW/wjR7hu';

/** Exact XP for a difficulty (must match calculateProblemXP). */
const xp = (difficulty: number): number =>
    Math.max(0, Math.round(20 * Math.pow(difficulty / 800, 1.5)));

/** Real, visible problems with EVEN XP values, so exact even targets stay
 *  reachable. (Odd-XP difficulties like 1200 -> 37 would strand the sum.) */
const REAL_PROBLEMS: Array<{ id: string; difficulty: number }> = [
    { id: 'sum', difficulty: 800 },      // 20 XP
    { id: 'maxpair', difficulty: 900 },  // 24 XP
    { id: 'fib', difficulty: 1100 },     // 32 XP
    { id: 'ds4', difficulty: 1400 },     // 46 XP
    { id: 'lunchbox', difficulty: 1700 },// 62 XP
    { id: 'lis', difficulty: 1800 },     // 68 XP
    { id: 'dp10', difficulty: 2400 },    // 104 XP
];

/** Even-XP synthetic difficulties — one per tile value, repeatable via
 *  distinct synthetic problem ids. */
const SYNTHETIC_DIFFICULTIES = [2400, 1800, 1700, 1400, 1100, 900, 800]; // 104, 68, 62, 46, 32, 24, 20 XP

/**
 * Build a reward list totalling exactly `target` XP (odd targets round down
 * by 1). Minimum-tile coin-change DP over the even XP values, then the
 * reconstructed coins are spent on real problems first and synthetic
 * rewards for the remainder.
 */
const buildRewards = (target: number): Array<{ problem: string; difficulty: number }> => {
    if (target === 0) return [];
    const remaining = target % 2 !== 0 ? target - 1 : target;

    const tileValues = [
        ...new Set([
            ...REAL_PROBLEMS.map(p => xp(p.difficulty)),
            ...SYNTHETIC_DIFFICULTIES.map(d => xp(d)),
        ]),
    ].filter(v => v % 2 === 0);

    // Min-coin DP with choice tracking.
    const minCoins = new Map<number, number>([[0, 0]]);
    const choice = new Map<number, number>();
    for (let amount = 2; amount <= remaining; amount += 2) {
        for (const value of tileValues) {
            if (value > amount) continue;
            const prev = minCoins.get(amount - value);
            if (prev === undefined) continue;
            if (prev + 1 < (minCoins.get(amount) ?? Infinity)) {
                minCoins.set(amount, prev + 1);
                choice.set(amount, value);
            }
        }
    }

    // Reconstruct the multiset of tile values.
    const valueCounts = new Map<number, number>();
    let amount = remaining;
    while (amount > 0) {
        const value = choice.get(amount);
        if (value === undefined) break; // unreachable — leave under target
        valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1);
        amount -= value;
    }

    // Spend on real problems first (one per problem), then synthetic repeats.
    const rewards: Array<{ problem: string; difficulty: number }> = [];
    for (const problem of REAL_PROBLEMS) {
        const value = xp(problem.difficulty);
        const count = valueCounts.get(value) ?? 0;
        if (count > 0) {
            rewards.push({ problem: problem.id, difficulty: problem.difficulty });
            valueCounts.set(value, count - 1);
        }
    }
    let syntheticIndex = 0;
    for (const [value, count] of valueCounts) {
        for (let k = 0; k < count; k++) {
            const difficulty = SYNTHETIC_DIFFICULTIES.find(d => xp(d) === value) ?? 800;
            rewards.push({ problem: `demo-${syntheticIndex++}`, difficulty });
        }
    }
    return rewards;
};

interface DemoUser {
    username: string;
    /** Exact total XP the user ends with. */
    targetXp: number;
    /** Newest reward is this many days ago; older ones count further back. */
    daysBack: number;
}

const DEMO_USERS: DemoUser[] = [
    { username: 'xp-zero', targetXp: 0, daysBack: 0 },
    { username: 'xp-level1', targetXp: 46, daysBack: 2 },          // Novice L1, 46/100
    { username: 'xp-level2-start', targetXp: 100, daysBack: 1 },   // exactly Level 2
    { username: 'xp-level4-high', targetXp: 900, daysBack: 4 },    // exactly Level 4
    { username: 'xp-level4-7', targetXp: 1270, daysBack: 5 },      // Novice L4 mid
    { username: 'xp-level5-start', targetXp: 1600, daysBack: 6 },  // exactly Level 5 (Apprentice)
    { username: 'xp-level6', targetXp: 2840, daysBack: 7 },        // Apprentice L6 (spec example)
    { username: 'xp-level9-high', targetXp: 8090, daysBack: 9 },   // Apprentice L9
    { username: 'xp-level10-start', targetXp: 8100, daysBack: 10 },// exactly Level 10 (Specialist)
    { username: 'xp-level12', targetXp: 12100, daysBack: 11 },     // Specialist L12 (spec example)
    { username: 'xp-level15-start', targetXp: 19600, daysBack: 14 },// exactly Level 15 (Expert)
    { username: 'xp-level19-high', targetXp: 32390, daysBack: 16 },// Expert L19
    { username: 'xp-level20-start', targetXp: 36100, daysBack: 18 },// exactly Level 20 (Master)
    { username: 'xp-level29-high', targetXp: 78390, daysBack: 21 },// Master L29
    { username: 'xp-level30', targetXp: 84100, daysBack: 24 },     // exactly Level 30 (Grandmaster)
    { username: 'xp-grandmaster-40', targetXp: 152100, daysBack: 28 },// Grandmaster L40
];

const main = async (): Promise<void> => {
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const demo of DEMO_USERS) {
                const inserted = await client.query(
                    `INSERT INTO users (username, password_hash, role, created_at)
                     VALUES ($1, $2, 'user', NOW() - ($3 || ' days')::interval)
                     ON CONFLICT (username) DO NOTHING
                     RETURNING id`,
                    [demo.username, PASSWORD_HASH, demo.daysBack + 30],
                );
                let userId: number;
                if (inserted.rows.length > 0) {
                    userId = inserted.rows[0].id;
                    console.log(`created user ${demo.username} (${userId})`);
                } else {
                    const existing = await client.query('SELECT id FROM users WHERE username = $1', [demo.username]);
                    userId = existing.rows[0].id;
                }

                // Rerun safety: never re-seed a user that already has rewards.
                const has = await client.query(
                    'SELECT 1 FROM user_problem_rewards WHERE user_id = $1 LIMIT 1',
                    [userId],
                );
                if (has.rows.length > 0) {
                    console.log(`skip ${demo.username}: rewards already exist`);
                    continue;
                }

                const rewards = buildRewards(demo.targetXp);
                // Newest timestamps go to real problems first so the Recent XP
                // list shows recognizable titles; synthetic fills age backwards.
                const ordered = [
                    ...rewards.filter(r => !r.problem.startsWith('demo-')),
                    ...rewards.filter(r => r.problem.startsWith('demo-')),
                ];
                // Spread across the window so history looks organic; at least
                // one reward lands "today" for streak-adjacent visuals.
                const span = Math.max(1, demo.daysBack);
                let dayOffset = 0;
                let index = 0;
                for (const reward of ordered) {
                    await client.query(
                        `INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, difficulty_snapshot, awarded_at)
                         VALUES ($1, $2, $3, $4, NOW() - ($5 || ' days')::interval)
                         ON CONFLICT (user_id, problem_id) DO NOTHING`,
                        [userId, reward.problem, xp(reward.difficulty), reward.difficulty, dayOffset],
                    );
                    index += 1;
                    dayOffset = Math.round((index / Math.max(1, ordered.length)) * span);
                }
                console.log(`seeded ${demo.username}: ${demo.targetXp} XP across ${rewards.length} rewards`);
            }

            await client.query('COMMIT');
            console.log('XP tier demo seeding complete.');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
};

void main();

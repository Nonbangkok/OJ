import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getGlobalRanking } from '../../services/rankingService';
import { getUserProgression } from '../../services/progressionService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('global XP ranking (B3)', () => {
  const schema = `rank_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE user_problem_rewards, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  /** One user with one reward row per entry of `rewards` ([xp, awardedAt SQL]). */
  const user = async (id: number, name: string, rewards: [number, string?][]) => {
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, 'x', 'user')", [id, name]);
    for (const [i, [xp, at]] of rewards.entries()) {
      await pool.query(
        `INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, awarded_at) VALUES ($1, $2, $3, ${at ?? 'NOW()'})`,
        [id, `p${id}_${i}`, xp],
      );
    }
  };

  it('ranks by XP with competition ranking (1, 2, 2, 4)', async () => {
    await user(1, 'alpha', [[300]]);
    await user(2, 'bravo', [[200]]);
    await user(3, 'charlie', [[150], [50]]);
    await user(4, 'delta', [[100]]);
    await user(5, 'nobody', []);
    const ranking = await getGlobalRanking({ window: 'all', page: 1, viewerId: null });
    expect(ranking.rows.map(r => [r.rank, r.username, r.xp, r.solved])).toEqual([
      [1, 'alpha', 300, 1], [2, 'bravo', 200, 1], [2, 'charlie', 200, 2], [4, 'delta', 100, 1],
    ]);
    expect(ranking).toMatchObject({ total: 4, page: 1, pageSize: 50, window: 'all', viewer: null });
    expect(ranking.rows[0]).toMatchObject({ hasAvatar: false, level: 2, tier: 'Novice' });
  });

  it('keeps tie ranks across a page boundary', async () => {
    for (let i = 0; i < 52; i++) {
      const xp = i === 50 ? 1000 - 49 : 1000 - i;
      await user(i + 1, `u${String(i).padStart(3, '0')}`, [[xp]]);
    }
    const page1 = await getGlobalRanking({ window: 'all', page: 1, viewerId: null });
    const page2 = await getGlobalRanking({ window: 'all', page: 2, viewerId: null });
    expect(page1.rows).toHaveLength(50);
    expect(page1.rows[49]).toMatchObject({ username: 'u049', rank: 50 });
    expect(page2.rows.map(r => [r.username, r.rank])).toEqual([['u050', 50], ['u051', 52]]);
    expect(page2.total).toBe(52);
  });

  it('week window counts only rewards from the last 7 days but level stays all-time', async () => {
    await user(1, 'veteran', [[500, "NOW() - interval '10 days'"], [50]]);
    await user(2, 'fresh', [[100]]);
    const ranking = await getGlobalRanking({ window: 'week', page: 1, viewerId: null });
    expect(ranking.rows.map(r => [r.rank, r.username, r.xp, r.solved])).toEqual([[1, 'fresh', 100, 1], [2, 'veteran', 50, 1]]);
    expect(ranking.rows[1].level).toBe(3);
    expect(ranking.window).toBe('week');
  });

  it('returns the viewer row when the viewer is off the page', async () => {
    for (let i = 0; i < 60; i++) await user(i + 1, `u${String(i).padStart(3, '0')}`, [[1000 - i]]);
    const ranking = await getGlobalRanking({ window: 'all', page: 1, viewerId: 60 });
    expect(ranking.rows).toHaveLength(50);
    expect(ranking.viewer).toMatchObject({ username: 'u059', rank: 60, xp: 941 });
  });

  it('profile global rank equals the ranking rank for tied users', async () => {
    await user(1, 'alpha', [[300]]);
    await user(2, 'bravo', [[200]]);
    await user(3, 'charlie', [[200]]);
    await user(4, 'delta', [[100]]);
    const ranking = await getGlobalRanking({ window: 'all', page: 1, viewerId: null });
    for (const [id, name] of [[3, 'charlie'], [4, 'delta']] as const) {
      expect((await getUserProgression(id)).globalRank).toBe(ranking.rows.find(r => r.username === name)!.rank);
    }
    expect((await getUserProgression(4)).globalRank).toBe(4);
  });
});

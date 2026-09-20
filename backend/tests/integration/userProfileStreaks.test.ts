import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { getUserProfileStats } from '../../services/userProfileQueryService';
import { runMigrationsFromPool } from '../../scripts/migrate';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('user profile streaks integration', () => {
  const schema = `streak_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE submissions, contest_submissions, contests, contest_participants, problems, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  let userSeq = 0;

  const seedUser = async (): Promise<string> => {
    const username = `streaker${++userSeq}`;
    await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, 'x')`,
      [username],
    );
    return username;
  };

  const seedProblem = (id: string) =>
    pool.query(
      `INSERT INTO problems (id, title, is_visible) VALUES ($1, $1, true)`,
      [id],
    );

  /** Inserts a standalone submission with a fixed instant and verdict. */
  const seedSubmission = (
    userId: number,
    problemId: string,
    status: string,
    submittedAt: string,
    language = 'cpp',
  ) =>
    pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, submitted_at)
       VALUES ($1, $2, 'int main(){}', $3, $4, $5, $6)`,
      [userId, problemId, language, status, status === 'Accepted' ? 100 : 0, submittedAt],
    );

  /** Bangkok "today" at a fixed local time, as a timestamptz string. */
  const bangkok = (localDateTime: string): string =>
    `${localDateTime}+07:00`;

  /** Real Bangkok today (YYYY-MM-DD). */
  const bangkokToday = async (): Promise<string> => {
    const result = await pool.query(`SELECT to_char(NOW() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS today`);
    return result.rows[0].today as string;
  };

  const bangkokDayOffset = async (offset: number): Promise<string> => {
    const result = await pool.query(
      `SELECT to_char((NOW() AT TIME ZONE 'Asia/Bangkok') + ($1 || ' days')::interval, 'YYYY-MM-DD') AS day`,
      [String(offset)],
    );
    return result.rows[0].day as string;
  };

  it('unions AC days from submissions and contest_submissions for the walk', async () => {
    const username = await seedUser();
    const user = (await pool.query(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    await seedProblem('p1');
    await seedProblem('p2');
    await seedProblem('p3');

    // One AC day in the standalone pool, the two following days in contests.
    const d0 = await bangkokDayOffset(-2);
    const d1 = await bangkokDayOffset(-1);
    const today = await bangkokToday();
    await seedSubmission(user.id, 'p1', 'Accepted', bangkok(`${d0}T10:00:00`));
    const contest = (await pool.query(
      `INSERT INTO contests (title, start_time, end_time) VALUES ('c', NOW() - interval '3 days', NOW() + interval '1 day') RETURNING id`,
    )).rows[0];
    await pool.query(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, submitted_at)
       VALUES ($1, $2, 'p2', 'x', 'cpp', 'Accepted', 100, $3), ($1, $2, 'p3', 'x', 'python', 'Accepted', 100, $4)`,
      [contest.id, user.id, bangkok(`${d1}T10:00:00`), bangkok(`${today}T08:00:00`)],
    );

    const stats = await getUserProfileStats(username);
    expect(stats?.current_streak).toBe(3);
    expect(stats?.longest_streak).toBe(3);
    expect(stats?.last_ac_date).toBe(today);
    // Both languages solved-in surface for the polyglot stat.
    expect(stats?.achievements.stats.languagesSolvedIn).toEqual({ cpp: 2, python: 1 });
    expect(stats?.achievements.stats.contestsJoined).toBe(0);
    expect(
      stats?.achievements.unlocked.find((a) => a.id === 'polyglot'),
    ).toBeDefined();
  });

  it('uses the Asia/Bangkok day boundary, not the session timezone', async () => {
    const username = await seedUser();
    const user = (await pool.query(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    await seedProblem('p1');

    const yesterday = await bangkokDayOffset(-1);
    // 01:00 Bangkok on the day AFTER yesterday is 18:00 UTC the previous
    // day — a session-timezone cast would put it on yet another day. Pin the
    // instant to Bangkok-local 01:00 of "yesterday + 1" (= today Bangkok).
    const today = await bangkokToday();
    expect(yesterday).not.toBe(today);

    // AC late in the Bangkok day: 23:00 local → UTC 16:00 same date.
    await seedSubmission(user.id, 'p1', 'Accepted', bangkok(`${yesterday}T23:00:00`));
    // And an AC at 01:00 Bangkok today (which is still "today" in Bangkok
    // even though UTC has already rolled over in some server timezones).
    await seedSubmission(user.id, 'p1', 'Accepted', bangkok(`${today}T01:00:00`));

    const stats = await getUserProfileStats(username);
    expect(stats?.current_streak).toBe(2);
    expect(stats?.last_ac_date).toBe(today);
  });

  it('counts only Accepted days toward streaks', async () => {
    const username = await seedUser();
    const user = (await pool.query(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    await seedProblem('p1');

    const d2 = await bangkokDayOffset(-2);
    const d1 = await bangkokDayOffset(-1);
    // WA yesterday and AC two days ago: streak broken by the non-AC day.
    await seedSubmission(user.id, 'p1', 'Accepted', bangkok(`${d2}T10:00:00`));
    await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, submitted_at)
       VALUES ($1, 'p1', 'x', 'cpp', 'Wrong Answer', 0, $2)`,
      [user.id, bangkok(`${d1}T10:00:00`)],
    );

    const stats = await getUserProfileStats(username);
    expect(stats?.current_streak).toBe(0);
    expect(stats?.longest_streak).toBe(1);
    expect(stats?.last_ac_date).toBe(d2);
  });

  it('returns zero streaks for a user with no submissions', async () => {
    const username = await seedUser();
    const stats = await getUserProfileStats(username);
    expect(stats?.current_streak).toBe(0);
    expect(stats?.longest_streak).toBe(0);
    expect(stats?.last_ac_date).toBeNull();
    expect(stats?.achievements.unlocked).toEqual([]);
  });

  it('counts contest_participants rows for the contester stat', async () => {
    const username = await seedUser();
    const user = (await pool.query(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    const contest = (await pool.query(
      `INSERT INTO contests (title, start_time, end_time) VALUES ('c2', NOW(), NOW() + interval '1 day') RETURNING id`,
    )).rows[0];
    await pool.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [contest.id, user.id]);

    const stats = await getUserProfileStats(username);
    expect(stats?.achievements.stats.contestsJoined).toBe(1);
    expect(stats?.achievements.unlocked.find((a) => a.id === 'contester')).toBeDefined();
  });

  it('requires score-100 for problemsSolved but any AC day for streaks', async () => {
    const username = await seedUser();
    const user = (await pool.query(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    await seedProblem('p1');

    const today = await bangkokToday();
    // An Accepted verdict with partial score still counts as an AC day.
    await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, submitted_at)
       VALUES ($1, 'p1', 'x', 'cpp', 'Accepted', 40, $2)`,
      [user.id, bangkok(`${today}T10:00:00`)],
    );

    const stats = await getUserProfileStats(username);
    expect(stats?.current_streak).toBe(1);
    // The raw row keeps pg's string count (pre-existing shape), but the
    // achievement stat is coerced to a number.
    expect(Number(stats?.problems_solved)).toBe(0);
    expect(stats?.achievements.stats.problemsSolved).toBe(0);
    expect(stats?.achievements.unlocked).toEqual([]);
  });
});

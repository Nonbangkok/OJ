import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import type { Pool } from 'pg';
import { USER_VALIDATION } from '../../constants';
import {
  DEMO_PASSWORD_ENV,
  assertSeedingAllowed,
  resolveDemoPassword,
  runSeed,
} from '../../scripts/seed_xp_tiers';

// A9-11: the demo seeder used to commit one shared password (in its doc
// comment) and that password's bcrypt hash, so every stack it ever ran on had
// accounts whose password was public in git.

const scriptsDir = path.join(__dirname, '../../scripts');
const BCRYPT_HASH = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/;

type Call = { text: string; params: unknown[] };

/**
 * A pool whose client answers the seeder's statements. `existing` maps a
 * username that is already taken to its row; everyone else is created.
 */
const fakePool = (existing: Record<string, { id: number; role: string }> = {}) => {
  const calls: Call[] = [];
  let nextId = 1000;
  const client = {
    query: jest.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/^\s*INSERT INTO users/.test(text)) {
        const username = params[0] as string;
        return { rows: existing[username] ? [] : [{ id: (nextId += 1) }] };
      }
      if (/^\s*SELECT id, role FROM users/.test(text)) {
        const row = existing[params[0] as string];
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => client) };
  return { pool: pool as unknown as Pick<Pool, 'connect'>, calls, connect: pool.connect };
};

describe('seed_xp_tiers demo password (A9-11)', () => {
  it('no script in backend/scripts carries a bcrypt hash', () => {
    for (const file of fs.readdirSync(scriptsDir)) {
      const full = path.join(scriptsDir, file);
      if (!fs.statSync(full).isFile()) continue;
      expect({ file, hasHash: BCRYPT_HASH.test(fs.readFileSync(full, 'utf8')) }).toEqual({ file, hasHash: false });
    }
  });

  it('generates a fresh random password when none is given', () => {
    const first = resolveDemoPassword({});
    const second = resolveDemoPassword({});
    expect(first.generated).toBe(true);
    expect(first.password.length).toBeGreaterThanOrEqual(USER_VALIDATION.MIN_PASSWORD_LENGTH);
    expect(first.password).not.toBe(second.password);
  });

  it(`takes the password from ${DEMO_PASSWORD_ENV} and refuses one shorter than the login minimum`, () => {
    expect(resolveDemoPassword({ [DEMO_PASSWORD_ENV]: 'chosen-for-this-stack' })).toEqual({
      password: 'chosen-for-this-stack',
      generated: false,
    });
    expect(() => resolveDemoPassword({ [DEMO_PASSWORD_ENV]: 'short' })).toThrow(DEMO_PASSWORD_ENV);
  });

  it('refuses to run with NODE_ENV=production', () => {
    expect(() => assertSeedingAllowed({ NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => assertSeedingAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSeedingAllowed({})).not.toThrow();
  });

  it('in production it never connects to the database', async () => {
    const { pool, connect } = fakePool();
    const log = jest.fn();
    await expect(runSeed({ env: { NODE_ENV: 'production' }, database: pool, log })).rejects.toThrow(/production/);
    expect(connect).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('hashes the generated password at seed time, prints it once, and gives it to existing demo users too', async () => {
    const { pool, calls } = fakePool({
      'xp-level1': { id: 7, role: 'user' },
      // Not a demo account: an existing admin with a demo name keeps its password.
      'xp-zero': { id: 8, role: 'admin' },
    });
    const log = jest.fn();

    await runSeed({ env: {}, database: pool, log });

    const inserts = calls.filter(c => /^\s*INSERT INTO users/.test(c.text));
    expect(inserts.length).toBeGreaterThan(2);
    const hashes = new Set(inserts.map(c => c.params[1] as string));
    expect(hashes.size).toBe(1);
    const [hash] = [...hashes];
    expect(hash).toMatch(BCRYPT_HASH);

    const lines = log.mock.calls.map(args => String(args[0]));
    const announcement = lines.find(line => line.startsWith('Demo account password'));
    const password = announcement?.split(': ').pop() as string;
    expect(password.length).toBeGreaterThanOrEqual(USER_VALIDATION.MIN_PASSWORD_LENGTH);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    // Printed once, after the seeding committed, and in no other line.
    expect(lines.filter(line => line.includes(password))).toEqual([lines[lines.length - 1]]);

    const updates = calls.filter(c => /^\s*UPDATE users SET password_hash/.test(c.text));
    expect(updates.map(c => c.params)).toEqual([[7, hash]]);

    expect(calls[0].text).toBe('BEGIN');
    expect(calls[calls.length - 1].text).toBe('COMMIT');
  });

  it(`with ${DEMO_PASSWORD_ENV} set, uses it and does not print it`, async () => {
    const { pool, calls } = fakePool();
    const log = jest.fn();

    await runSeed({ env: { [DEMO_PASSWORD_ENV]: 'chosen-for-this-stack' }, database: pool, log });

    const insert = calls.find(c => /^\s*INSERT INTO users/.test(c.text));
    expect(await bcrypt.compare('chosen-for-this-stack', insert?.params[1] as string)).toBe(true);
    expect(log.mock.calls.flat().join('\n')).not.toContain('chosen-for-this-stack');
  });
});

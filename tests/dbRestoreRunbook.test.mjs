import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Runs the database restore that docs/runbooks/continuous-deployment.md
// documents ("Restoring a database backup", the block marked as tested by this
// file) against a throwaway postgres:18-alpine container. That restore follows
// a bad migration, so it has to undo one that added a table with a foreign key
// into a table the dump holds (pg_restore --clean cannot: it drops only what is
// in the dump, without CASCADE), and a dump that cannot be read to the end must
// leave the database exactly as it was. The container has no network and a
// random name, and after() removes it.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runbook = path.join(repositoryRoot, 'docs/runbooks/continuous-deployment.md');
const MARKER = '<!-- tested by tests/dbRestoreRunbook.test.mjs -->';
const CONTAINER_PLACEHOLDER = '<database-container>';
const DUMP_PLACEHOLDER = 'backups/pre-deploy-<sha>-<timestamp>.dump';

const runId = randomBytes(4).toString('hex');
const container = `ojdbrestore-${runId}`;
const workDir = mkdtempSync(path.join(tmpdir(), `${container}-`));

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const must = (cmd, args, opts) => {
  const r = run(cmd, args, opts);
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};
// Same database and role names as production's .env, so the runbook's
// "$POSTGRES_USER" / "$POSTGRES_DB" are not the image defaults by accident.
const sql = (statement) =>
  must('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-U', 'oj_user', '-d', 'oj_db', '-v', 'ON_ERROR_STOP=1', '-tA'], {
    input: statement,
  });

const waitForPostgres = () => {
  for (let i = 0; i < 90; i += 1) {
    const logs = run('docker', ['logs', container]);
    const ready = `${logs.stdout}${logs.stderr}`.includes('PostgreSQL init process complete');
    if (ready && run('docker', ['exec', container, 'psql', '-U', 'oj_user', '-d', 'oj_db', '-c', 'select 1']).status === 0) return;
    spawnSync('sleep', ['1']);
  }
  assert.fail(`postgres in ${container} never became ready`);
};

/** The fenced block right after MARKER, with its two placeholders filled in. */
const restoreCommand = (dumpPath) => {
  const text = readFileSync(runbook, 'utf8');
  const at = text.indexOf(MARKER);
  assert.notEqual(at, -1, `the runbook marks its restore block with ${MARKER}`);
  const block = /^\n*```(?:bash|sh)\n([\s\S]*?)^```$/m.exec(text.slice(at + MARKER.length));
  assert.ok(block && block.index === 0, 'a ```bash block follows the marker directly');
  const body = block[1];
  assert.ok(body.includes(CONTAINER_PLACEHOLDER), `the block names the container as ${CONTAINER_PLACEHOLDER}`);
  assert.ok(body.includes(DUMP_PLACEHOLDER), `the block names the dump as ${DUMP_PLACEHOLDER}`);
  return body.split(CONTAINER_PLACEHOLDER).join(container).split(DUMP_PLACEHOLDER).join(dumpPath);
};

const restore = (dumpPath) => run('sh', ['-c', restoreCommand(dumpPath)], { cwd: workDir });

// The release the dump belongs to: problems and submissions reference users,
// and enough rows that the dump has a data section worth cutting short.
const V1_SCHEMA = `
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION pg_database_owner;
GRANT USAGE ON SCHEMA public TO PUBLIC;
COMMENT ON SCHEMA public IS 'standard public schema';
CREATE TABLE users (id serial PRIMARY KEY, username text NOT NULL UNIQUE);
CREATE TABLE problems (id serial PRIMARY KEY, title text NOT NULL, author_id int REFERENCES users(id));
CREATE TABLE submissions (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id int NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  source text NOT NULL
);
INSERT INTO users (username) VALUES ('alice'), ('bob');
INSERT INTO problems (title, author_id) VALUES ('A+B', 1), ('Sorting', 2);
INSERT INTO submissions (user_id, problem_id, source)
  SELECT 1 + g % 2, 1 + g % 2, md5(g::text) || repeat(' int main() {}', 1 + g % 7) FROM generate_series(1, 20000) g;
`;

// What a bad release's migration does: a new table whose foreign key points
// into a dumped table (as 0024 added problem_files -> problems), a new column,
// and damaged rows.
const BAD_MIGRATION = `
BEGIN;
CREATE TABLE problem_files (id serial PRIMARY KEY, problem_id int NOT NULL REFERENCES problems(id) ON DELETE CASCADE, name text NOT NULL);
ALTER TABLE problems ADD COLUMN problem_type text NOT NULL DEFAULT 'standard';
INSERT INTO problem_files (problem_id, name) VALUES (1, 'grader.cpp');
UPDATE problems SET title = 'BROKEN';
DELETE FROM submissions WHERE id > 100;
COMMIT;
`;

const STATE = `
SELECT (SELECT count(*) FROM submissions)
  || '|' || (SELECT string_agg(title, ',' ORDER BY id) FROM problems)
  || '|' || coalesce(to_regclass('public.problem_files')::text, '-')
  || '|' || (SELECT count(*) FROM information_schema.columns WHERE table_name = 'problems' AND column_name = 'problem_type');
`;
const PUBLIC_SCHEMA = `
SELECT pg_get_userbyid(nspowner) || ' ' || nspacl::text || ' ' || coalesce(obj_description(oid, 'pg_namespace'), '-')
FROM pg_namespace WHERE nspname = 'public';
`;
const FOREIGN_KEYS = `
SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
`;

const ORIGINAL_STATE = '20000|A+B,Sorting|-|0';
const BAD_STATE = '100|BROKEN,BROKEN|problem_files|1';

let dumpPath;
let originalPublicSchema;
let originalForeignKeys;

// Each test starts from the release the dump belongs to, after its bad migration.
const breakDatabase = () => {
  sql(V1_SCHEMA);
  sql(BAD_MIGRATION);
  assert.equal(sql(STATE), BAD_STATE);
};

before(() => {
  must('docker', [
    'run', '-d', '--name', container, '--network', 'none',
    '-e', 'POSTGRES_USER=oj_user', '-e', 'POSTGRES_DB=oj_db', '-e', `POSTGRES_PASSWORD=${randomBytes(12).toString('hex')}`,
    'postgres:18-alpine',
  ]);
  waitForPostgres();
  sql(V1_SCHEMA);
  originalPublicSchema = sql(PUBLIC_SCHEMA);
  originalForeignKeys = sql(FOREIGN_KEYS);
  assert.equal(sql(STATE), ORIGINAL_STATE);
  // The dump exactly as scripts/cd-deploy.sh takes it.
  dumpPath = path.join(workDir, 'pre-deploy.dump');
  const dump = run('sh', ['-c', `docker exec "${container}" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${dumpPath}"`]);
  assert.equal(dump.status, 0, dump.stderr);
});

after(() => {
  run('docker', ['rm', '-f', container]);
  rmSync(workDir, { recursive: true, force: true });
});

// Two ways a dump can be cut short. Missing only its last bytes, pg_restore
// fails after writing every row as complete SQL: had anything else committed
// (psql --single-transaction commits at the end of its input, say), the restore
// would leave the data without its keys, indexes and constraints. Cut in the
// middle, it fails inside a COPY.
const cuts = [
  ['the last byte', (size) => size - 1, /\n\\\.\n\n*$/],
  ['the last fifth', (size) => Math.floor(size * 0.8), /^COPY public\.submissions /m],
];

for (const [label, cutAt, partialOutput] of cuts) {
  test(`a dump missing ${label} is refused and changes nothing`, () => {
    breakDatabase();

    const truncated = path.join(workDir, 'truncated.dump');
    const bytes = readFileSync(dumpPath);
    writeFileSync(truncated, bytes.subarray(0, cutAt(bytes.length)));
    const partialSql = path.join(workDir, 'partial.sql');
    const partial = run('sh', ['-c', `docker exec -i "${container}" pg_restore -f - < "${truncated}" > "${partialSql}"`]);
    assert.notEqual(partial.status, 0, 'pg_restore fails on the cut-short dump');
    assert.match(readFileSync(partialSql, 'utf8'), partialOutput, 'pg_restore had written SQL before it failed');

    const result = restore(truncated);
    assert.notEqual(result.status, 0, `the restore reports the failure\n${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stdout, /RESTORE OK/);
    assert.equal(sql(STATE), BAD_STATE, 'the database is exactly as the bad migration left it');
  });
}

test('the documented restore undoes a migration that added a table with a foreign key into a dumped table', () => {
  breakDatabase();

  const result = restore(dumpPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, 'RESTORE OK\n', 'prints only the success line');
  assert.equal(result.stderr, '');
  assert.equal(sql(STATE), ORIGINAL_STATE, 'rows, tables and columns are as they were when the dump was taken');
  assert.equal(sql(FOREIGN_KEYS), originalForeignKeys);
  assert.equal(sql(PUBLIC_SCHEMA), originalPublicSchema, 'schema public has its default owner, privileges and comment');
  // Writable again, the way the backend uses it.
  sql("INSERT INTO submissions (user_id, problem_id, source) VALUES (1, 1, 'x')");
  // The block cleans up after itself.
  assert.notEqual(run('docker', ['exec', container, 'test', '-e', '/tmp/empty-database.sql']).status, 0);
});

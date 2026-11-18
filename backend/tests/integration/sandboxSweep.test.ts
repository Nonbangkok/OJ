import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `time_wrapper --kill-uid <uid> <sweeper-uid>` (A4-02), the per-uid process
// sweep the judge runs before handing out a sandbox identity, after the
// compile, after every testcase and at the end of the pipeline. Root in the
// production container has no CAP_KILL, so the helper kills from the uid's
// side: real and saved uid = the identity's dedicated sweeper uid, effective
// uid = the identity. kill() lets a sender whose real or effective uid equals
// the target's real or saved uid through, so kill(-1) reaches exactly the
// identity's processes, while they cannot signal the helper (its real and
// saved uids are not theirs). These cases pin what it promises: everything of
// that uid dies, even a process spinning kill(-1, SIGKILL) to stop the sweep;
// nothing else does (root, other identities); and anything it cannot prove
// dead makes it fail (the judge then fails closed).
//
// Needs the backend image (linux, root, the compiled wrapper in cwd, gcc for
// the helper programs). Run it with the production capability set
// (cap_drop ALL + SETUID/SETGID). Uses uids outside the sandbox pool so it
// never touches a judge run.
const WRAPPER = path.resolve('scripts/time_wrapper');
const gateConditions: Array<[string, boolean]> = [
  ['platform is linux', process.platform === 'linux'],
  ['running as uid 0', process.getuid?.() === 0],
  ['scripts/time_wrapper exists in cwd', fs.existsSync(WRAPPER)],
  ['gcc is installed', fs.existsSync('/usr/bin/gcc')],
];
const unmet = gateConditions.filter(([, ok]) => !ok).map(([name]) => name);
if (process.env.JUDGE_RUNTIME_REQUIRED === '1' && unmet.length > 0) {
  throw new Error(`judge runtime suite is required (JUDGE_RUNTIME_REQUIRED=1) but unmet conditions: ${unmet.join('; ')}`);
}
const enabled = unmet.length === 0;

const UID_A = 61230;
const UID_B = 61231;
/** Dedicated sweeper uids for A and B: nothing else ever runs as them. */
const SWEEPER_A = 62230;
const SWEEPER_B = 62231;
/** Only used to clean up a process the "sweeper uid in use" case starts as SWEEPER_A. */
const HYGIENE_SWEEPER = 63230;

/**
 * Started as root: takes real/saved uid `argv[1]` and effective uid `argv[2]`,
 * so a kill sent as the effective uid is refused (kill() checks the target's
 * real and saved uids). With `argv[3]` = "zombie-leader" the main thread then
 * exits while a second thread keeps running: /proc shows the process as a
 * zombie, yet it is alive.
 */
const HELPER = `#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static void *sleeper(void *arg) { (void)arg; for (;;) sleep(1); return NULL; }
int main(int argc, char **argv) {
  uid_t real = (uid_t)atoi(argv[1]), effective = (uid_t)atoi(argv[2]);
  if (setresgid(real, real, real) != 0 || setresuid(real, effective, real) != 0) { perror("setresuid"); return 1; }
  if (argc > 3 && strcmp(argv[3], "zombie-leader") == 0) {
    pthread_t thread;
    if (pthread_create(&thread, NULL, sleeper, NULL) != 0) return 1;
    pthread_exit(NULL);
  }
  for (;;) sleep(1);
}
`;

/**
 * The judged daemon of the review probe: forks away from its starter, setsid,
 * forks again, closes its stdio, then spins kill(-1, SIGKILL) in argv[1]
 * threads forever. Every other process of its uid dies the moment it exists,
 * which used to include the sweep helper once it had become the uid.
 */
const SPINNER = `#define _GNU_SOURCE
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdlib.h>
#include <unistd.h>
static void *spin(void *arg) { (void)arg; for (;;) kill(-1, SIGKILL); return NULL; }
int main(int argc, char **argv) {
  int threads = argc > 1 ? atoi(argv[1]) : 4;
  if (fork() > 0) return 0;
  setsid();
  if (fork() > 0) _exit(0);
  int fd = open("/dev/null", O_RDWR); dup2(fd, 0); dup2(fd, 1); dup2(fd, 2);
  for (int i = 0; i < threads - 1; i++) { pthread_t t; pthread_create(&t, NULL, spin, NULL); }
  spin(NULL);
  return 0;
}
`;
const SPINNER_THREADS = 6;
const SPINNER_ROUNDS = 40;

interface UidProcess { pid: number; state: string; threads: number }

/** Live processes any of whose uids is `uid` (a zombie with live threads counts). */
function liveProcesses(uid: number): UidProcess[] {
  const found: UidProcess[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      const uids = (/^Uid:\s+(.*)$/m.exec(status)?.[1] ?? '').trim().split(/\s+/).map(Number);
      const state = /^State:\s+(\S)/m.exec(status)?.[1] ?? '?';
      const threads = Number(/^Threads:\s+(\d+)/m.exec(status)?.[1] ?? 0);
      if (!uids.includes(uid)) continue;
      if ((state === 'Z' || state === 'X') && threads <= 1) continue;
      found.push({ pid: Number(entry), state, threads });
    } catch {
      // Exited while we looked.
    }
  }
  return found;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Whether `pid` is a live (non-zombie) process. */
function isLive(pid: number): boolean {
  try {
    const state = /^State:\s+(\S)/m.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1];
    return state !== undefined && state !== 'Z' && state !== 'X';
  } catch {
    return false;
  }
}

const sweep = (uid: number, sweeper: number, asUid?: number) => spawnSync(
  WRAPPER,
  ['--kill-uid', String(uid), String(sweeper)],
  {
    encoding: 'utf8',
    timeout: 10_000,
    ...(asUid !== undefined ? { uid: asUid, gid: asUid } : {}),
  },
);

(enabled ? describe : describe.skip)('time_wrapper --kill-uid (per-uid process sweep)', () => {
  jest.setTimeout(30_000);
  let workDir = '';
  let helper = '';
  let spinner = '';
  const children: ChildProcess[] = [];
  /** Processes the tests start as root; only these are killed by pid (root may signal its own). */
  let rootChildren: ChildProcess[] = [];

  const start = (command: string, args: string[], options: { uid?: number } = {}): void => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      ...(options.uid !== undefined ? { uid: options.uid, gid: options.uid } : {}),
    });
    child.unref();
    children.push(child);
  };

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
    fs.writeFileSync(path.join(workDir, 'helper.c'), HELPER);
    helper = path.join(workDir, 'helper');
    execFileSync('/usr/bin/gcc', ['-pthread', '-o', helper, path.join(workDir, 'helper.c')]);
    fs.writeFileSync(path.join(workDir, 'spinner.c'), SPINNER);
    spinner = path.join(workDir, 'spinner');
    execFileSync('/usr/bin/gcc', ['-pthread', '-o', spinner, path.join(workDir, 'spinner.c')]);
    // The workspace is root's 0700 mkdtemp: let the test uids execute the programs.
    fs.chmodSync(workDir, 0o755);
  });

  afterEach(() => {
    // Hygiene: every test uid ends with nothing running. A process started
    // as SWEEPER_A goes first (it would block A's sweep), then B (which
    // kills the helpers, real uid B), so the A sweep then passes at once.
    sweep(SWEEPER_A, HYGIENE_SWEEPER);
    for (const [uid, sweeper] of [[UID_B, SWEEPER_B], [UID_A, SWEEPER_A]]) sweep(uid, sweeper);
    for (const child of rootChildren) {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
      }
    }
    rootChildren = [];
  });

  afterAll(() => {
    for (const child of children) child.removeAllListeners();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('kills a setsid\'d, stdio-closed process tree of the uid and reports none left', async () => {
    start('/bin/sh', ['-c', 'setsid sh -c "sleep 1000 & sleep 1000" </dev/null >/dev/null 2>&1 &'], { uid: UID_A });
    await waitFor(() => liveProcesses(UID_A).length >= 2);

    const result = sweep(UID_A, SWEEPER_A);

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(liveProcesses(UID_A)).toEqual([]);
  });

  it('a process of the uid spinning kill(-1, SIGKILL) in several threads cannot stop the sweep', async () => {
    const failures: Array<{ round: number; status: number | null; signal: string | null; survivors: number }> = [];
    for (let round = 0; round < SPINNER_ROUNDS; round++) {
      start(spinner, [String(SPINNER_THREADS)], { uid: UID_A });
      await waitFor(() => liveProcesses(UID_A).some((p) => p.threads >= SPINNER_THREADS));

      const result = sweep(UID_A, SWEEPER_A);

      const survivors = liveProcesses(UID_A).length;
      if (result.status !== 0 || survivors > 0) {
        failures.push({ round, status: result.status, signal: result.signal, survivors });
        break; // a surviving spinner would only pile up (pids_limit)
      }
    }
    // Every sweep succeeds and leaves nothing: the spinner can never signal the helper.
    expect(failures).toEqual([]);
  });

  it('signals nothing but the uid\'s own processes: root and other identities keep running', async () => {
    // Root's own process: a sweeper with real uid 0 would kill it (and the backend).
    const rootSleeper = spawn('/bin/sleep', ['1000'], { detached: true, stdio: 'ignore' });
    rootSleeper.unref();
    children.push(rootSleeper);
    rootChildren.push(rootSleeper);
    start('/bin/sleep', ['1000'], { uid: UID_A });
    start('/bin/sleep', ['1000'], { uid: UID_B });
    await waitFor(() => liveProcesses(UID_A).length === 1 && liveProcesses(UID_B).length === 1
      && rootSleeper.pid !== undefined && isLive(rootSleeper.pid));

    expect(sweep(UID_A, SWEEPER_A).status).toBe(0);

    expect(liveProcesses(UID_A)).toEqual([]);
    expect(liveProcesses(UID_B)).toHaveLength(1);
    expect(isLive(rootSleeper.pid!)).toBe(true);
    expect(isLive(process.pid)).toBe(true);
  });

  it('refuses to sweep while anything runs as its sweeper uid, and then kills nothing', async () => {
    // The sweep could signal such a process (its real uid matches), so a
    // sweeper uid that is not exclusively the helper's is a setup error.
    start('/bin/sleep', ['1000'], { uid: SWEEPER_A });
    start('/bin/sleep', ['1000'], { uid: UID_A });
    await waitFor(() => liveProcesses(SWEEPER_A).length === 1 && liveProcesses(UID_A).length === 1);

    const result = sweep(UID_A, SWEEPER_A);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('in use');
    expect(liveProcesses(SWEEPER_A)).toHaveLength(1);
    expect(liveProcesses(UID_A)).toHaveLength(1);
  });

  it('fails (exit 3) when a process of the uid survives the kill', async () => {
    // Effective uid A, real and saved uid B: uid A cannot signal it.
    start(helper, [String(UID_B), String(UID_A)]);
    await waitFor(() => liveProcesses(UID_A).length === 1);

    const result = sweep(UID_A, SWEEPER_A);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('survived');
  });

  it('counts a process whose main thread exited while another thread still runs', async () => {
    start(helper, [String(UID_B), String(UID_A), 'zombie-leader']);
    await waitFor(() => liveProcesses(UID_A).some((p) => p.state === 'Z' && p.threads > 1));

    // Its /proc entry says "zombie", but it is alive and was not killed.
    expect(sweep(UID_A, SWEEPER_A).status).toBe(3);
  });

  it('refuses to run unless started as root, and then kills nothing', async () => {
    start('/bin/sleep', ['1000'], { uid: UID_A });
    await waitFor(() => liveProcesses(UID_A).length === 1);

    const result = sweep(UID_A, SWEEPER_A, UID_A);

    expect(result.status).toBe(2);
    expect(liveProcesses(UID_A)).toHaveLength(1);
  });

  it.each([
    [['0', String(SWEEPER_A)]],
    [['-1', String(SWEEPER_A)]],
    [['abc', String(SWEEPER_A)]],
    [['', String(SWEEPER_A)]],
    [[String(UID_A), '0']],
    [[String(UID_A), String(UID_A)]],
    [[String(UID_A), '65534']],
    [['65534', String(SWEEPER_A)]],
    [[String(UID_A)]],
    [[String(UID_A), String(SWEEPER_A), 'extra']],
  ])('refuses the arguments %p (no root or nobody, no sweeper equal to the uid) and kills nothing', async (args) => {
    start('/bin/sleep', ['1000'], { uid: UID_A });
    await waitFor(() => liveProcesses(UID_A).length === 1);

    const result = spawnSync(WRAPPER, ['--kill-uid', ...args], { encoding: 'utf8', timeout: 10_000 });

    expect(result.status).toBe(2);
    expect(liveProcesses(UID_A)).toHaveLength(1);
  });
});

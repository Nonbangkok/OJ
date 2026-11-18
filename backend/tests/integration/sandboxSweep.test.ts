import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `time_wrapper --kill-uid <uid>` (A4-02), the per-uid process sweep the judge
// runs before handing out a sandbox identity, after the compile, after every
// testcase and at the end of the pipeline. Root in the production container
// has no CAP_KILL, so the helper drops to the uid and kills from there; these
// cases pin what it promises: everything of that uid dies, nothing else does,
// and anything it cannot prove dead makes it fail (the judge then fails
// closed).
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

const sweep = (uid: number, asUid?: number) => spawnSync(WRAPPER, ['--kill-uid', String(uid)], {
  encoding: 'utf8',
  timeout: 10_000,
  ...(asUid !== undefined ? { uid: asUid, gid: asUid } : {}),
});

(enabled ? describe : describe.skip)('time_wrapper --kill-uid (per-uid process sweep)', () => {
  jest.setTimeout(30_000);
  let workDir = '';
  let helper = '';
  const children: ChildProcess[] = [];

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
  });

  afterEach(() => {
    // Hygiene: every test uid ends with nothing running. Sweeping B first
    // kills the helpers (real uid B), so the A sweep then passes at once.
    for (const uid of [UID_B, UID_A]) sweep(uid);
  });

  afterAll(() => {
    for (const child of children) child.removeAllListeners();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('kills a setsid\'d, stdio-closed process tree of the uid and reports none left', async () => {
    start('/bin/sh', ['-c', 'setsid sh -c "sleep 1000 & sleep 1000" </dev/null >/dev/null 2>&1 &'], { uid: UID_A });
    await waitFor(() => liveProcesses(UID_A).length >= 2);

    const result = sweep(UID_A);

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(liveProcesses(UID_A)).toEqual([]);
  });

  it('leaves the processes of every other uid alone', async () => {
    start('/bin/sleep', ['1000'], { uid: UID_A });
    start('/bin/sleep', ['1000'], { uid: UID_B });
    await waitFor(() => liveProcesses(UID_A).length === 1 && liveProcesses(UID_B).length === 1);

    expect(sweep(UID_A).status).toBe(0);

    expect(liveProcesses(UID_A)).toEqual([]);
    expect(liveProcesses(UID_B)).toHaveLength(1);
  });

  it('fails (exit 3) when a process of the uid survives the kill', async () => {
    // Effective uid A, real and saved uid B: uid A cannot signal it.
    start(helper, [String(UID_B), String(UID_A)]);
    await waitFor(() => liveProcesses(UID_A).length === 1);

    const result = sweep(UID_A);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('survived');
  });

  it('counts a process whose main thread exited while another thread still runs', async () => {
    start(helper, [String(UID_B), String(UID_A), 'zombie-leader']);
    await waitFor(() => liveProcesses(UID_A).some((p) => p.state === 'Z' && p.threads > 1));

    // Its /proc entry says "zombie", but it is alive and was not killed.
    expect(sweep(UID_A).status).toBe(3);
  });

  it('refuses to run unless started as root, and then kills nothing', async () => {
    start('/bin/sleep', ['1000'], { uid: UID_A });
    await waitFor(() => liveProcesses(UID_A).length === 1);

    const result = sweep(UID_A, UID_A);

    expect(result.status).toBe(2);
    expect(liveProcesses(UID_A)).toHaveLength(1);
  });

  it.each([['0'], ['-1'], ['abc'], ['']])('refuses the uid argument %p (a root sweep would kill everything)', (arg) => {
    const result = spawnSync(WRAPPER, ['--kill-uid', arg], { encoding: 'utf8', timeout: 10_000 });
    expect(result.status).toBe(2);
  });
});

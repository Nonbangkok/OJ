/**
 * HOTFIX 2026-09 LIVE VERIFICATION (not shipped in any flow — run manually
 * inside a production-caps container; see the hotfix commit message).
 *
 * Proves the by-construction workspace path end-to-end in an environment
 * identical to production: cap_drop ALL + SETUID/SETGID only, root process,
 * real g++, real prlimit. Exercises the EXACT functions the pipeline calls
 * (createSandboxWorkspace / writeSandboxFile / prlimitWrap compile /
 * chmodSandboxPath / removeSandboxWorkspace) and asserts the ownership of
 * every path plus a successful compile + run.
 */
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import {
  canDropPrivileges,
  chmodSandboxPath,
  createSandboxWorkspace,
  nextSandboxIdentity,
  prlimitWrap,
  removeSandboxWorkspace,
  runSandboxProcess,
  writeSandboxFile,
} from '../utils/sandboxProcess';
import { LANGUAGE_PREPARE } from '../constants';

const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

function stat(p: string): { uid: number; gid: number; mode: number } {
  const s = fs.statSync(p);
  return { uid: s.uid, gid: s.gid, mode: s.mode & 0o777 };
}

(async () => {
  console.log(`uid=${process.getuid?.()} canDropPrivileges=${canDropPrivileges()}`);
  console.log(`CapEff: ${execFileSync('sh', ['-c', 'grep CapEff /proc/self/status']).toString().trim()}`);
  if (!canDropPrivileges()) fail('expected the privileged (Linux root) path');

  const sandbox = nextSandboxIdentity();
  console.log(`sandbox identity: uid=${sandbox.uid} gid=${sandbox.gid}`);

  // 1) workspace created by a uid-dropped child
  const ws = await createSandboxWorkspace('verify_', { sandbox, context: 'verify' });
  console.log(`workspace: ${ws}`);
  const wsStat = stat(ws);
  console.log(`workspace stat: uid=${wsStat.uid} gid=${wsStat.gid} mode=${wsStat.mode.toString(8)}`);
  if (wsStat.uid !== sandbox.uid || wsStat.gid !== sandbox.gid) fail('workspace not owned by sandbox identity');
  if (wsStat.mode !== 0o711) fail(`workspace mode expected 0711, got ${wsStat.mode.toString(8)}`);

  // 2) source written by uid-dropped dd (no chown anywhere)
  const code = [
    '#include <bits/stdc++.h>',
    'int main(){ std::string s; std::getline(std::cin, s); std::cout << "hotfix-ok:" << s << std::endl; }',
  ].join('\n');
  const src = await writeSandboxFile(ws, 'solution.cpp', code, { sandbox, context: 'verify' });
  const srcStat = stat(src);
  console.log(`source stat: uid=${srcStat.uid} gid=${srcStat.gid} mode=${srcStat.mode.toString(8)}`);
  if (srcStat.uid !== sandbox.uid) fail('source not owned by sandbox identity');
  if (srcStat.mode !== 0o600) fail(`source mode expected 0600, got ${srcStat.mode.toString(8)}`);

  // 2b) LARGE source (the 64 KiB submission cap) must not be truncated by
  //     the helper's output cap — the reason the write uses `dd status=none`
  //     (silent) rather than `tee` (which echoes stdin back on stdout).
  const bigComment = `// ${'x'.repeat(200)}\n`;
  const bigCode = `${bigComment.repeat(350)}\n#include <bits/stdc++.h>\nint main(){ std::cout << "big-ok" << std::endl; }\n`;
  const bigSrc = await writeSandboxFile(ws, 'big.cpp', bigCode, { sandbox, context: 'verify' });
  const bigWritten = fs.statSync(bigSrc).size;
  console.log(`big source: wrote=${Buffer.byteLength(bigCode)}B file=${bigWritten}B`);
  if (bigWritten !== Buffer.byteLength(bigCode)) fail('large source truncated by the sandbox write');
  const bigCheck = LANGUAGE_PREPARE.cpp.checkCommand('big.cpp', 'big.out');
  const bigWrapped = prlimitWrap(bigCheck.command, bigCheck.args);
  const bigCompile = await runSandboxProcess(bigWrapped.command, bigWrapped.args, {
    cwd: ws, uid: sandbox.uid, gid: sandbox.gid,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: ws } as unknown as NodeJS.ProcessEnv,
    timeoutMs: 30000, maxBufferBytes: 10 * 1024 * 1024,
  });
  if (bigCompile.exitCode !== 0) fail(`large-source compile failed: ${bigCompile.stderr.slice(0, 300)}`);
  const bigRun = await runSandboxProcess(`${ws}/big.out`, [], {
    env: { PATH: '/usr/bin:/bin' } as unknown as NodeJS.ProcessEnv, timeoutMs: 5000, maxBufferBytes: 1024,
  });
  if (!bigRun.stdout.includes('big-ok')) fail('large-source binary wrong output');
  console.log('big source: compiled and ran correctly');

  // 3) compile exactly as the pipeline does: uid-dropped, prlimit-wrapped, shell-less
  const check = LANGUAGE_PREPARE.cpp.checkCommand('solution.cpp', 'solution.out');
  const wrapped = prlimitWrap(check.command, check.args);
  const compile = await runSandboxProcess(wrapped.command, wrapped.args, {
    cwd: ws,
    uid: sandbox.uid,
    gid: sandbox.gid,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: ws } as unknown as NodeJS.ProcessEnv,
    timeoutMs: 30000,
    maxBufferBytes: 10 * 1024 * 1024,
  });
  console.log(`compile exit=${compile.exitCode} stderr=${compile.stderr.slice(0, 300)}`);
  if (compile.exitCode !== 0) fail('compile failed (the original bug)');

  // 4) artifact exists, owned by the identity; chmod 750 as the owner
  const out = `${ws}/solution.out`;
  const outStat = stat(out);
  console.log(`binary stat: uid=${outStat.uid} gid=${outStat.gid} mode=${outStat.mode.toString(8)}`);
  if (outStat.uid !== sandbox.uid) fail('binary not owned by sandbox identity');
  await chmodSandboxPath(out, '750', { sandbox, context: 'verify' });
  if (stat(out).mode !== 0o750) fail('artifact chmod 750 failed');

  // 5) run the binary as the sandbox uid through the real judge wrapper
  const run = await runSandboxProcess(
    '/usr/bin/timeout', ['-k', '1s', '3s', '/usr/src/app/scripts/time_wrapper', out, '256', '2', String(sandbox.uid)],
    { env: { PATH: '/usr/bin:/bin' } as unknown as NodeJS.ProcessEnv, timeoutMs: 10000, maxBufferBytes: 1024 * 1024, stdin: 'ping' }
  );
  console.log(`run exit=${run.exitCode} stdout=${run.stdout.trim()} stderr=${run.stderr.trim().slice(0, 200)}`);
  if (run.exitCode !== 0) fail('sandboxed run failed');
  if (!run.stdout.includes('hotfix-ok:ping')) fail('program output wrong');

  // 6) cleanup as the owner; root could not remove uid-owned dirs here
  await removeSandboxWorkspace(ws, { sandbox, context: 'verify' });
  if (fs.existsSync(ws)) fail('workspace cleanup failed');
  console.log('cleanup: workspace removed');

  // 7) prove the old flow still would have failed in THIS container (chown EPERM)
  const chownProbe = `${ws}-probe`;
  fs.mkdirSync(chownProbe);
  let chownErr = '';
  try {
    await fs.promises.chown(chownProbe, sandbox.uid, sandbox.gid);
  } catch (e) {
    chownErr = (e as NodeJS.ErrnoException).code ?? String(e);
  }
  fs.rmSync(chownProbe, { recursive: true, force: true });
  console.log(`root chown probe: ${chownErr || 'SUCCEEDED?!'}`);
  if (chownErr !== 'EPERM') fail('container unexpectedly allows chown — verification environment mismatch');

  console.log('ALL LIVE VERIFICATION CHECKS PASSED');
})().catch((e) => {
  console.error('FAIL: unexpected error', e);
  process.exit(1);
});

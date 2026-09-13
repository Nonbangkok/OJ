import { spawnSync } from 'node:child_process';

// The supported deployed runtime is Linux. macOS uses its own font registry;
// run this check in the backend image to catch missing deployment dependencies.
const testLinuxRuntime = process.platform === 'linux' ? it : it.skip;

testLinuxRuntime('provides fonts for Thai and Latin fallback-avatar initials', () => {
  for (const language of ['th', 'en']) {
    const result = spawnSync('fc-list', [`:lang=${language}`, '--format', '%{file}\n'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  }
});

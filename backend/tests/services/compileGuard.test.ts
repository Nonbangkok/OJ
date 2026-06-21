import { findForbiddenInclude, sanitizeCompilerStderr } from '../../services/submissionService';

/**
 * Unit tests for the compile-time hardening (security item N1):
 * - block #include directives that read files outside the submission, which
 *   would otherwise let a source exfiltrate secrets / read arbitrary files via
 *   g++ error output (e.g. `#include "/proc/self/environ"`);
 * - strip the internal temp source path from returned compiler diagnostics.
 */
describe('findForbiddenInclude', () => {
  it('allows ordinary standard-library and relative includes', () => {
    expect(findForbiddenInclude('#include <bits/stdc++.h>\nint main(){}')).toBeNull();
    expect(findForbiddenInclude('#include <iostream>\n#include <vector>')).toBeNull();
    expect(findForbiddenInclude('#include "helper.h"')).toBeNull();
    expect(findForbiddenInclude('int main(){ return 0; }')).toBeNull();
  });

  it('rejects absolute-path includes (quote form) — the secret-exfil vector', () => {
    expect(findForbiddenInclude('#include "/proc/self/environ"')).toBe('/proc/self/environ');
    expect(findForbiddenInclude('#include "/etc/shadow"\nint main(){}')).toBe('/etc/shadow');
  });

  it('rejects absolute-path includes (angle form)', () => {
    expect(findForbiddenInclude('#include </etc/passwd>')).toBe('/etc/passwd');
  });

  it('rejects parent-directory traversal', () => {
    expect(findForbiddenInclude('#include "../../app/.env"')).toBe('../../app/.env');
    expect(findForbiddenInclude('#include "../secret.txt"')).toBe('../secret.txt');
  });

  it('handles odd-but-valid whitespace in the directive', () => {
    expect(findForbiddenInclude('  #  include   "/proc/self/environ"  ')).toBe('/proc/self/environ');
    expect(findForbiddenInclude('#include <  cstdio  >')).toBeNull();
  });

  it('returns the first offending include when several are present', () => {
    const code = '#include <iostream>\n#include "/proc/self/environ"\n#include "/etc/shadow"';
    expect(findForbiddenInclude(code)).toBe('/proc/self/environ');
  });
});

describe('sanitizeCompilerStderr', () => {
  it('replaces the internal temp source path with a neutral name', () => {
    const tempPath = '/usr/src/app/services/submissions/42_1700000000000.cpp';
    const raw = `${tempPath}: In function 'int main()':\n${tempPath}:3:5: error: expected ';'`;
    const out = sanitizeCompilerStderr(raw, tempPath);
    expect(out).not.toContain(tempPath);
    expect(out).toContain('solution.cpp');
    expect(out).toContain("error: expected ';'");
  });

  it('returns a generic message when stderr is empty/undefined', () => {
    expect(sanitizeCompilerStderr('', '/tmp/x.cpp')).toBe('Compilation failed');
    expect(sanitizeCompilerStderr(undefined, '/tmp/x.cpp')).toBe('Compilation failed');
  });
});

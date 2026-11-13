import { ZipArchive } from 'archiver';
import {
  readFlatZip,
  validateProblemFileSet,
  validateProblemFilename,
  validateSubmissionFilename,
} from '../../utils/headerProblemFiles';

const f = (filename: string, size = 5) => ({ filename, content: Buffer.alloc(size, 97) });

async function zipOf(entries: [string, string | Buffer][]): Promise<Buffer> {
  const zip = new ZipArchive();
  const chunks: Buffer[] = [];
  zip.on('data', (c: Buffer) => chunks.push(c));
  for (const [name, data] of entries) zip.append(data, { name });
  await zip.finalize();
  return Buffer.concat(chunks);
}

describe('validateProblemFilename', () => {
  it('accepts simple names', () => expect(validateProblemFilename('main.cpp')).toBeNull());
  it.each(['../x.h', 'a/b.h', '.hidden', '', 'a'.repeat(101)])('rejects %p', (n) => {
    expect(validateProblemFilename(n)).not.toBeNull();
  });
});

describe('validateSubmissionFilename', () => {
  it('accepts headers', () => {
    expect(validateSubmissionFilename('student.h')).toBeNull();
    expect(validateSubmissionFilename('student.hpp')).toBeNull();
  });
  it('rejects .cpp', () => expect(validateSubmissionFilename('student.cpp')).not.toBeNull());
});

describe('validateProblemFileSet', () => {
  it('requires a .cpp in grader', () => {
    expect(validateProblemFileSet('grader', [f('queue.h')], 'student.h')).toContain('.cpp');
  });
  it('rejects grader file named like the submission file', () => {
    expect(validateProblemFileSet('grader', [f('main.cpp'), f('student.h')], 'student.h')).toContain('student.h');
  });
  it('rejects bad extension', () => {
    expect(validateProblemFileSet('grader', [f('main.cpp'), f('run.py')], 'student.h')).not.toBeNull();
  });
  it('rejects too many files', () => {
    const files = Array.from({ length: 21 }, (_, i) => f(`f${i}.cpp`));
    expect(validateProblemFileSet('grader', files, 'student.h')).not.toBeNull();
  });
  it('rejects oversize file', () => {
    expect(validateProblemFileSet('grader', [f('main.cpp', 1024 * 1024 + 1)], 'student.h')).not.toBeNull();
  });
  it('accepts valid grader set', () => {
    expect(validateProblemFileSet('grader', [f('main.cpp'), f('queue.h')], 'student.h')).toBeNull();
  });
  it('rejects duplicate names', () => {
    expect(validateProblemFileSet('grader', [f('main.cpp'), f('main.cpp')], 'student.h')).not.toBeNull();
  });
  it('allows any valid name in starter', () => {
    expect(validateProblemFileSet('starter', [f('student.cbp')], 'student.h')).toBeNull();
  });
  it('allows empty starter', () => {
    expect(validateProblemFileSet('starter', [], 'student.h')).toBeNull();
  });
});

describe('readFlatZip', () => {
  it('reads flat entries with exact bytes', async () => {
    const out = await readFlatZip(await zipOf([['main.cpp', 'int main(){}'], ['queue.h', '#pragma once\n']]));
    expect(out.map((e) => e.filename).sort()).toEqual(['main.cpp', 'queue.h']);
    expect(out.find((e) => e.filename === 'queue.h')!.content.toString()).toBe('#pragma once\n');
  });
  it('rejects nested paths naming the entry', async () => {
    await expect(readFlatZip(await zipOf([['queue/main.cpp', 'x']]))).rejects.toThrow('queue/main.cpp');
  });
  it('ignores __MACOSX and .DS_Store', async () => {
    const out = await readFlatZip(await zipOf([['main.cpp', 'x'], ['__MACOSX/._main.cpp', 'y'], ['.DS_Store', 'z']]));
    expect(out.map((e) => e.filename)).toEqual(['main.cpp']);
  });
  it('rejects oversize entry', async () => {
    await expect(readFlatZip(await zipOf([['big.cpp', Buffer.alloc(1024 * 1024 + 1, 97)]]))).rejects.toThrow('big.cpp');
  });
  it('rejects too many files', async () => {
    const entries: [string, string][] = Array.from({ length: 21 }, (_, i) => [`f${i}.cpp`, 'x']);
    await expect(readFlatZip(await zipOf(entries))).rejects.toThrow(/20/);
  });
});

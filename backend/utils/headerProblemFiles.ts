import path from 'path';
import * as unzipper from 'unzipper';
import { HEADER_PROBLEM_LIMITS, type ProblemFileRole } from '../constants';
import {
  GRADER_SOURCE_EXTENSION_LIST,
  hasMiscasedCppExtension,
  isGraderHeaderFilename,
  isGraderSourceFilename,
  validateProblemFilename,
  validateSubmissionFilename,
} from './problemFilename';
import { assertSafeArchive, type ArchiveEntryLike } from './archiveSafety';
import { createInflateBudget, readZipEntryBounded } from './zipEntryReader';

export { validateProblemFilename, validateSubmissionFilename };

export interface ProblemFileInput {
  filename: string;
  content: Buffer;
}

/** Grader-role rules: exact-case extensions, at least one source, one `.s` per source. */
function validateGraderFiles(files: readonly ProblemFileInput[], submissionFilename: string | null): string | null {
  for (const file of files) {
    if (!isGraderSourceFilename(file.filename) && !isGraderHeaderFilename(file.filename)) {
      return `Grader file "${file.filename}" must be a C++ source (${GRADER_SOURCE_EXTENSION_LIST}, in exactly that case: `
        + 'the suffixes g++ compiles as C++) or a header (.h or .hpp).';
    }
    if (submissionFilename !== null && file.filename === submissionFilename) {
      return `Grader file must not be named "${submissionFilename}" (that is the student's submission file).`;
    }
  }
  const sources = files.filter((f) => isGraderSourceFilename(f.filename));
  if (sources.length === 0) {
    return `Grader files must include at least one C++ source file (${GRADER_SOURCE_EXTENSION_LIST}).`;
  }
  // The judge compiles each source to `<stem>.s` in one workspace, so two
  // sources may not share a stem (`a.cpp` + `a.cc`).
  const byStem = new Map<string, string>();
  for (const source of sources) {
    const stem = path.basename(source.filename, path.extname(source.filename));
    const other = byStem.get(stem);
    if (other) return `Grader sources "${other}" and "${source.filename}" share the name "${stem}"; rename one of them.`;
    byStem.set(stem, source.filename);
  }
  return null;
}

export function validateProblemFileSet(
  role: ProblemFileRole,
  files: readonly ProblemFileInput[],
  submissionFilename: string | null,
): string | null {
  if (files.length > HEADER_PROBLEM_LIMITS.MAX_FILES_PER_ROLE) {
    return `Too many ${role} files (max ${HEADER_PROBLEM_LIMITS.MAX_FILES_PER_ROLE}).`;
  }
  const seen = new Set<string>();
  for (const file of files) {
    const nameError = validateProblemFilename(file.filename);
    if (nameError) return nameError;
    if (seen.has(file.filename)) return `Duplicate ${role} file "${file.filename}".`;
    seen.add(file.filename);
    if (file.content.length > HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES) {
      return `File "${file.filename}" exceeds ${HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES} bytes.`;
    }
    // Starters may hold any file (notes, sample inputs); one that looks like
    // C++ must use a casing students' g++ compiles as C++.
    if (role === 'starter' && hasMiscasedCppExtension(file.filename)) {
      return `Starter file "${file.filename}" has a C++ extension in a casing g++ does not compile as C++; `
        + `use ${GRADER_SOURCE_EXTENSION_LIST}, .h or .hpp.`;
    }
  }
  return role === 'grader' ? validateGraderFiles(files, submissionFilename) : null;
}

function isIgnoredEntry(entryPath: string): boolean {
  return (
    entryPath.startsWith('__MACOSX/') ||
    entryPath === '__MACOSX' ||
    path.posix.basename(entryPath) === '.DS_Store'
  );
}

/** Read a ZIP whose entries are all flat files (no directories); enforces size/count limits. */
export async function readFlatZip(zip: Buffer): Promise<ProblemFileInput[]> {
  const directory = await unzipper.Open.buffer(zip);
  assertSafeArchive(directory.files as unknown as ArchiveEntryLike[]);

  const candidates = directory.files.filter((e) => e.type !== 'Directory' && !isIgnoredEntry(e.path));
  if (candidates.length > HEADER_PROBLEM_LIMITS.MAX_FILES_PER_ROLE) {
    throw new Error(`ZIP contains too many files (max ${HEADER_PROBLEM_LIMITS.MAX_FILES_PER_ROLE}).`);
  }

  const seen = new Set<string>();
  for (const entry of candidates) {
    if (entry.path.includes('/') || entry.path.includes('\\')) {
      throw new Error(`ZIP entry "${entry.path}" is in a folder; files must be at the top level.`);
    }
    const nameError = validateProblemFilename(entry.path);
    if (nameError) throw new Error(nameError);
    if (seen.has(entry.path)) throw new Error(`ZIP contains duplicate entry "${entry.path}".`);
    seen.add(entry.path);
    if (entry.uncompressedSize > HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES) {
      throw new Error(`ZIP entry "${entry.path}" exceeds ${HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES} bytes.`);
    }
  }

  // The checks above use declared sizes; the read below counts real ones,
  // so an entry that lies about its size cannot inflate past the caps.
  const budget = createInflateBudget(HEADER_PROBLEM_LIMITS.MAX_FILES_PER_ROLE * HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES);
  const result: ProblemFileInput[] = [];
  for (const entry of candidates) {
    const content = await readZipEntryBounded(entry, HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES, budget);
    result.push({ filename: entry.path, content });
  }
  return result;
}

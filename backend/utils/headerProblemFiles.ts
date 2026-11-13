import path from 'path';
import * as unzipper from 'unzipper';
import { HEADER_PROBLEM_LIMITS, type ProblemFileRole } from '../constants';
import { assertSafeArchive, type ArchiveEntryLike } from '../services/batchUploadService';

export interface ProblemFileInput {
  filename: string;
  content: Buffer;
}

const FILENAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const GRADER_EXTENSIONS = new Set(['.cpp', '.h', '.hpp']);
const SUBMISSION_EXTENSIONS = new Set(['.h', '.hpp']);

export function validateProblemFilename(name: string): string | null {
  if (!FILENAME_PATTERN.test(name)) {
    return `Invalid file name "${name}": use 1-100 letters, digits, "_", "-" or "." with no path and no leading dot.`;
  }
  return null;
}

export function validateSubmissionFilename(name: string): string | null {
  const nameError = validateProblemFilename(name);
  if (nameError) return nameError;
  if (!SUBMISSION_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    return `Submission file "${name}" must end in .h or .hpp.`;
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
  }
  if (role === 'grader') {
    for (const file of files) {
      if (!GRADER_EXTENSIONS.has(path.extname(file.filename).toLowerCase())) {
        return `Grader file "${file.filename}" must end in .cpp, .h or .hpp.`;
      }
      if (submissionFilename !== null && file.filename === submissionFilename) {
        return `Grader file must not be named "${submissionFilename}" (that is the student's submission file).`;
      }
    }
    if (!files.some((f) => path.extname(f.filename).toLowerCase() === '.cpp')) {
      return 'Grader files must include at least one .cpp file.';
    }
  }
  return null;
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

  const result: ProblemFileInput[] = [];
  for (const entry of candidates) {
    const content = await entry.buffer();
    if (content.length > HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES) {
      throw new Error(`ZIP entry "${entry.path}" exceeds ${HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES} bytes.`);
    }
    result.push({ filename: entry.path, content });
  }
  return result;
}

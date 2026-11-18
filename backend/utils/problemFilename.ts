import path from 'path';
import { GRADER_HEADER_EXTENSIONS, GRADER_SOURCE_EXTENSIONS } from '../constants';

// Dependency-free filename rules, importable from request schemas without pulling in unzipper.
const FILENAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
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

/**
 * A grader file g++ compiles as a C++ source: exact, case-sensitive suffix
 * match. The one rule behind upload validation, the "has a grader source"
 * readiness check and the judge's compile plan, so the three always agree.
 */
export function isGraderSourceFilename(name: string): boolean {
  return (GRADER_SOURCE_EXTENSIONS as readonly string[]).includes(path.extname(name));
}

/** A grader header (reaches the compile only through #include): exact suffix match. */
export function isGraderHeaderFilename(name: string): boolean {
  return (GRADER_HEADER_EXTENSIONS as readonly string[]).includes(path.extname(name));
}

/**
 * A C++ source or header extension in any casing but the exact lowercase one
 * (`main.Cpp`, `vector.H`): g++ would not compile the source as C++, and the
 * header-problem include rules only know lowercase `.h` / `.hpp` names.
 */
export function hasMiscasedCppExtension(name: string): boolean {
  const extension = path.extname(name);
  const lower = extension.toLowerCase();
  return extension !== lower
    && ([...GRADER_SOURCE_EXTENSIONS, ...GRADER_HEADER_EXTENSIONS] as readonly string[]).includes(lower);
}

/**
 * Postgres regex (for `filename ~ '<this>'`) matching exactly the names
 * {@link isGraderSourceFilename} accepts. A constant, safe to inline in SQL.
 */
export const GRADER_SOURCE_FILENAME_SQL_REGEX =
  `\\.(${GRADER_SOURCE_EXTENSIONS.map((ext) => ext.slice(1)).join('|')})$`;

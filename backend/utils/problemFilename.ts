import path from 'path';
import { GRADER_HEADER_EXTENSIONS, GRADER_SOURCE_EXTENSIONS } from '../constants';

// Dependency-free filename rules, importable from request schemas without pulling in unzipper.
// `+` is allowed after the first character so a `.c++` grader source can be stored.
const FILENAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,99}$/;
const SUBMISSION_EXTENSIONS = new Set(['.h', '.hpp']);

export function validateProblemFilename(name: string): string | null {
  if (!FILENAME_PATTERN.test(name)) {
    return `Invalid file name "${name}": use 1-100 letters, digits, "_", "-", "+" or "." with no path and no leading dot or "+".`;
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
 * match against GRADER_SOURCE_EXTENSIONS. The one rule behind upload
 * validation, the "has a grader source" readiness check and the judge's
 * compile plan, so the three always agree.
 */
export function isGraderSourceFilename(name: string): boolean {
  return (GRADER_SOURCE_EXTENSIONS as readonly string[]).includes(path.extname(name));
}

/** A grader header (reaches the compile only through #include): exact suffix match. */
export function isGraderHeaderFilename(name: string): boolean {
  return (GRADER_HEADER_EXTENSIONS as readonly string[]).includes(path.extname(name));
}

const CPP_EXTENSIONS: readonly string[] = [...GRADER_SOURCE_EXTENSIONS, ...GRADER_HEADER_EXTENSIONS];
const CPP_EXTENSIONS_FOLDED = new Set(CPP_EXTENSIONS.map((ext) => ext.toLowerCase()));

/** The accepted suffixes, for messages: `.cpp, .cc, ... or .CPP`. */
export const GRADER_SOURCE_EXTENSION_LIST = GRADER_SOURCE_EXTENSIONS.join(', ');

/**
 * A C++ source or header extension in a casing g++ does not compile as C++
 * (`main.Cpp`, `main.CXX`, `vector.H`): not in the accepted lists, but equal
 * to one of them ignoring case. An all-lowercase extension that is simply
 * another language (`helper.c`) does not count.
 */
export function hasMiscasedCppExtension(name: string): boolean {
  const extension = path.extname(name);
  return !CPP_EXTENSIONS.includes(extension)
    && extension !== extension.toLowerCase()
    && CPP_EXTENSIONS_FOLDED.has(extension.toLowerCase());
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Postgres regex (for `filename ~ '<this>'`) matching exactly the names
 * {@link isGraderSourceFilename} accepts. A constant, safe to inline in SQL
 * (standard_conforming_strings: backslashes are literal).
 */
export const GRADER_SOURCE_FILENAME_SQL_REGEX =
  `\\.(${GRADER_SOURCE_EXTENSIONS.map((ext) => escapeRegex(ext.slice(1))).join('|')})$`;

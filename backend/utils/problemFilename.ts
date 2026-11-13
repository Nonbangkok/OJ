import path from 'path';

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

import type { SubmissionLanguage } from './constants';

/** localStorage key for the per-problem, per-language code drafts of the submit editor. */
export const SUBMISSION_CACHE_KEY = 'oj-submission-cache';

export interface CachedSubmission {
  code: string;
  timestamp: number;
}

export type SubmissionCache = Record<string, CachedSubmission>;

export const readSubmissionCache = (): SubmissionCache => {
  try {
    return JSON.parse(localStorage.getItem(SUBMISSION_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
};

export const writeSubmissionCache = (cache: SubmissionCache): void => {
  try {
    localStorage.setItem(SUBMISSION_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Failed to write to localStorage:', error);
  }
};

/** Makes `code` the newest draft for this problem and language, so the submit editor opens on it. */
export const seedSubmissionDraft = (problemId: string, language: SubmissionLanguage, code: string): void => {
  const cache = readSubmissionCache();
  cache[`${problemId}:${language}`] = { code, timestamp: new Date().getTime() };
  writeSubmissionCache(cache);
};

/** Forgets every draft in this browser (on logout, so the next person on a shared PC never sees them). */
export const clearSubmissionDrafts = (): void => {
  try {
    localStorage.removeItem(SUBMISSION_CACHE_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
};

import { APP_CONSTANTS } from './constants';
import type { SubmissionLanguage } from './constants';

/** localStorage key for the per-problem, per-language code drafts of the submit editor. */
export const SUBMISSION_CACHE_KEY = 'oj-submission-cache';
/** localStorage key for the id of the signed-in user the stored drafts belong to. */
export const SUBMISSION_CACHE_OWNER_KEY = 'oj-submission-cache-owner';

export interface CachedSubmission {
  code: string;
  timestamp: number;
}

export type SubmissionCache = Record<string, CachedSubmission>;

/** Drops every draft older than the cache window, whichever problem it belongs to. */
const withoutExpired = (cache: SubmissionCache, now = Date.now()): SubmissionCache =>
  Object.fromEntries(Object.entries(cache).filter(([, draft]) =>
    typeof draft?.timestamp === 'number' && now - draft.timestamp < APP_CONSTANTS.SUBMISSION_CACHE_EXPIRY));

/** The unexpired drafts in this browser. */
export const readSubmissionCache = (): SubmissionCache => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SUBMISSION_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? withoutExpired(parsed as SubmissionCache) : {};
  } catch {
    return {};
  }
};

/** Stores the drafts, pruning expired entries on the way. */
export const writeSubmissionCache = (cache: SubmissionCache): void => {
  try {
    localStorage.setItem(SUBMISSION_CACHE_KEY, JSON.stringify(withoutExpired(cache)));
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
    localStorage.removeItem(SUBMISSION_CACHE_OWNER_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
};

/**
 * Binds the stored drafts to the signed-in user. Drafts belong to exactly one
 * user: when another user signs in on this browser, or no session exists any
 * more (expiry, password reset, deleted account), every draft is wiped before
 * anyone can see it. Expired entries are pruned on the way.
 */
export const bindSubmissionDraftsToUser = (userId: number | null): void => {
  try {
    const owner = localStorage.getItem(SUBMISSION_CACHE_OWNER_KEY);
    if (userId === null || owner !== String(userId)) {
      clearSubmissionDrafts();
      if (userId !== null) localStorage.setItem(SUBMISSION_CACHE_OWNER_KEY, String(userId));
      return;
    }
    const stored = localStorage.getItem(SUBMISSION_CACHE_KEY);
    if (stored !== null) writeSubmissionCache(readSubmissionCache());
  } catch {
    // storage unavailable: nothing stored to protect
  }
};

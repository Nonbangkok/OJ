import type { LoaderFunctionArgs } from 'react-router-dom';
import problemService, { type ProblemListQuery } from '../services/problemService';
import adminService from '../services/adminService';
import { PROBLEMS_PAGE, ADMIN_PROBLEMS_PAGE } from '../config/constants';
import type {
  AdminProblemsPageResponse,
  AdminProblemsQuery,
  ProblemSummary,
  ProblemsWithStatsPageResponse,
} from '../types';

const MAX_RESTORE_PAGES = 500;
const MAX_REQUEST_LIMIT = 100;

export interface ProblemListSpan<T> {
  queryKey: string;
  problems: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Query-level metadata comes from the latest page response. */
  pageMetadata?: Omit<AdminProblemsPageResponse, 'problems' | 'nextCursor' | 'hasMore'>;
}

export interface PublicProblemListFilters {
  search: string;
  category: string;
  author: string;
  collection: string;
  difficultyMin: string;
  difficultyMax: string;
  sort: string;
}

export interface AdminProblemListFilters {
  search: string;
  collection: string;
  visibility: string;
  author: string;
}

const requestedPages = (params: URLSearchParams): number => {
  const raw = Number(params.get('pages') || 1);
  return Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, MAX_RESTORE_PAGES) : 1;
};

const walkProblemPages = async <T, Q extends { limit?: number; cursor?: string | null }>(
  fetchPage: (query: Q) => Promise<{ problems: T[]; nextCursor: string | null; hasMore: boolean }>,
  query: Q,
  targetCount: number,
): Promise<{ problems: T[]; nextCursor: string | null; hasMore: boolean }> => {
  const problems: T[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  let hasMore = true;
  while (problems.length < targetCount && hasMore) {
    const limit = Math.min(MAX_REQUEST_LIMIT, targetCount - problems.length);
    const page = await fetchPage({ ...query, limit, ...(cursor ? { cursor } : {}) });
    problems.push(...page.problems);
    hasMore = page.hasMore;
    if (!hasMore) {
      cursor = null;
      break;
    }
    if (!page.nextCursor || visited.has(page.nextCursor)) {
      throw new Error('Problem list pagination returned an invalid cursor.');
    }
    visited.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { problems, nextCursor: hasMore ? cursor : null, hasMore };
};

export const buildPublicProblemListQuery = ({
  search, category, author, collection, difficultyMin, difficultyMax, sort,
}: PublicProblemListFilters): ProblemListQuery => {
  const trimmedSearch = search.trim();
  const trimmedAuthor = author.trim();
  return {
    ...(trimmedSearch ? { search: trimmedSearch } : {}),
    ...(category ? { category } : {}),
    ...(trimmedAuthor ? { author: trimmedAuthor } : {}),
    ...(collection ? { collection: collection === 'none' ? 'none' : Number(collection) } : {}),
    ...(difficultyMin !== '' ? { difficultyMin: Number(difficultyMin) } : {}),
    ...(difficultyMax !== '' ? { difficultyMax: Number(difficultyMax) } : {}),
    ...(sort === 'difficulty-asc' || sort === 'difficulty-desc'
      ? { sort: 'difficulty', order: sort === 'difficulty-asc' ? 'asc' : 'desc' }
      : {}),
  };
};

export const buildAdminProblemListQuery = ({ search, collection, visibility, author }: AdminProblemListFilters): AdminProblemsQuery => {
  const trimmedSearch = search.trim();
  return {
    ...(trimmedSearch ? { search: trimmedSearch } : {}),
    ...(collection !== 'all' ? { collection: collection === 'none' ? 'none' : Number(collection) } : {}),
    ...(visibility === 'visible' || visibility === 'hidden' ? { visibility } : {}),
    ...(author !== 'all' ? { author } : {}),
  };
};

export const publicProblemListQueryFromUrl = (url: URL): ProblemListQuery => {
  const params = url.searchParams;
  return buildPublicProblemListQuery({
    search: params.get('search') || '',
    category: params.get('category') || '',
    author: params.get('author') || '',
    collection: params.get('collection') || '',
    difficultyMin: params.get('difficultyMin') || '',
    difficultyMax: params.get('difficultyMax') || '',
    sort: params.get('sort') ?? 'difficulty-asc',
  });
};

export const adminProblemListQueryFromUrl = (url: URL): AdminProblemsQuery => {
  const params = url.searchParams;
  return buildAdminProblemListQuery({
    search: params.get('search') || '',
    collection: params.get('collection') || 'all',
    visibility: params.get('visibility') || 'all',
    author: params.get('author') || 'all',
  });
};

export const loadPublicProblemListSpan = async (url: URL): Promise<ProblemListSpan<ProblemSummary> | null> => {
  const query = publicProblemListQueryFromUrl(url);
  const queryKey = JSON.stringify(query);
  const targetCount = requestedPages(url.searchParams) * PROBLEMS_PAGE.PAGE_SIZE;
  try {
    const result = await walkProblemPages(
      query => problemService.getProblemsPage(query),
      query,
      targetCount,
    );
    return { queryKey, ...result };
  } catch {
    // Authentication and transient API failures are handled by the page's
    // existing error/empty states; a loader failure must not replace the app.
    return null;
  }
};

export const loadAdminProblemListSpan = async (url: URL): Promise<ProblemListSpan<AdminProblemsPageResponse['problems'][number]> | null> => {
  const query = adminProblemListQueryFromUrl(url);
  const queryKey = JSON.stringify(query);
  const targetCount = requestedPages(url.searchParams) * ADMIN_PROBLEMS_PAGE.PAGE_SIZE;
  const problems: AdminProblemsPageResponse['problems'] = [];
  let cursor: string | null = null;
  let hasMore = true;
  let pageMetadata: ProblemListSpan<AdminProblemsPageResponse['problems'][number]>['pageMetadata'];
  const visited = new Set<string>();
  try {
    while (problems.length < targetCount && hasMore) {
      const page: AdminProblemsPageResponse = await adminService.getProblems({
        ...query,
        limit: Math.min(MAX_REQUEST_LIMIT, targetCount - problems.length),
        ...(cursor ? { cursor } : {}),
      });
      problems.push(...page.problems);
      pageMetadata = {
        authors: page.authors,
        hasUnauthoredProblems: page.hasUnauthoredProblems,
        bulkEligibleCount: page.bulkEligibleCount,
      };
      hasMore = page.hasMore;
      if (!hasMore) {
        cursor = null;
        break;
      }
      if (!page.nextCursor || visited.has(page.nextCursor)) throw new Error('Invalid problem cursor');
      visited.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    return { queryKey, problems, nextCursor: hasMore ? cursor : null, hasMore, pageMetadata };
  } catch {
    return null;
  }
};

export const publicProblemsLoader = ({ request }: LoaderFunctionArgs) => loadPublicProblemListSpan(new URL(request.url));
export const adminProblemsLoader = ({ request }: LoaderFunctionArgs) => loadAdminProblemListSpan(new URL(request.url));

/** Prevent filter/pagination query edits from re-running route loaders. The
 * components already own those same-route fetches. Returning from a detail
 * path changes pathname and intentionally re-runs the loader before scroll. */
export const revalidateProblemListOnPathChange = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: {
  currentUrl: URL;
  nextUrl: URL;
  defaultShouldRevalidate: boolean;
}): boolean => currentUrl.pathname !== nextUrl.pathname && defaultShouldRevalidate;

export type PublicProblemListLoaderData = ProblemListSpan<ProblemSummary> | null;
export type AdminProblemListLoaderData = ProblemListSpan<AdminProblemsPageResponse['problems'][number]> | null;
export type { ProblemListQuery };

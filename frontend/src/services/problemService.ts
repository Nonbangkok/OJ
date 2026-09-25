import api from './api';

import type {
  ContestProblemDetailResponse,
  ProblemCategoryCountsResponse,
  ProblemDetailResponse,
  ProblemsWithStatsPageResponse,
  ProblemsWithStatsResponse,
} from '../types';

/** Difficulty filtering/sorting for the problems list (server-side). */
export interface ProblemListDifficultyQuery {
  /** Inclusive lower bound; when set, Unrated problems are excluded. */
  difficultyMin?: number;
  difficultyMax?: number;
  /** 'difficulty' sorts NULLS LAST in both directions. */
  sort?: 'difficulty';
  order?: 'asc' | 'desc';
}

/**
 * Full query surface of the paginated problems list. `search` matches
 * id/title server-side; `category` is one of the fixed categories or
 * 'Uncategorized'; `cursor` is the opaque next-page token.
 */
export interface ProblemListQuery extends ProblemListDifficultyQuery {
  search?: string;
  category?: string;
  limit?: number;
  cursor?: string | null;
}

/** Upper bound the backend accepts for one page (PROBLEM_LIST_CONFIG.MAX_LIMIT). */
const MAX_PAGE_LIMIT = 100;

/** Safety valve so a server that never stops paging cannot loop forever. */
const MAX_AUTO_PAGES = 100;

const problemService = {
  /**
   * One page of the problems list. All filters, sorting and pagination run
   * server-side; the returned cursor feeds the next call ("Show More").
   */
  getProblemsPage: async (query: ProblemListQuery = {}): Promise<ProblemsWithStatsPageResponse> => {
    const response = await api.get<ProblemsWithStatsPageResponse>('/problems-with-stats', {
      params: query,
    });
    return response.data;
  },

  /**
   * The full problems list, transparently stitched from server pages.
   * Kept for consumers that genuinely need everything at once (Home's
   * random/suggested pick, problem-detail stat lookup). Page size is the
   * backend maximum so this stays a handful of round trips.
   */
  getAllWithStats: async (difficultyQuery: ProblemListDifficultyQuery = {}): Promise<ProblemsWithStatsResponse> => {
    const all: ProblemsWithStatsResponse = [];
    let cursor: string | null = null;
    for (let fetched = 0; fetched < MAX_AUTO_PAGES; fetched += 1) {
      const page = await problemService.getProblemsPage({
        ...difficultyQuery,
        limit: MAX_PAGE_LIMIT,
        cursor,
      });
      all.push(...page.problems);
      if (!page.hasMore || page.nextCursor === null) return all;
      cursor = page.nextCursor;
    }
    return all;
  },

  /** Global category tab counts (visible standalone problems only). */
  getCategoryCounts: async (): Promise<ProblemCategoryCountsResponse> => {
    const response = await api.get<ProblemCategoryCountsResponse>('/problems/categories');
    return response.data;
  },

  getDetails: async (problemId: string): Promise<ProblemDetailResponse> => {
    const response = await api.get<ProblemDetailResponse>(`/problems/${problemId}`);
    return response.data;
  },

  getContestProblemDetails: async (
    contestId: string | number,
    problemId: string
  ): Promise<ContestProblemDetailResponse> => {
    const response = await api.get<ContestProblemDetailResponse>(
      `/contests/${contestId}/problems/${problemId}`
    );
    return response.data;
  },

  getPdfUrl: (problemId: string, contestId: string | number | null = null): string => {
    const baseUrl = api.defaults.baseURL ?? '';
    if (contestId !== null) {
      return `${baseUrl}/contests/${contestId}/problems/${problemId}/pdf`;
    }
    return `${baseUrl}/problems/${problemId}/pdf`;
  },
};

export default problemService;

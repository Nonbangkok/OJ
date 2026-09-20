import api from './api';

import type {
  ContestProblemDetailResponse,
  ProblemDetailResponse,
  ProblemsWithStatsResponse,
} from '../types';

/** Difficulty filtering/sorting for the problems list (server-side). */
export interface ProblemListDifficultyQuery {
  /** Inclusive lower bound; when set, Unrated problems are excluded. */
  difficultyMin?: number;
  /** Inclusive upper bound; when set, Unrated problems are excluded. */
  difficultyMax?: number;
  /** 'difficulty' sorts NULLS LAST in both directions. */
  sort?: 'difficulty';
  order?: 'asc' | 'desc';
}

const problemService = {
  getAllWithStats: async (difficultyQuery: ProblemListDifficultyQuery = {}): Promise<ProblemsWithStatsResponse> => {
    const response = await api.get<ProblemsWithStatsResponse>('/problems-with-stats', {
      params: difficultyQuery,
    });
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

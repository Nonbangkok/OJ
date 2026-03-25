import api from './api';

import type {
  ContestProblemDetailResponse,
  ProblemDetailResponse,
  ProblemsWithStatsResponse,
} from '../types';

const problemService = {
  getAllWithStats: async (): Promise<ProblemsWithStatsResponse> => {
    const response = await api.get<ProblemsWithStatsResponse>('/problems-with-stats');
    return response.data;
  },

  getDetails: async (problemId: string): Promise<ProblemDetailResponse> => {
    const response = await api.get<ProblemDetailResponse>(`/problems/${problemId}`);
    return response.data;
  },

  getContestProblemDetails: async (
    contestId: string | number,
    problemId: string,
  ): Promise<ContestProblemDetailResponse> => {
    const response = await api.get<ContestProblemDetailResponse>(
      `/contests/${contestId}/problems/${problemId}`,
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

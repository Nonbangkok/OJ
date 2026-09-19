import api from './api';

import type {
  ApiMessageResponse,
  ContestDetailResponse,
  ContestListResponse,
  ContestProblemsResponse,
  ContestScoreboardResponse,
} from '../types';

const contestService = {
  getAll: async (): Promise<ContestListResponse> => {
    const response = await api.get<ContestListResponse>('/contests');
    return response.data;
  },

  getById: async (contestId: string | number): Promise<ContestDetailResponse> => {
    const response = await api.get<ContestDetailResponse>(`/contests/${contestId}`);
    return response.data;
  },

  join: async (contestId: string | number): Promise<ApiMessageResponse> => {
    const response = await api.post<ApiMessageResponse>(`/contests/${contestId}/join`);
    return response.data;
  },

  getProblems: async (contestId: string | number): Promise<ContestProblemsResponse> => {
    const response = await api.get<ContestProblemsResponse>(`/contests/${contestId}/problems`);
    return response.data;
  },

  getScoreboard: async (contestId: string | number): Promise<ContestScoreboardResponse> => {
    const response = await api.get<ContestScoreboardResponse>(`/contests/${contestId}/scoreboard`);
    return response.data;
  },
};

export default contestService;

export interface ContestSimilarPair {
  problemId: string;
  userA: string;
  userB: string;
  similarity: number;
  submissionIdA: number;
  submissionIdB: number;
}

export interface ContestSimilarityResponse {
  contestId: number;
  pairs: ContestSimilarPair[];
}

/** Cheat detection: user pairs with near-identical contest submissions. */
export const fetchContestSimilarity = async (contestId: number): Promise<ContestSimilarityResponse> => {
  const response = await api.get<ContestSimilarityResponse>(`/admin/contests/${contestId}/similarity`);
  return response.data;
};

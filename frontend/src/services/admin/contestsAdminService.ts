import api from '../api';

import type {
  ContestListResponse,
  ContestMutationResponse,
  ContestProblemsMutationResponse,
  ContestProblemsResponse,
} from '../../types';
import type {
  CreateContestRequest,
  MigrateContestProblemsRequest,
  UpdateContestRequest,
} from '../../types';

const contestsAdminService = {
  getContests: async (): Promise<ContestListResponse> => {
    const response = await api.get<ContestListResponse>('/admin/contests');
    return response.data;
  },

  createContest: async (contestData: CreateContestRequest): Promise<ContestMutationResponse> => {
    const response = await api.post<ContestMutationResponse>('/admin/contests', contestData);
    return response.data;
  },

  updateContest: async (
    contestId: string | number,
    contestData: UpdateContestRequest,
  ): Promise<ContestMutationResponse> => {
    const response = await api.put<ContestMutationResponse>(`/admin/contests/${contestId}`, contestData);
    return response.data;
  },

  deleteContest: async (contestId: string | number): Promise<ContestMutationResponse> => {
    const response = await api.delete<ContestMutationResponse>(`/admin/contests/${contestId}`);
    return response.data;
  },

  getAvailableProblems: async (): Promise<ContestProblemsResponse> => {
    const response = await api.get<ContestProblemsResponse>('/admin/contests/available-problems');
    return response.data;
  },

  getContestProblemsAdmin: async (contestId: string | number): Promise<ContestProblemsResponse> => {
    const response = await api.get<ContestProblemsResponse>(`/admin/contests/${contestId}/admin-problems`);
    return response.data;
  },

  migrateContestProblems: async (
    contestId: string | number,
    payloadOrProblemIds: MigrateContestProblemsRequest | string[],
    action?: MigrateContestProblemsRequest['action'],
  ): Promise<ContestProblemsMutationResponse> => {
    const payload: MigrateContestProblemsRequest = Array.isArray(payloadOrProblemIds)
      ? { problemIds: payloadOrProblemIds, action: action ?? 'move_to_contest' }
      : payloadOrProblemIds;

    const response = await api.post<ContestProblemsMutationResponse>(`/admin/contests/${contestId}/problems`, payload);
    return response.data;
  },
};

export default contestsAdminService;

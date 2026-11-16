import api from '../api';

import type {
  ApiMessageResponse,
  ContestListResponse,
  ContestMutationResponse,
  ContestProblemsMutationResponse,
  ContestProblemsResponse,
  ContestVisibilityMutationResponse,
  RejudgeResponse,
} from '../../types';
import type {
  AdminContestParticipant,
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

  updateContestVisibility: async (
    contestId: string | number,
    isVisible: boolean,
  ): Promise<ContestVisibilityMutationResponse> => {
    const response = await api.put<ContestVisibilityMutationResponse>(
      `/admin/contests/${contestId}/visibility`,
      { isVisible },
    );
    return response.data;
  },

  rejudgeContest: async (contestId: string | number): Promise<RejudgeResponse> => {
    const response = await api.post<RejudgeResponse>(`/admin/rejudge/contest/${contestId}`);
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

  /** PUT /admin/contests/:id/problem-order — every contest problem id, once, in the new order. */
  reorderProblems: async (contestId: string | number, problemIds: string[]): Promise<void> => {
    await api.put(`/admin/contests/${contestId}/problem-order`, { problemIds });
  },

  /** Returns one problem from the contest to the practice set. */
  removeContestProblem: async (contestId: string | number, problemId: string): Promise<ApiMessageResponse> => {
    const response = await api.delete<ApiMessageResponse>(`/admin/contests/${contestId}/problems/${encodeURIComponent(problemId)}`);
    return response.data;
  },

  /** Staff Participants tab: who joined and when, earliest first. */
  getContestParticipants: async (contestId: string | number): Promise<AdminContestParticipant[]> => {
    const response = await api.get<AdminContestParticipant[]>(`/admin/contests/${contestId}/participants`);
    return response.data;
  },
};

export default contestsAdminService;

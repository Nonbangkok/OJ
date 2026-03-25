import api from './api';

import type {
  ProblemSearchResponse,
  SubmissionDetailResponse,
  SubmissionsResponse,
  SubmitResponse,
  UserSearchResponse,
} from '../types';
import type { SubmitRequest, SubmissionQueryParams } from '../types';

const submissionService = {
  submit: async (submitData: SubmitRequest): Promise<SubmitResponse> => {
    const response = await api.post<SubmitResponse>('/submit', submitData);
    return response.data;
  },

  getAll: async (params?: SubmissionQueryParams): Promise<SubmissionsResponse> => {
    const response = await api.get<SubmissionsResponse>('/submissions', { params });
    return response.data;
  },

  getById: async (
    submissionId: string | number,
    contestId: string | number | null = null,
  ): Promise<SubmissionDetailResponse> => {
    const params = contestId !== null ? { contestId } : {};
    const response = await api.get<SubmissionDetailResponse>(`/submissions/${submissionId}`, { params });
    return response.data;
  },

  searchProblems: async (
    query: string,
    contestId: string | number | null = null,
  ): Promise<ProblemSearchResponse> => {
    const params = new URLSearchParams({ q: query });
    if (contestId !== null) {
      params.set('contestId', String(contestId));
    }

    const response = await api.get<ProblemSearchResponse>(`/search/problems?${params.toString()}`);
    return response.data;
  },

  searchUsers: async (
    query: string,
    contestId: string | number | null = null,
  ): Promise<UserSearchResponse> => {
    const params = new URLSearchParams({ q: query });
    if (contestId !== null) {
      params.set('contestId', String(contestId));
    }

    const response = await api.get<UserSearchResponse>(`/search/users?${params.toString()}`);
    return response.data;
  },
};

export default submissionService;

import type { AxiosResponse } from 'axios';
import api, { getLargeUploadBaseUrl, largeUploadApi } from '../api';

import type {
  AdminProblemDetailResponse,
  AdminProblemsResponse,
  ApiMessageResponse,
  BatchUploadStartResponse,
  ProblemMutationResponse,
  RejudgeResponse,
  TestcaseListResponse,
  TestcaseViewResponse,
  UploadProgressResponse,
} from '../../types';
import type { CreateProblemRequest, UpdateProblemRequest } from '../../types';

interface UploadFilesResponse extends ApiMessageResponse {
  jobId?: string;
}


export interface CollectionWithStats {
  id: number;
  name: string;
  problem_count: number;
  status: 'empty' | 'all_visible' | 'all_hidden' | 'mixed';
  created_at: string;
  updated_at: string;
}

const problemsAdminService = {
  getProblems: async (): Promise<AdminProblemsResponse> => {
    const response = await api.get<AdminProblemsResponse>('/admin/problems');
    return response.data;
  },

  createProblem: async (problemData: CreateProblemRequest): Promise<ProblemMutationResponse> => {
    const response = await api.post<ProblemMutationResponse>('/admin/problems', problemData);
    return response.data;
  },

  updateProblem: async (
    problemId: string,
    problemData: UpdateProblemRequest,
  ): Promise<ProblemMutationResponse> => {
    const response = await api.put<ProblemMutationResponse>(`/admin/problems/${problemId}`, problemData);
    return response.data;
  },

  deleteProblem: async (problemId: string): Promise<ApiMessageResponse> => {
    const response = await api.delete<ApiMessageResponse>(`/admin/problems/${problemId}`);
    return response.data;
  },

  rejudgeProblem: async (problemId: string | number): Promise<RejudgeResponse> => {
    const response = await api.post<RejudgeResponse>(`/admin/rejudge/problem/${problemId}`);
    return response.data;
  },

  getProblemDetail: async (problemId: string): Promise<AdminProblemDetailResponse> => {
    const response = await api.get<AdminProblemDetailResponse>(`/admin/problems/${problemId}`);
    return response.data;
  },

  // Testcase viewer — staff-only content. The default call lists metadata
  // (case numbers + sizes) only; a caseNumber fetches one full case,
  // API-truncated past 1 MiB per side.
  getProblemTestcases: async (problemId: string): Promise<TestcaseListResponse> => {
    const response = await api.get<TestcaseListResponse>(`/admin/problems/${problemId}/testcases`);
    return response.data;
  },

  getProblemTestcase: async (problemId: string, caseNumber: number): Promise<TestcaseViewResponse> => {
    const response = await api.get<TestcaseViewResponse>(`/admin/problems/${problemId}/testcases`, {
      params: { caseNumber },
    });
    return response.data;
  },

  updateProblemVisibility: async (problemId: string | number, isVisible: boolean): Promise<ApiMessageResponse> => {
    const response = await api.put<ApiMessageResponse>(`/admin/problems/${problemId}/visibility`, { isVisible });
    return response.data;
  },

  exportProblems: async (problemIds: Array<string | number>): Promise<AxiosResponse<Blob>> => {
    return api.post<Blob>('/admin/problems/export', { problemIds }, { responseType: 'blob' });
  },

  batchUploadProblems: async (formData: FormData): Promise<BatchUploadStartResponse> => {
    const response = await largeUploadApi.post<BatchUploadStartResponse>('/admin/problems/batch-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  uploadFiles: async (problemId: string, formData: FormData): Promise<UploadFilesResponse> => {
    const response = await api.post<UploadFilesResponse>(`/admin/problems/${problemId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  getUploadProgress: async (jobId: string): Promise<UploadProgressResponse> => {
    const response = await api.get<UploadProgressResponse>(`/admin/upload-progress/${jobId}`);
    return response.data;
  },

  getBatchUploadProgressEventSource: (progressId: string): EventSource => {
    const baseUrl = getLargeUploadBaseUrl();
    return new EventSource(`${baseUrl}/admin/problems/batch-upload-progress/${progressId}`, {
      withCredentials: true,
    });
  },

  // Problem Collections (organizational groups)
  getCollections: async (): Promise<CollectionWithStats[]> => {
    const response = await api.get<CollectionWithStats[]>('/admin/collections');
    return response.data;
  },

  createCollection: async (name: string): Promise<CollectionWithStats> => {
    const response = await api.post<CollectionWithStats>('/admin/collections', { name });
    return response.data;
  },

  updateCollection: async (id: number, name: string): Promise<CollectionWithStats> => {
    const response = await api.put<CollectionWithStats>(`/admin/collections/${id}`, { name });
    return response.data;
  },

  deleteCollection: async (id: number): Promise<void> => {
    await api.delete(`/admin/collections/${id}`);
  },

  setCollectionVisibility: async (id: number, isVisible: boolean): Promise<{ message: string; updated: number }> => {
    const response = await api.put<{ message: string; updated: number }>(`/admin/collections/${id}/visibility`, { isVisible });
    return response.data;
  },
};

export default problemsAdminService;


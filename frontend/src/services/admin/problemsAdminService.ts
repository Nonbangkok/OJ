import type { AxiosResponse } from 'axios';
import api, { getLargeUploadBaseUrl, largeUploadApi } from '../api';

import type {
  AdminProblemDetailResponse,
  AdminProblemsResponse,
  ApiMessageResponse,
  BatchUploadStartResponse,
  ProblemMutationResponse,
  UploadProgressResponse,
} from '../../types';
import type { CreateProblemRequest, UpdateProblemRequest } from '../../types';

interface UploadFilesResponse extends ApiMessageResponse {
  jobId?: string;
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

  getProblemDetail: async (problemId: string): Promise<AdminProblemDetailResponse> => {
    const response = await api.get<AdminProblemDetailResponse>(`/admin/problems/${problemId}`);
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
};

export default problemsAdminService;

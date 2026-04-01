import type { AxiosResponse } from 'axios';

import api, { largeUploadApi } from '../api';

import type {
  ApiMessageResponse,
  JobStartResponse,
  RegistrationSettingsResponse,
  RegistrationSettingsUpdateResponse,
  UploadProgressResponse,
} from '../../types';

const settingsAdminService = {
  getRegistrationSettings: async (): Promise<RegistrationSettingsResponse> => {
    const response = await api.get<RegistrationSettingsResponse>('/admin/settings/registration');
    return response.data;
  },

  updateRegistrationSettings: async (enabled: boolean): Promise<RegistrationSettingsUpdateResponse> => {
    const response = await api.put<RegistrationSettingsUpdateResponse>('/admin/settings/registration', { enabled });
    return response.data;
  },

  exportDatabase: async (): Promise<AxiosResponse<Blob>> => {
    return api.post<Blob>('/admin/database/export', {}, { responseType: 'blob' });
  },

  importDatabase: async (formData: FormData): Promise<JobStartResponse> => {
    const response = await largeUploadApi.post<JobStartResponse>('/admin/database/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  getImportDatabaseProgress: async (jobId: string): Promise<UploadProgressResponse> => {
    const response = await api.get<UploadProgressResponse>(`/admin/database/import-progress/${jobId}`);
    return response.data;
  },
};

export default settingsAdminService;

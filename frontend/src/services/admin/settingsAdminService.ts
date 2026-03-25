import type { AxiosResponse } from 'axios';

import api from '../api';

import type {
  ApiMessageResponse,
  RegistrationSettingsResponse,
  RegistrationSettingsUpdateResponse,
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

  importDatabase: async (formData: FormData): Promise<ApiMessageResponse> => {
    const response = await api.post<ApiMessageResponse>('/admin/database/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};

export default settingsAdminService;

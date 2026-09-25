import api from './api';

import type {
  ApiMessageResponse,
  LoginResponse,
  MeResponse,
  RegisterResponse,
  RegistrationSettingsResponse,
  SiteConfigResponse,
} from '../types';
import type { ChangePasswordRequest, LoginRequest, RegisterRequest } from '../types';

const authService = {
  checkLogin: async (): Promise<MeResponse> => {
    const response = await api.get<MeResponse>('/me');
    return response.data;
  },

  login: async (
    username: LoginRequest['username'],
    password: LoginRequest['password']
  ): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/login', { username, password });
    return response.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/logout');
  },

  register: async (
    username: RegisterRequest['username'],
    password: RegisterRequest['password']
  ): Promise<RegisterResponse> => {
    const response = await api.post<RegisterResponse>('/register', { username, password });
    return response.data;
  },

  /**
   * AUTH-004: change the signed-in user's own password. On success every
   * other session of the user is signed out server-side (this session is
   * kept). A wrong current password rejects with 401.
   */
  changePassword: async (data: ChangePasswordRequest): Promise<ApiMessageResponse> => {
    const response = await api.put<ApiMessageResponse>('/profile/password', data);
    return response.data;
  },

  getRegistrationSettings: async (): Promise<RegistrationSettingsResponse> => {
    const response = await api.get<RegistrationSettingsResponse>('/settings/registration');
    return response.data;
  },

  getSiteConfig: async (): Promise<SiteConfigResponse> => {
    const response = await api.get<SiteConfigResponse>('/site-config');
    return response.data;
  },
};

export default authService;

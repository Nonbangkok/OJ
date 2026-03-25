import api from './api';

import type {
  LoginResponse,
  MeResponse,
  RegisterResponse,
  RegistrationSettingsResponse,
} from '../types';
import type { LoginRequest, RegisterRequest } from '../types';

const authService = {
  checkLogin: async (): Promise<MeResponse> => {
    const response = await api.get<MeResponse>('/me');
    return response.data;
  },

  login: async (username: LoginRequest['username'], password: LoginRequest['password']): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/login', { username, password });
    return response.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/logout');
  },

  register: async (
    username: RegisterRequest['username'],
    password: RegisterRequest['password'],
  ): Promise<RegisterResponse> => {
    const response = await api.post<RegisterResponse>('/register', { username, password });
    return response.data;
  },

  getRegistrationSettings: async (): Promise<RegistrationSettingsResponse> => {
    const response = await api.get<RegistrationSettingsResponse>('/settings/registration');
    return response.data;
  },
};

export default authService;

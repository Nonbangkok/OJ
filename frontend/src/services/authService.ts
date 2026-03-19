import api from './api';
import type { AuthResponse } from '../types';

/**
 * Service for handling authentication and user sessions.
 */
interface AuthService {
  checkLogin(): Promise<AuthResponse>;
  login(username: string, password: string): Promise<AuthResponse>;
  logout(): Promise<void>;
  register(username: string, password: string): Promise<AuthResponse>;
  getRegistrationSettings(): Promise<{ enabled: boolean }>;
}

const authService: AuthService = {
  /**
   * Checks the current session login status.
   * @returns {Promise<AuthResponse>} User data and authentication status
   */
  checkLogin: async (): Promise<AuthResponse> => {
    const response = await api.get('/me');
    return response.data;
  },

  /**
   * Logs in a user.
   * @param {string} username 
   * @param {string} password 
   * @returns {Promise<AuthResponse>} Logged in user data
   */
  login: async (username: string, password: string): Promise<AuthResponse> => {
    const response = await api.post('/login', { username, password });
    return response.data;
  },

  /**
   * Logs out the current user by destroying the session.
   * @returns {Promise<void>}
   */
  logout: async (): Promise<void> => {
    await api.post('/logout');
  },

  /**
   * Registers a new user account.
   * @param {string} username 
   * @param {string} password 
   * @returns {Promise<AuthResponse>} New user data
   */
  register: async (username: string, password: string): Promise<AuthResponse> => {
    const response = await api.post('/register', { username, password });
    return response.data;
  },

  /**
   * Fetches current registration settings (e.g., if registration is enabled).
   * @returns {Promise<{ enabled: boolean }>} Registration settings
   */
  getRegistrationSettings: async (): Promise<{ enabled: boolean }> => {
    const response = await api.get('/settings/registration');
    return response.data;
  },
};

export default authService;
import api from './api';

/**
 * Service for handling authentication and user sessions.
 */
const authService = {
  /**
   * Checks the current session login status.
   * @returns {Promise<Object>} User data and authentication status
   */
  checkLogin: async () => {
    const response = await api.get('/me');
    return response.data;
  },

  /**
   * Logs in a user.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Object>} Logged in user data
   */
  login: async (username, password) => {
    const response = await api.post('/login', { username, password });
    return response.data;
  },

  /**
   * Logs out the current user by destroying the session.
   * @returns {Promise<void>}
   */
  logout: async () => {
    await api.post('/logout');
  },

  /**
   * Registers a new user account.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Object>} New user data
   */
  register: async (username, password) => {
    const response = await api.post('/register', { username, password });
    return response.data;
  },

  /**
   * Fetches current registration settings (e.g., if registration is enabled).
   * @returns {Promise<Object>} Registration settings
   */
  getRegistrationSettings: async () => {
    const response = await api.get('/settings/registration');
    return response.data;
  },
};

export default authService;

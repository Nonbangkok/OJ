import api from './api';

/**
 * Service for handling user-facing contest operations.
 */
const contestService = {
  /**
   * Fetches all visible contests.
   * @returns {Promise<Array>} Array of contests
   */
  getAll: async () => {
    const response = await api.get('/contests');
    return response.data;
  },

  /**
   * Fetches details for a specific contest.
   * @param {string|number} contestId 
   * @returns {Promise<Object>} Contest details
   */
  getById: async (contestId) => {
    const response = await api.get(`/contests/${contestId}`);
    return response.data;
  },

  /**
   * Allows the current user to join a contest.
   * @param {string|number} contestId 
   * @returns {Promise<Object>} Success message
   */
  join: async (contestId) => {
    const response = await api.post(`/contests/${contestId}/join`);
    return response.data;
  },

  /**
   * Fetches problems available within a specific contest.
   * @param {string|number} contestId 
   * @returns {Promise<Array>} Array of contest problems
   */
  getProblems: async (contestId) => {
    const response = await api.get(`/contests/${contestId}/problems`);
    return response.data;
  },

  /**
   * Fetches the scoreboard for a specific contest.
   * @param {string|number} contestId 
   * @returns {Promise<Array>} Contest scoreboard data
   */
  getScoreboard: async (contestId) => {
    const response = await api.get(`/contests/${contestId}/scoreboard`);
    return response.data;
  }
};

export default contestService;
import api from './api';

/**
 * Service for handling problem retrieval operations.
 */
const problemService = {
  /**
   * Fetches all visible problems with their success statistics.
   * @returns {Promise<Array>} Array of problems with stats
   */
  getAllWithStats: async () => {
    const response = await api.get('/problems-with-stats');
    return response.data;
  },

  /**
   * Fetches details for a specific global problem.
   * @param {string} problemId 
   * @returns {Promise<Object>} Problem details
   */
  getDetails: async (problemId) => {
    const response = await api.get(`/problems/${problemId}`);
    return response.data;
  },

  /**
   * Fetches details for a specific problem within a contest context.
   * @param {string|number} contestId 
   * @param {string} problemId 
   * @returns {Promise<Object>} Contest problem details
   */
  getContestProblemDetails: async (contestId, problemId) => {
    const response = await api.get(`/contests/${contestId}/problems/${problemId}`);
    return response.data;
  },

  /**
   * Generates the API URL for retrieving a problem's PDF file.
   * @param {string} problemId 
   * @param {string|number|null} [contestId=null] - Optional contest context 
   * @returns {string} Full URL to the PDF endpoint
   */
  getPdfUrl: (problemId, contestId = null) => {
    const baseUrl = api.defaults.baseURL || '';
    if (contestId) {
      return `${baseUrl}/contests/${contestId}/problems/${problemId}/pdf`;
    }
    return `${baseUrl}/problems/${problemId}/pdf`;
  }
};

export default problemService;
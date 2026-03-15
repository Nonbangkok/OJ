import api from './api';

/**
 * Service for handling code submissions and searching relative to submissions.
 */
const submissionService = {
  /**
   * Submits code for a problem.
   * @param {Object} submitData
   * @returns {Promise<Object>} Submission result
   */
  submit: async (submitData) => {
    const response = await api.post('/submit', submitData);
    return response.data;
  },

  /**
   * Fetches all submissions, optionally filtered by params.
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} Array of submissions
   */
  getAll: async (params) => {
    const response = await api.get('/submissions', { params });
    return response.data;
  },

  /**
   * Fetches detailed information for a specific submission.
   * @param {string|number} submissionId 
   * @param {string|number|null} [contestId=null] 
   * @returns {Promise<Object>} Detailed submission data including code and test case results
   */
  getById: async (submissionId, contestId = null) => {
    const params = contestId ? { contestId } : {};
    const response = await api.get(`/submissions/${submissionId}`, { params });
    return response.data;
  },

  /**
   * Searches for problems by ID or title (used for autocomplete filters).
   * @param {string} query 
   * @param {string|number|null} [contestId=null] 
   * @returns {Promise<Array>} Problem suggestions
   */
  searchProblems: async (query, contestId = null) => {
    let url = `/search/problems?q=${query}`;
    if (contestId) url += `&contestId=${contestId}`;
    const response = await api.get(url);
    return response.data;
  },

  /**
   * Searches for users by username (used for autocomplete filters).
   * @param {string} query 
   * @param {string|number|null} [contestId=null] 
   * @returns {Promise<Array>} User suggestions
   */
  searchUsers: async (query, contestId = null) => {
    let url = `/search/users?q=${query}`;
    if (contestId) url += `&contestId=${contestId}`;
    const response = await api.get(url);
    return response.data;
  }
};

export default submissionService;
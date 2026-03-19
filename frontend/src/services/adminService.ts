import api from './api';

/**
 * Service for administrative operations such as managing users, problems, and contests.
 */
const adminService = {
  // User Management
  /**
   * Fetches all registered users.
   * @returns {Promise<Array>} Array of user objects
   */
  getUsers: async () => {
    const response = await api.get('/admin/users');
    return response.data;
  },
  /**
   * Creates a new user account.
   * @param {Object} userData
   * @returns {Promise<Object>} Created user data
   */
  createUser: async (userData) => {
    const response = await api.post('/admin/users', userData);
    return response.data;
  },
  /**
   * Updates an existing user's information.
   * @param {string|number} userId
   * @param {Object} userData
   * @returns {Promise<Object>} Updated user data
   */
  updateUser: async (userId, userData) => {
    const response = await api.put(`/admin/users/${userId}`, userData);
    return response.data;
  },
  /**
   * Fetches users eligible to be problem authors.
   * @returns {Promise<Array>} Array of author data
   */
  getAuthors: async () => {
    const response = await api.get('/admin/authors');
    return response.data;
  },
  /**
   * Deletes a user by ID.
   * @param {string|number} userId
   * @returns {Promise<Object>} Success message
   */
  deleteUser: async (userId) => {
    const response = await api.delete(`/admin/users/${userId}`);
    return response.data;
  },
  /**
   * Creates multiple users simultaneously from batch data.
   * @param {Object} batchData
   * @returns {Promise<Object>} Batch creation results
   */
  createBatchUsers: async (batchData) => {
    const response = await api.post('/admin/users/batch', batchData);
    return response.data;
  },

  // Problem Management
  /**
   * Fetches all problems (including hidden ones).
   * @returns {Promise<Array>} Array of problem objects
   */
  getProblems: async () => {
    const response = await api.get('/admin/problems');
    return response.data;
  },
  /**
   * Creates a new problem.
   * @param {Object} problemData
   * @returns {Promise<Object>} Created problem data
   */
  createProblem: async (problemData) => {
    const response = await api.post('/admin/problems', problemData);
    return response.data;
  },
  /**
   * Updates an existing problem.
   * @param {string} problemId
   * @param {Object} problemData
   * @returns {Promise<Object>} Updated problem data
   */
  updateProblem: async (problemId, problemData) => {
    const response = await api.put(`/admin/problems/${problemId}`, problemData);
    return response.data;
  },
  /**
   * Deletes a problem.
   * @param {string} problemId
   * @returns {Promise<Object>} Success message
   */
  deleteProblem: async (problemId) => {
    const response = await api.delete(`/admin/problems/${problemId}`);
    return response.data;
  },
  /**
   * Fetches detailed information for a specific problem.
   * @param {string} problemId
   * @returns {Promise<Object>} Detailed problem data
   */
  getProblemDetail: async (problemId) => {
    const response = await api.get(`/admin/problems/${problemId}`);
    return response.data;
  },
  /**
   * Updates the visibility status of a problem.
   * @param {string} problemId
   * @param {boolean} isVisible
   * @returns {Promise<Object>} Success message
   */
  updateProblemVisibility: async (problemId, isVisible) => {
    const response = await api.put(`/admin/problems/${problemId}/visibility`, { isVisible });
    return response.data;
  },
  /**
   * Exports selected problems as a zip archive.
   * @param {Array<string>} problemIds
   * @returns {Promise<Object>} Blob response containing the zip file
   */
  exportProblems: async (problemIds) => {
    const response = await api.post(
      '/admin/problems/export',
      { problemIds },
      { responseType: 'blob' }
    );
    return response;
  },
  /**
   * Uploads a batch of problems from a zip file.
   * @param {FormData} formData - Must contain the zip file
   * @returns {Promise<Object>} Validation or upload response
   */
  batchUploadProblems: async (formData) => {
    const response = await api.post('/admin/problems/batch-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  },
  /**
   * Uploads test case or PDF files for a specific problem.
   * @param {string} problemId
   * @param {FormData} formData
   * @returns {Promise<Object>} Success message
   */
  uploadFiles: async (problemId, formData) => {
    const response = await api.post(`/admin/problems/${problemId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  // Contest Management
  /**
   * Fetches all contests for administration.
   * @returns {Promise<Array>} Array of contests
   */
  getContests: async () => {
    const response = await api.get('/admin/contests');
    return response.data;
  },
  /**
   * Creates a new contest.
   * @param {Object} contestData
   * @returns {Promise<Object>} Created contest data
   */
  createContest: async (contestData) => {
    const response = await api.post('/admin/contests', contestData);
    return response.data;
  },
  /**
   * Updates an existing contest.
   * @param {string|number} contestId
   * @param {Object} contestData
   * @returns {Promise<Object>} Updated contest data
   */
  updateContest: async (contestId, contestData) => {
    const response = await api.put(`/admin/contests/${contestId}`, contestData);
    return response.data;
  },
  /**
   * Deletes a contest.
   * @param {string|number} contestId
   * @returns {Promise<Object>} Success message
   */
  deleteContest: async (contestId) => {
    const response = await api.delete(`/admin/contests/${contestId}`);
    return response.data;
  },
  /**
   * Fetches all problems available to be added to a contest.
   * @returns {Promise<Array>} Array of available problems
   */
  getAvailableProblems: async () => {
    const response = await api.get('/admin/contests/available-problems');
    return response.data;
  },
  /**
   * Fetches problems currently assigned to a specific contest.
   * @param {string|number} contestId
   * @returns {Promise<Array>} Array of contest problems
   */
  getContestProblemsAdmin: async (contestId) => {
    const response = await api.get(`/admin/contests/${contestId}/admin-problems`);
    return response.data;
  },
  /**
   * Adds or removes problems from a contest.
   * @param {string|number} contestId
   * @param {Array<string>} problemIds
   * @param {string} action - 'add' or 'remove'
   * @returns {Promise<Object>} Success message
   */
  migrateContestProblems: async (contestId, problemIds, action) => {
    const response = await api.post(`/admin/contests/${contestId}/problems`, {
      problemIds,
      action,
    });
    return response.data;
  },

  // Settings & Database
  /**
   * Fetches system registration settings.
   * @returns {Promise<Object>} Registration settings configuration
   */
  getRegistrationSettings: async () => {
    const response = await api.get('/admin/settings/registration');
    return response.data;
  },
  /**
   * Enables or disables system-wide user registration.
   * @param {boolean} enabled
   * @returns {Promise<Object>} Updated configuration
   */
  updateRegistrationSettings: async (enabled) => {
    const response = await api.put('/admin/settings/registration', { enabled });
    return response.data;
  },
  /**
   * Triggers a full database export backup.
   * @returns {Promise<Object>} Blob response containing the SQL dump
   */
  exportDatabase: async () => {
    const response = await api.post('/admin/database/export', {}, { responseType: 'blob' });
    return response;
  },
  /**
   * Imports a SQL dump into the database.
   * @param {FormData} formData - Must contain the SQL dump file
   * @returns {Promise<Object>} Standard success response
   */
  importDatabase: async (formData) => {
    const response = await api.post('/admin/database/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
  /**
   * Fetches the current progress of an asynchronous upload job.
   * @param {string} jobId
   * @returns {Promise<Object>} Job state data
   */
  getUploadProgress: async (jobId) => {
    const response = await api.get(`/admin/upload-progress/${jobId}`);
    return response.data;
  },
  /**
   * Initiates a Server-Sent Events (SSE) stream for real-time progress.
   * @param {string} progressId
   * @returns {EventSource} Connection to the SSE endpoint
   */
  getBatchUploadProgressEventSource: (progressId) => {
    const baseUrl = api.defaults.baseURL || '';
    return new EventSource(`${baseUrl}/admin/problems/batch-upload-progress/${progressId}`, {
      withCredentials: true,
    });
  },
};

export default adminService;

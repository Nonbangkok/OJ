import api from './api';

const API_URL = process.env.REACT_APP_API_URL;

const problemService = {
  getAllWithStats: async () => {
    const response = await api.get('/problems-with-stats');
    return response.data;
  },

  getDetails: async (problemId) => {
    const response = await api.get(`/problems/${problemId}`);
    return response.data;
  },

  getContestProblemDetails: async (contestId, problemId) => {
    const response = await api.get(`/contests/${contestId}/problems/${problemId}`);
    return response.data;
  },

  getPdfUrl: (problemId, contestId = null) => {
    if (contestId) {
      return `${API_URL}/contests/${contestId}/problems/${problemId}/pdf`;
    }
    return `${API_URL}/problems/${problemId}/pdf`;
  }
};

export default problemService;
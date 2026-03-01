import api from './api';

const contestService = {
  getAll: async () => {
    const response = await api.get('/contests');
    return response.data;
  },

  getById: async (contestId) => {
    const response = await api.get(`/contests/${contestId}`);
    return response.data;
  },

  join: async (contestId) => {
    const response = await api.post(`/contests/${contestId}/join`);
    return response.data;
  },

  getProblems: async (contestId) => {
    const response = await api.get(`/contests/${contestId}/problems`);
    return response.data;
  },

  getScoreboard: async (contestId) => {
    const response = await api.get(`/contests/${contestId}/scoreboard`);
    return response.data;
  }
};

export default contestService;
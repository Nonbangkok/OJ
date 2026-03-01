import api from './api';

const submissionService = {
  submit: async (submitData) => {
    const response = await api.post('/submit', submitData);
    return response.data;
  },

  getAll: async (params) => {
    const response = await api.get('/submissions', { params });
    return response.data;
  },

  getById: async (submissionId, contestId = null) => {
    const params = contestId ? { contestId } : {};
    const response = await api.get(`/submissions/${submissionId}`, { params });
    return response.data;
  },

  searchProblems: async (query) => {
    const response = await api.get(`/search/problems?q=${query}`);
    return response.data;
  },

  searchUsers: async (query) => {
    const response = await api.get(`/search/users?q=${query}`);
    return response.data;
  }
};

export default submissionService;
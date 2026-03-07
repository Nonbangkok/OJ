import api from './api';

const adminService = {
    // User Management
    getUsers: async () => {
        const response = await api.get('/admin/users');
        return response.data;
    },
    createUser: async (userData) => {
        const response = await api.post('/admin/users', userData);
        return response.data;
    },
    updateUser: async (userId, userData) => {
        const response = await api.put(`/admin/users/${userId}`, userData);
        return response.data;
    },
    getAuthors: async () => {
        const response = await api.get('/admin/authors');
        return response.data;
    },
    deleteUser: async (userId) => {
        const response = await api.delete(`/admin/users/${userId}`);
        return response.data;
    },

    // Problem Management
    getProblems: async () => {
        const response = await api.get('/admin/problems');
        return response.data;
    },
    createProblem: async (problemData) => {
        const response = await api.post('/admin/problems', problemData);
        return response.data;
    },
    updateProblem: async (problemId, problemData) => {
        const response = await api.put(`/admin/problems/${problemId}`, problemData);
        return response.data;
    },
    deleteProblem: async (problemId) => {
        const response = await api.delete(`/admin/problems/${problemId}`);
        return response.data;
    },
    getProblemDetail: async (problemId) => {
        const response = await api.get(`/admin/problems/${problemId}`);
        return response.data;
    },
    updateProblemVisibility: async (problemId, isVisible) => {
        const response = await api.put(`/admin/problems/${problemId}/visibility`, { isVisible });
        return response.data;
    },
    exportProblems: async (problemIds) => {
        const response = await api.post('/admin/problems/export', { problemIds }, { responseType: 'blob' });
        return response;
    },
    batchUploadProblems: async (formData) => {
        const response = await api.post('/admin/problems/batch-upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response;
    },
    uploadFiles: async (problemId, formData) => {
        const response = await api.post(`/admin/problems/${problemId}/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },

    // Contest Management
    getContests: async () => {
        const response = await api.get('/admin/contests');
        return response.data;
    },
    createContest: async (contestData) => {
        const response = await api.post('/admin/contests', contestData);
        return response.data;
    },
    updateContest: async (contestId, contestData) => {
        const response = await api.put(`/admin/contests/${contestId}`, contestData);
        return response.data;
    },
    deleteContest: async (contestId) => {
        const response = await api.delete(`/admin/contests/${contestId}`);
        return response.data;
    },
    getAvailableProblems: async () => {
        const response = await api.get('/admin/contests/available-problems');
        return response.data;
    },
    getContestProblemsAdmin: async (contestId) => {
        const response = await api.get(`/admin/contests/${contestId}/admin-problems`);
        return response.data;
    },
    migrateContestProblems: async (contestId, problemIds, action) => {
        const response = await api.post(`/admin/contests/${contestId}/problems`, {
            problemIds,
            action
        });
        return response.data;
    },

    // Settings & Database
    getRegistrationSettings: async () => {
        const response = await api.get('/admin/settings/registration');
        return response.data;
    },
    updateRegistrationSettings: async (enabled) => {
        const response = await api.put('/admin/settings/registration', { enabled });
        return response.data;
    },
    exportDatabase: async () => {
        const response = await api.post('/admin/database/export', {}, { responseType: 'blob' });
        return response;
    },
    importDatabase: async (formData) => {
        const response = await api.post('/admin/database/import', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },
    getUploadProgress: async (jobId) => {
        const response = await api.get(`/admin/upload-progress/${jobId}`);
        return response.data;
    },
    getBatchUploadProgressEventSource: (progressId) => {
        const baseUrl = api.defaults.baseURL || '';
        return new EventSource(`${baseUrl}/admin/problems/batch-upload-progress/${progressId}`, { withCredentials: true });
    }
};

export default adminService;

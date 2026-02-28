import api from './api';

const authService = {
  checkLogin: async () => {
    const response = await api.get('/me');
    return response.data;
  },
  
  login: async (username, password) => {
    const response = await api.post('/login', { username, password });
    return response.data;
  },
  
  logout: async () => {
    await api.post('/logout');
  },
};

export default authService;
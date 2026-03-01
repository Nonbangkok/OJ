import api from './api';

const scoreboardService = {
    getGlobal: async () => {
        const response = await api.get('/scoreboard');
        return response.data;
    },
};

export default scoreboardService;

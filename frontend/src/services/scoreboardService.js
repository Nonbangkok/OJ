import api from './api';

/**
 * Service for handling global scoreboard data retrieval.
 */
const scoreboardService = {
    /**
     * Fetches the global scoreboard rankings.
     * @returns {Promise<Array>} Global scoreboard data
     */
    getGlobal: async () => {
        const response = await api.get('/scoreboard');
        return response.data;
    },
};

export default scoreboardService;

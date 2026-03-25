import api from './api';

import type { GlobalScoreboardResponse } from '../types';

const scoreboardService = {
  getGlobal: async (): Promise<GlobalScoreboardResponse> => {
    const response = await api.get<GlobalScoreboardResponse>('/scoreboard');
    return response.data;
  },
};

export default scoreboardService;

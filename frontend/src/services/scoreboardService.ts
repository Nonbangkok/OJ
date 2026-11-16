import api from './api';

import type { GlobalRanking, RankingWindow } from '../types';

const scoreboardService = {
  /** One page of the global XP ranking (competition rank) for a window. */
  getRanking: async (window: RankingWindow, page: number): Promise<GlobalRanking> => {
    const response = await api.get<GlobalRanking>('/scoreboard', { params: { window, page } });
    return response.data;
  },
};

export default scoreboardService;

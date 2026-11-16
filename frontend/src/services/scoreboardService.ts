import api from './api';

import type { GlobalRanking, GlobalScoreboardResponse, RankingWindow } from '../types';

const scoreboardService = {
  /** One page of the global XP ranking (competition rank) for a window. */
  getRanking: async (window: RankingWindow, page: number): Promise<GlobalRanking> => {
    const response = await api.get<GlobalRanking>('/scoreboard', { params: { window, page } });
    return response.data;
  },

  /**
   * Legacy shape for the pre-redesign Ranking page: the first all-time page
   * mapped onto the old entries. Removed when the Ranking page moves to
   * getRanking (phase 3, Task 11).
   */
  getGlobal: async (): Promise<GlobalScoreboardResponse> => {
    const ranking = await scoreboardService.getRanking('all', 1);
    return ranking.rows.map((row) => ({
      username: row.username,
      has_avatar: row.hasAvatar,
      total_score: row.xp,
      problems_solved: row.solved,
    }));
  },
};

export default scoreboardService;

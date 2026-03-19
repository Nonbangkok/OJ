import api from './api';
import type { ScoreboardEntry } from '../types';

/**
 * Service for handling global scoreboard data retrieval.
 */
interface ScoreboardService {
  getGlobal(): Promise<ScoreboardEntry[]>;
}

const scoreboardService: ScoreboardService = {
  /**
   * Fetches the global scoreboard rankings.
   * @returns {Promise<ScoreboardEntry[]>} Global scoreboard data
   */
  getGlobal: async (): Promise<ScoreboardEntry[]> => {
    const response = await api.get('/scoreboard');
    return response.data;
  },
};

export default scoreboardService;

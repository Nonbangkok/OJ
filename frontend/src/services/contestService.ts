import api from './api';
import type { Contest, ContestProblem, ScoreboardEntry } from '../types';

/**
 * Service for handling user-facing contest operations.
 */
interface ContestService {
  getAll(): Promise<Contest[]>;
  getById(contestId: string | number): Promise<Contest>;
  join(contestId: string | number): Promise<{ message: string }>;
  getProblems(contestId: string | number): Promise<ContestProblem[]>;
  getScoreboard(contestId: string | number): Promise<ScoreboardEntry[]>;
}

const contestService: ContestService = {
  /**
   * Fetches all visible contests.
   * @returns {Promise<Contest[]>} Array of contests
   */
  getAll: async (): Promise<Contest[]> => {
    const response = await api.get('/contests');
    return response.data;
  },

  /**
   * Fetches details for a specific contest.
   * @param {string | number} contestId 
   * @returns {Promise<Contest>} Contest details
   */
  getById: async (contestId: string | number): Promise<Contest> => {
    const response = await api.get(`/contests/${contestId}`);
    return response.data;
  },

  /**
   * Allows the current user to join a contest.
   * @param {string | number} contestId 
   * @returns {Promise<{ message: string }>} Success message
   */
  join: async (contestId: string | number): Promise<{ message: string }> => {
    const response = await api.post(`/contests/${contestId}/join`);
    return response.data;
  },

  /**
   * Fetches problems available within a specific contest.
   * @param {string | number} contestId 
   * @returns {Promise<ContestProblem[]>} Array of contest problems
   */
  getProblems: async (contestId: string | number): Promise<ContestProblem[]> => {
    const response = await api.get(`/contests/${contestId}/problems`);
    return response.data;
  },

  /**
   * Fetches the scoreboard for a specific contest.
   * @param {string | number} contestId 
   * @returns {Promise<ScoreboardEntry[]>} Contest scoreboard data
   */
  getScoreboard: async (contestId: string | number): Promise<ScoreboardEntry[]> => {
    const response = await api.get(`/contests/${contestId}/scoreboard`);
    return response.data;
  }
};

export default contestService;
import api from './api';
import type { Problem, ProblemWithStats } from '../types';

/**
 * Service for handling problem retrieval operations.
 */
interface ProblemService {
  getAllWithStats(): Promise<ProblemWithStats[]>;
  getDetails(problemId: string | number): Promise<Problem>;
  getContestProblemDetails(contestId: string | number, problemId: string | number): Promise<Problem>;
  getPdfUrl(problemId: string | number, contestId?: string | number | null): string;
}

const problemService: ProblemService = {
  /**
   * Fetches all visible problems with their success statistics.
   * @returns {Promise<ProblemWithStats[]>} Array of problems with stats
   */
  getAllWithStats: async (): Promise<ProblemWithStats[]> => {
    const response = await api.get('/problems-with-stats');
    return response.data;
  },

  /**
   * Fetches details for a specific global problem.
   * @param {string | number} problemId 
   * @returns {Promise<Problem>} Problem details
   */
  getDetails: async (problemId: string | number): Promise<Problem> => {
    const response = await api.get(`/problems/${problemId}`);
    return response.data;
  },

  /**
   * Fetches details for a specific problem within a contest context.
   * @param {string | number} contestId 
   * @param {string | number} problemId 
   * @returns {Promise<Problem>} Contest problem details
   */
  getContestProblemDetails: async (contestId: string | number, problemId: string | number): Promise<Problem> => {
    const response = await api.get(`/contests/${contestId}/problems/${problemId}`);
    return response.data;
  },

  /**
   * Generates the API URL for retrieving a problem's PDF file.
   * @param {string | number} problemId 
   * @param {string | number | null} [contestId=null] - Optional contest context 
   * @returns {string} Full URL to the PDF endpoint
   */
  getPdfUrl: (problemId: string | number, contestId: string | number | null = null): string => {
    const baseUrl = api.defaults.baseURL || '';
    if (contestId) {
      return `${baseUrl}/contests/${contestId}/problems/${problemId}/pdf`;
    }
    return `${baseUrl}/problems/${problemId}/pdf`;
  }
};

export default problemService;